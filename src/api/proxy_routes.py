import asyncio
import json
from typing import Optional, Dict
from urllib.parse import urlsplit, urlunsplit

import httpx
import websockets
from websockets.exceptions import ConnectionClosed
from bs4 import BeautifulSoup
from fastapi import APIRouter, Request, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel
import requests

from ..core import config
from ..services import activepieces_service
from ..database_management import db_manager
import re
router = APIRouter()

# =========================================================
# Shared token management (global fallback; prefer cookie)
# =========================================================
TOKEN_: str = ""
_token_lock = asyncio.Lock()

_PLAT_SEGMENT_RE = re.compile(r"(/v1/platforms/)([^/?#]+)", flags=re.IGNORECASE)

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

# =========================================================
# 1) Auth bootstrap
# =========================================================

@router.post("/workflow")
async def workflow(payload: WorkflowPayload):
    # STEP 1: Add print statements to see if the endpoint is hit and what data is received.
    print("--- ✅ /workflow endpoint was called! ---")
    print(f"Received payload: {payload.model_dump_json()}")

    global TOKEN_
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

    token = ap_data.get("token")
    projectId=ap_data.get("projectId")
    platformId=ap_data.get("platformId")
    if not token:
        raise HTTPException(status_code=500, detail="Failed to get token after auth flow")

    async with _token_lock:
        TOKEN_ = token

    print(f"AUTH: Token obtained and set globally: {TOKEN_[:10]}...")

    is_https = config.AP_PROXY_URL.lower().startswith("https")
    resp = JSONResponse(content={"success": True, "redirectUrl": config.AP_PROXY_URL,"token":token})
    resp.set_cookie(
        key="ap_token",
        value=token,
        httponly=True,
        secure=is_https,
        samesite="Lax",
        max_age=60 * 60,
        path="/",
    )
    resp.set_cookie(
        key="ap_project_id",
        value=projectId,
        httponly=True,
        secure=is_https,
        samesite="Lax",
        max_age=60 * 60,
        path="/",
    )
    resp.set_cookie(
        key="ap_platform_id",
        value=platformId,
        httponly=True,
        secure=is_https,
        samesite="Lax",
        max_age=60 * 60,
        path="/",
    )
    return resp

