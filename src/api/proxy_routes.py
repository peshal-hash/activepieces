import asyncio
import json
from typing import Optional, Dict, Tuple

from urllib.parse import urlsplit, urlunsplit
import contextlib
import httpx
import websockets
from websockets.exceptions import ConnectionClosed
from bs4 import BeautifulSoup
from fastapi import APIRouter, Request, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel
import requests
from fastapi.responses import HTMLResponse
from ..core import config
from ..services import activepieces_service
from ..database_management import db_manager
import re
router = APIRouter()

# =========================================================
# Shared token management (global fallback; prefer cookie)
# =========================================================

def _resolve_auth_from(request: Request) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Prefer request cookies; if not present, fall back to module-level globals.
    Reading globals is guarded by a lock to avoid torn reads while /workflow is writing.
    """
    cookie_token = request.cookies.get("ap_token")
    cookie_pid = request.cookies.get("ap_project_id")
    cookie_plat = request.cookies.get("ap_platform_id")

    return cookie_token, cookie_pid, cookie_plat



PLAT_SEGMENT_RE = re.compile(r"(?:^|/)(?:api/)?v1/platforms/([^/?#]+)", re.IGNORECASE)
PROJECT_FLOW_PATH_RE = re.compile(
    r"(?P<prefix>(?:^|/)projects/)(?P<pid>[^/?#]+)/flows/(?P<fid>[^/?#]+)",
    re.IGNORECASE,
)
PROJECT_SEGMENT_RE = re.compile(r"(?P<prefix>(?:^|/)projects/)(?P<pid>[^/?#]+)", re.IGNORECASE)
USERS_PROJECT_RE = re.compile(
    r"(?P<prefix>(?:^|/)(?:api/)?v1/users/projects/)(?P<pid>[^/?#]+)",
    re.IGNORECASE,
)


class WorkflowPayload(BaseModel):
    email: str
    password: str
    firstName: Optional[str] = "Workflow"
    lastName: Optional[str] = "User"


def _filtered_outgoing_headers(incoming: Dict[str, str]) -> Dict[str, str]:
    """Strip hop-by-hop headers; upstream will set length/encoding."""
    hop_by_hop = {
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailers",
        "transfer-encoding",
        "upgrade",
        "content-length",
        "host",
    }
    return {k: v for k, v in incoming.items() if k.lower() not in hop_by_hop}


def url_rewrite(content, content_type: str, token_to_inject: Optional[str]):
    """
    Rewrites upstream origin references to the proxy origin and injects an auth token
    into HTML documents for the client-side application.
    """
    upstream_origin = config.AP_BASE  # e.g., https://upstream.example.com
    proxy_origin = config.AP_PROXY_URL      # e.g., https://proxy.example.com

    content_str = None
    if "text" in content_type or "javascript" in content_type or "json" in content_type:
        try:
            content_str = content.decode("utf-8")
        except (UnicodeDecodeError, AttributeError):
            content_str = content  # Already a string

        # Perform token injection for HTML content
        if "html" in content_type and token_to_inject:
            soup = BeautifulSoup(content_str, 'html.parser')
            body = soup.find('body')
            if body:
                # This script runs in the user's browser to set the token
                script_content = f"localStorage.setItem('token', '{token_to_inject}');"
                script_tag = soup.new_tag('script')
                script_tag.string = script_content
                # Insert the script at the very beginning of the <body>
                body.insert(0, script_tag)
                content_str = str(soup)

        # Perform URL rewriting for all applicable text-based content
        if isinstance(content_str, str) and upstream_origin and proxy_origin:
            content_str = content_str.replace(upstream_origin.rstrip("/"), proxy_origin.rstrip("/"))

        return content_str

    return content

def _is_https(request: Request) -> bool:
    # If behind a reverse proxy that terminates TLS, trust X-Forwarded-Proto
    xf_proto = request.headers.get("x-forwarded-proto")
    if xf_proto:
        return xf_proto.lower() == "https"
    return request.url.scheme == "https"
# =========================================================
# 1) Auth bootstrap
# =========================================================

@router.post("/workflow")
async def workflow(payload: WorkflowPayload,request: Request):
    # STEP 1: Add print statements to see if the endpoint is hit and what data is received.
    print("--- ✅ /workflow endpoint was called! ---")
    print(f"Received payload: {payload.model_dump_json()}")

    try:
        # This is the first attempt to sign in the user.
        print("Attempting to sign in...")
        ap_data = await asyncio.to_thread(activepieces_service.sign_in, payload.email, payload.password)
        print("Sign in successful.")

    # STEP 2: Broaden the exception catch. This now handles HTTP errors AND other network issues.
    except requests.RequestException as e:
        print(f"Sign in failed with error: {e}. Attempting to sign up instead...")
        try:
            ap_data = await asyncio.to_thread(
                activepieces_service.sign_up, payload.email, payload.password, payload.firstName, payload.lastName
            )
            print("Sign up successful.")
        except requests.RequestException as signup_error:
            # If sign-up also fails, raise a clear error.
            print(f"Sign up also failed: {signup_error}")
            raise HTTPException(status_code=401, detail=f"Activepieces auth failed on both sign-in and sign-up: {signup_error}")

    db_manager.store_user_data(ap_data)
    print(ap_data)
    token = ap_data.get("token")
    projectId=ap_data.get("projectId")
    platformId=ap_data.get("platformId")
    if not token:
        raise HTTPException(status_code=500, detail="Failed to get token after auth flow")

    resp = JSONResponse(content={"success": True, "redirectUrl": config.AP_PROXY_URL})
    is_https = _is_https(request)
    if is_https:
        samesite = "None"
        secure = True
    else:
        samesite = "Lax"    # allows top-level navigation + same-site XHR
        secure  = False
    cookie_args = dict(
        httponly=True,
        secure=secure,
        samesite=samesite,
        path="/",
        max_age=0,
    )
    resp.set_cookie("ap_token", token, **cookie_args)
    resp.set_cookie("ap_project_id", projectId or "", **cookie_args)
    resp.set_cookie("ap_platform_id", platformId or "", **cookie_args)

    # Optional: a non-HttpOnly helper for client code (OK if it’s non-sensitive)
    resp.set_cookie("ap_session_born", "1",**cookie_args)
    return resp


@router.get("/logout")
async def logout(request: Request):
    """
    Log out of the proxied Activepieces session and aggressively clear
    client-side state so stale flow routes/IDs aren't reused across users.
    """

    # 2) Build a tiny page that wipes client storage (belt-and-suspenders)
    redirect_url = config.CORS_ORIGINS[0].rstrip('/')

    html = f"""
    <script>
      // Clear Web Storage
      try {{
        localStorage.clear();
        sessionStorage.clear();
      }} catch (e) {{}}

      // Clear IndexedDB (best-effort)
      try {{
        if (indexedDB && indexedDB.databases) {{
          indexedDB.databases().then(dbs => dbs.forEach(db => db && db.name && indexedDB.deleteDatabase(db.name)));
        }}
      }} catch (e) {{}}

      // Clear Cache Storage (best-effort)
      try {{
        if (window.caches && caches.keys) {{
          caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
        }}
      }} catch (e) {{}}

      // Unregister service workers (best-effort)
      try {{
        navigator.serviceWorker?.getRegistrations?.().then(regs => regs.forEach(r => r.unregister()));
      }} catch (e) {{}}

      // Redirect back to the host app
      window.location.replace('{redirect_url}');
    </script>
    """

    resp = HTMLResponse(content=html, status_code=200)

    # 3) Tell the browser to clear site data **via HTTP headers**
    # Note: Clear-Site-Data requires HTTPS (allowed on localhost).
    resp.headers["Clear-Site-Data"] = '"cache", "cookies", "storage"'
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"

    # 4) Expire all auth/correlation cookies for this origin
    # Make sure these attributes (domain/path/secure/samesite) match how you originally set them.
    is_https = _is_https(request)
    if is_https:
        samesite = "None"
        secure = True
    else:
        samesite = "Lax"    # allows top-level navigation + same-site XHR
        secure  = False
    cookie_args = dict(
        httponly=True,
        secure=secure,
        samesite=samesite,
        path="/",
        max_age=0,
    )
    for name in ("ap_token", "ap_project_id", "ap_platform_id", "ap_session_born"):
        resp.set_cookie(name, value="", **cookie_args)

    # Optional: help proxies/CDNs avoid cross-user cache bleed
    resp.headers["Vary"] = "Cookie"

    print("=== LOGOUT: cleared proxy token, set Clear-Site-Data, expired cookies ===")
    return resp



# =========================================================
# 2) Specific Webhook Handler (HTTP → HTTP)
# =========================================================
# =========================================================
# 2) Specific Webhook Handler (HTTP → HTTP)  — hardened
# =========================================================
@router.api_route("/v1/webhooks/{rest_of_path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
async def v1_webhook_handler(request: Request, rest_of_path: str):
    print("\n✅ --- HTTP Webhook Intercepted! --- ✅")
    full_url = f"{config.AP_BASE.rstrip('/')}/v1/webhooks/{rest_of_path}"

    # 1) Build outbound headers first (fixes NameError and hop-by-hop leakage)
    headers = _filtered_outgoing_headers(dict(request.headers))
    headers.setdefault("X-Forwarded-Proto", request.url.scheme)
    headers.setdefault("X-Forwarded-Host", request.headers.get("host", ""))
    headers.setdefault("X-Forwarded-For", request.client.host if request.client else "")

    # 2) Attach auth if we have it
    tok, _, _ = _resolve_auth_from(request)
    if tok:
        headers["Authorization"] = f"Bearer {tok}"

    # 3) Body + params (DON’T send a naked "?" if empty)
    body = await request.body()
    q_params = dict(request.query_params)
    params = q_params if q_params else None

    # 4) Debug
    try:
        from urllib.parse import urlencode
        print(f"[UPSTREAM REQ] {request.method} {full_url}" + (f"?{urlencode(q_params, doseq=True)}" if q_params else ""))
    except Exception:
        pass

    # 5) Send upstream
    try:
        async with httpx.AsyncClient(timeout=config.TIMEOUT, follow_redirects=False) as client:
            resp = await client.request(
                method=request.method,
                url=full_url,
                headers=headers,
                params=params,          # <- None when empty to avoid "?"
                content=body,
                cookies=request.cookies,
            )
    except httpx.RequestError as e:
        return Response(content=f"Proxy connection error on webhook: {e}", status_code=502)

    # 6) Filter unsafe headers on the way back
    excluded = {"content-encoding", "content-length", "transfer-encoding", "connection"}
    out_headers = {k: v for k, v in resp.headers.items() if k.lower() not in excluded}
    return Response(content=resp.content, status_code=resp.status_code, headers=out_headers)
# =========================================================
# WebSocket tunnel — robust to client disconnects
# =========================================================
# =========================================================
# WebSocket tunnel — robust to client disconnects
# =========================================================
@router.websocket("/{rest:path}")
async def websocket_proxy(websocket: WebSocket, rest: str):
    """
    Transparent WS tunnel for Socket.IO/Engine.IO: forward frames byte-for-byte
    to the upstream /api/socket.io endpoint so the real server handles the protocol.
    """
    await websocket.accept()

    # Build upstream WS URL from AP_BASE + incoming {rest} + original querystring
    base = config.AP_BASE.rstrip("/")
    parsed = urlsplit(base)
    scheme = "wss" if parsed.scheme == "https" else "ws"
    incoming_qs = ""
    if websocket.scope.get("query_string"):
        incoming_qs = str(websocket.scope["query_string"], "latin-1")
    upstream_path = "/" + rest.lstrip("/")
    upstream_url = urlunsplit((scheme, parsed.netloc, upstream_path, incoming_qs, ""))

    origin = websocket.headers.get("origin")  # preserve Origin when present

    print(f"WS TUNNEL: {websocket.url}  -->  {upstream_url}")
    close_code = 1000

    try:
        async with websockets.connect(
            upstream_url,
            origin=origin,
            open_timeout=20,
            close_timeout=20,
            max_size=None,
            max_queue=None,
            ping_interval=None,  # Engine.IO handles keepalive
        ) as upstream_ws:

            async def pump_to_upstream():
                # Browser -> Upstream
                try:
                    while True:
                        try:
                            msg = await websocket.receive()
                        except WebSocketDisconnect:
                            # Browser closed; close upstream and exit
                            try:
                                await upstream_ws.close()
                            except Exception:
                                pass
                            return
                        except RuntimeError as e:
                            # Starlette raises after a disconnect has been received
                            if 'disconnect message has been received' in str(e).lower():
                                try:
                                    await upstream_ws.close()
                                except Exception:
                                    pass
                                return
                            raise  # other runtime errors should bubble

                        if "text" in msg and msg["text"] is not None:
                            await upstream_ws.send(msg["text"])
                        elif "bytes" in msg and msg["bytes"] is not None:
                            await upstream_ws.send(msg["bytes"])
                        # else ignore control messages
                except Exception:
                    # swallow — outer finally will handle client close/logging
                    pass

            async def pump_to_browser():
                # Upstream -> Browser
                try:
                    while True:
                        data = await upstream_ws.recv()  # str or bytes
                        if isinstance(data, (bytes, bytearray)):
                            await websocket.send_bytes(data)
                        else:
                            await websocket.send_text(data)
                except ConnectionClosed:
                    # Upstream closed; just exit loop
                    pass
                except RuntimeError as e:
                    # If Starlette socket already gone, exit quietly
                    if 'websocket' in str(e).lower():
                        pass
                    else:
                        raise

            t1 = asyncio.create_task(pump_to_upstream())
            t2 = asyncio.create_task(pump_to_browser())
            done, pending = await asyncio.wait({t1, t2}, return_when=asyncio.FIRST_COMPLETED)

            # Cancel the remaining task cleanly
            for t in pending:
                t.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await t

    except Exception as e:
        print(f"WS tunnel connect error: {e}")
        close_code = 1011  # Internal Error

    finally:
        if websocket.client_state.name != "DISCONNECTED":
            try:
                await websocket.close(code=close_code)
            except Exception:
                pass
        print(f"WS tunnel closed with code: {close_code}")

# =========================================================
# 4) Generic HTTP Proxy (Catch-All) with flags fix + safe token
# =========================================================
@router.api_route("/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def ap_proxy(request: Request, rest: str = ""):
    # --- Parse/merge any accidental query string that snuck into `rest` ---
    # FastAPI normally strips it, but hardening for safety:
    from urllib.parse import parse_qsl, urlencode

    extra_qs = {}
    if "?" in rest:
        path_only, qs = rest.split("?", 1)
        rest = path_only
        if qs:
            extra_qs = dict(parse_qsl(qs, keep_blank_values=True))

    # --- Build base headers first (before adding Authorization) ---
    incoming = dict(request.headers)
    headers = _filtered_outgoing_headers(incoming)
    headers.setdefault("X-Forwarded-Proto", request.url.scheme)
    headers.setdefault("X-Forwarded-Host", incoming.get("host", ""))
    headers.setdefault("X-Forwarded-For", request.client.host if request.client else "")

    # Prefer cookie token; fall back to globals (resolved atomically)
    token, cookie_pid, cookie_platform_id = _resolve_auth_from(request)

    print("***********************************************************")
    print(f"token:  {token}")
    print("***********************************************************")
    print(f"project id :  {cookie_pid}")
    print("++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++")
    print(f"parameters id:  {cookie_platform_id}")
    print("***********************************************************")

    body = await request.body()
    modified_body = body
    req_content_type = request.headers.get("content-type", "")

    if token:
        headers["Authorization"] = f"Bearer {token}"

    if modified_body != body:
        headers["content-length"] = str(len(modified_body))

    # --------------------------
    # Start with query params: merge real query with any extra_qs from rest
    # --------------------------
    q_params = dict(request.query_params)  # Starlette's QueryParams -> dict
    if extra_qs:
        # merge: request.query_params has precedence; keep existing values
        for k, v in extra_qs.items():
            q_params.setdefault(k, v)

    # Upstream is AP_BASE + normalized rest
    # Strip a naked trailing '?' if it somehow exists after manipulations (belt & suspenders)
    if rest.endswith("?"):
        rest = rest[:-1]

    # --------------------------
    # Platform ID normalization (path + header)
    # --------------------------
    if cookie_platform_id:
        headers.setdefault("X-AP-Platform-Id", cookie_platform_id)
        m = PLAT_SEGMENT_RE.search(rest)
        if m:
            path_platform_id = m.group(1)
            if path_platform_id != cookie_platform_id:
                s, e = m.span(1)
                rest = rest[:s] + cookie_platform_id + rest[e:]

    # --------------------------
    # Project ID normalization (paths + query)
    # --------------------------
    if cookie_pid:
        headers.setdefault("X-AP-Project-Id", cookie_pid)

        # /projects/{pid}/flows/{fid} (replace only pid)
        m_pf = PROJECT_FLOW_PATH_RE.search(rest)
        if m_pf:
            path_pid = m_pf.group("pid")
            if path_pid != cookie_pid:
                s, e = m_pf.span("pid")
                rest = rest[:s] + cookie_pid + rest[e:]
                print(f"[PROJECT-ID REWRITE:PATH projects/.../flows/...] '{path_pid}' -> '{cookie_pid}' in '{rest}'")
        else:
            # Any /projects/{pid} (use last occurrence if multiple)
            last = None
            for m in PROJECT_SEGMENT_RE.finditer(rest):
                last = m
            if last:
                path_pid = last.group("pid")
                if path_pid != cookie_pid:
                    s, e = last.span("pid")
                    rest = rest[:s] + cookie_pid + rest[e:]
                    print(f"[PROJECT-ID REWRITE:PATH projects/...] '{path_pid}' -> '{cookie_pid}' in '{rest}'")

        # /api/v1/users/projects/{pid}
        m_up = USERS_PROJECT_RE.search(rest)
        if m_up:
            path_pid = m_up.group("pid")
            if path_pid != cookie_pid:
                s, e = m_up.span("pid")
                rest = rest[:s] + cookie_pid + rest[e:]
                print(f"[PROJECT-ID REWRITE:PATH users/projects] '{path_pid}' -> '{cookie_pid}' in '{rest}'")

        # Query: normalize `projectId`
        if "projectId" in q_params and q_params["projectId"] != cookie_pid:
            print(f"[PROJECT-ID REWRITE:QUERY] '{q_params['projectId']}' -> '{cookie_pid}'")
            q_params["projectId"] = cookie_pid

    # Optional: upstream treats literal "NULL" poorly; drop it
    if q_params.get("folderId") == "NULL":
        q_params.pop("folderId", None)

    full_url = f"{config.AP_BASE.rstrip('/')}/{rest.lstrip('/')}"

    # Log without trailing '?' when there is no query
    qs = urlencode(q_params, doseq=True) if q_params else ""
    log_url = f"{full_url}{('?' + qs) if qs else ''}"
    try:
        print(f"[UPSTREAM REQ] {request.method} {log_url}")
    except Exception:
        pass

    # Forward (params=None avoids adding a stray '?')
    try:
        resp = await asyncio.to_thread(
            requests.request,
            request.method,
            full_url,
            headers=headers,
            params=(q_params or None),
            data=modified_body,
            cookies=request.cookies,
            allow_redirects=False,
            timeout=config.TIMEOUT,
        )
    except requests.exceptions.RequestException as e:
        return Response(content=f"Proxy connection error: {e}", status_code=502)

    # Response processing
    resp_content_type = resp.headers.get("Content-Type", "")
    if 400 <= resp.status_code < 600:
        try:
            print(f"[UPSTREAM {resp.status_code}] {rest} -> {resp.text[:500]}")
        except Exception:
            pass

    rewritten_content = url_rewrite(resp.content, resp_content_type, token)
    excluded = {"content-encoding", "content-length", "transfer-encoding", "connection"}
    out_headers = {k: v for k, v in resp.headers.items() if k.lower() not in excluded}
    return Response(content=rewritten_content, status_code=resp.status_code, headers=out_headers)