# =========================================================
# 2) Specific Webhook Handler (HTTP → HTTP)
# =========================================================
@router.api_route("/v1/webhooks/{rest_of_path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
async def v1_webhook_handler(request: Request, rest_of_path: str):
    print("\n✅ --- HTTP Webhook Intercepted! --- ✅")
    full_url = f"{config.AP_BASE.rstrip('/')}/v1/webhooks/{rest_of_path}"

    headers = _filtered_outgoing_headers(dict(request.headers))
    headers.setdefault("X-Forwarded-Proto", request.url.scheme)
    headers.setdefault("X-Forwarded-Host", request.headers.get("host", ""))
    headers.setdefault("X-Forwarded-For", request.client.host if request.client else "")

    body = await request.body()

    try:
        async with httpx.AsyncClient(timeout=config.TIMEOUT, follow_redirects=False) as client:
            resp = await client.request(
                method=request.method,
                url=full_url,
                headers=headers,
                params=dict(request.query_params),
                content=body,
                cookies=request.cookies,  # forward cookies if present
            )
    except httpx.RequestError as e:
        return Response(content=f"Proxy connection error on webhook: {e}", status_code=502)

    excluded = {"content-encoding", "content-length", "transfer-encoding", "connection"}
    out_headers = {k: v for k, v in resp.headers.items() if k.lower() not in excluded}
    return Response(content=resp.content, status_code=resp.status_code, headers=out_headers)


# =========================================================
# 3) Transparent WebSocket tunnel (Engine.IO/Socket.IO)
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

    # Preserve Origin when present (some servers enforce it)
    origin = websocket.headers.get("origin")

    print(f"WS TUNNEL: {websocket.url}  -->  {upstream_url}")

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
                try:
                    while True:
                        msg = await websocket.receive()
                        if "text" in msg and msg["text"] is not None:
                            await upstream_ws.send(msg["text"])
                        elif "bytes" in msg and msg["bytes"] is not None:
                            await upstream_ws.send(msg["bytes"])
                        else:
                            # ignore other control messages
                            pass
                except WebSocketDisconnect:
                    # browser closed -> close upstream
                    try:
                        await upstream_ws.close()
                    except Exception:
                        pass

            async def pump_to_browser():
                try:
                    while True:
                        data = await upstream_ws.recv()  # str or bytes
                        if isinstance(data, (bytes, bytearray)):
                            await websocket.send_bytes(data)
                        else:
                            await websocket.send_text(data)
                except ConnectionClosed:
                    # ✅ FIX: Simply catch the exception and let the task finish.
                    # The 'finally' block below is the only place we should
                    # close the client-facing websocket.
                    pass

            t1 = asyncio.create_task(pump_to_upstream())
            t2 = asyncio.create_task(pump_to_browser())
            done, pending = await asyncio.wait({t1, t2}, return_when=asyncio.FIRST_COMPLETED)
            for t in pending:
                t.cancel()

    except Exception as e:
        print(f"WS tunnel connect error: {e}")
        close_code = 1011  # Internal Error
        # CHANGE: Removed the unnecessary 'return' statement

    finally:
        # CHANGE: Use the captured close_code to inform the client why the connection is closing.
        if websocket.client_state.name != "DISCONNECTED":
            await websocket.close(code=close_code)
        print(f"WS tunnel closed with code: {close_code}")
# =========================================================
# 4) Generic HTTP Proxy (Catch-All) with flags fix + safe token
# =========================================================
@router.api_route("/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def ap_proxy(request: Request, rest: str = ""):
    global TOKEN_

    base = config.AP_BASE.rstrip("/")
    full_url = f"{base}/{rest.lstrip('/')}"
    print("************************************************************************************")
    print(full_url)

    incoming = dict(request.headers)
    headers = _filtered_outgoing_headers(incoming)
    headers.setdefault("X-Forwarded-Proto", request.url.scheme)
    headers.setdefault("X-Forwarded-Host", incoming.get("host", ""))
    headers.setdefault("X-Forwarded-For", request.client.host if request.client else "")

    # Prefer cookie token; fall back to global (read under lock)
    cookie_token = request.cookies.get("ap_token")

    async with _token_lock:
        global_token = TOKEN_
    token = cookie_token or global_token
    if token:
        headers["Authorization"] = f"Bearer {token}"

    body = await request.body()
    q_params = dict(request.query_params)
    print("++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++")
    print(q_params)
    print("************************************************************************************")

    # Inject projectId for flags if missing (from cookie)
    norm_path = "/" + rest.lstrip("/").split("?", 1)[0].rstrip("/").lower()
    if norm_path.endswith("/api/v1/flags"):
        cookie_pid = request.cookies.get("ap_project_id")
        if cookie_pid and "projectId" not in q_params:
            q_params["projectId"] = cookie_pid
    cookie_platform_id = request.cookies.get("ap_platform_id")
    if cookie_platform_id:
        m = _PLAT_SEGMENT_RE.search(rest)
        if m:
            path_platform_id = m.group(2)
            if path_platform_id != cookie_platform_id:
                rest = rest[:m.start(2)] + cookie_platform_id + rest[m.end(2):]
                full_url = f"{base}/{rest.lstrip('/')}"
                print(f"[PLATFORM-ID REWRITE] '{path_platform_id}' -> '{cookie_platform_id}'")

    try:
        resp = await asyncio.to_thread(
            requests.request,
            request.method,
            full_url,
            headers=headers,
            params=q_params,
            data=body,
            cookies=request.cookies,
            allow_redirects=False,
            timeout=config.TIMEOUT,
        )
    except requests.exceptions.RequestException as e:
        return Response(content=f"Proxy connection error: {e}", status_code=502)

    # Capture token if upstream returns it in JSON
    content_type = resp.headers.get("Content-Type", "")
    if resp.status_code == 200 and "application/json" in content_type:
        try:
            data = resp.json()
            if isinstance(data, dict) and isinstance(data.get("token"), str):
                new_token = data["token"]
                async with _token_lock:
                    if TOKEN_ != new_token:
                        TOKEN_ = new_token
                        print(f"AUTH: Real token CAPTURED from '{rest}': {TOKEN_[:10]}...")
        except json.JSONDecodeError:
            pass

    if 400 <= resp.status_code < 600:
        try:
            print(f"[UPSTREAM {resp.status_code}] {rest} -> {resp.text[:500]}")
        except Exception:
            pass

    rewritten_content = url_rewrite(resp.content, content_type, token)
    excluded = {"content-encoding", "content-length", "transfer-encoding", "connection"}
    out_headers = {k: v for k, v in resp.headers.items() if k.lower() not in excluded}
    return Response(content=rewritten_content, status_code=resp.status_code, headers=out_headers)
