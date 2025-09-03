import asyncio
import json
from typing import Optional, Dict

import httpx
import socketio
from bs4 import BeautifulSoup
from fastapi import APIRouter, Request, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel
import requests

from ..core import config
from ..services import activepieces_service
from ..database_management import db_manager

router = APIRouter()

# =========================================================
# Shared token management (global fallback; prefer cookie)
# =========================================================
TOKEN_: str = ""
_token_lock = asyncio.Lock()


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


def token_injection_and_url_rewrite(content, content_type: str, _token_to_inject: Optional[str]):
    """
    Only do safe URL rewriting. We avoid injecting tokens into HTML for security.
    Rewrites upstream origin references to the proxy origin so the app keeps calling us.
    """
    upstream_origin = config.AP_BASE            # e.g., https://upstream.example.com
    proxy_origin = config.AP_PROXY_URL          # e.g., https://proxy.example.com

    if "text" in content_type or "javascript" in content_type or "json" in content_type:
        try:
            content_str = content.decode("utf-8")
        except (UnicodeDecodeError, AttributeError):
            content_str = content

        # Rewrite upstream absolute urls to the proxy
        if isinstance(content_str, str) and upstream_origin and proxy_origin:
            content_str = content_str.replace(upstream_origin.rstrip("/"), proxy_origin.rstrip("/"))

        return content_str
    return content


# =========================================================
# 1) Auth bootstrap
# =========================================================
@router.post("/workflow")
async def workflow(payload: WorkflowPayload):
    global TOKEN_
    try:
        ap_data = await asyncio.to_thread(activepieces_service.sign_in, payload.email, payload.password)
    except requests.HTTPError:
        try:
            ap_data = await asyncio.to_thread(
                activepieces_service.sign_up, payload.email, payload.password, payload.firstName, payload.lastName
            )
        except requests.RequestException as e:
            raise HTTPException(status_code=401, detail=f"Activepieces auth failed: {e}")

    db_manager.store_user_data(ap_data)

    token = ap_data.get("token")
    if not token:
        raise HTTPException(status_code=500, detail="Failed to get token")

    async with _token_lock:
        TOKEN_ = token

    print(f"AUTH: Token obtained and set globally: {TOKEN_[:10]}...")

    # Set secure HttpOnly cookie so browser sends it automatically; no JS exposure
    resp = JSONResponse(content={"success": True, "redirectUrl": config.AP_PROXY_URL})
    resp.set_cookie(
        key="ap_token",
        value=token,
        httponly=True,
        secure=False,
        samesite="Lax",
        max_age=60 * 60,
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
# 3) Socket.IO WebSocket Bridge
# =========================================================
@router.websocket("/{rest:path}")
async def websocket_proxy(websocket: WebSocket, rest: str):
    await websocket.accept()

    # Prefer cookie token; fall back to global if absent
    cookie_token = websocket.cookies.get("ap_token")
    async with _token_lock:
        global_token = TOKEN_
    header_token = None
    auth_header = websocket.headers.get("Authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        header_token = auth_header.split(" ", 1)[1].strip()

    auth_token = cookie_token or global_token or header_token


    sio_client = socketio.AsyncClient(reconnection=True)
    to_browser_queue: asyncio.Queue[str] = asyncio.Queue()

    async def send_to_browser(text: str):
        try:
            await websocket.send_text(text)
        except RuntimeError:
            pass  # connection closed

    @sio_client.event
    async def connect():
        print("SIO Client: connected to backend.")
        # Send Socket.IO "open" packet to the browser
        await send_to_browser("40")

    @sio_client.event
    async def disconnect():
        print("SIO Client: disconnected from backend.")
        await to_browser_queue.put("__CLOSE__")

    # Wildcard events (if supported); otherwise warn so you know to register specific ones
    try:
        @sio_client.on("*")
        async def _any(event, data):
            pkt = f'42{json.dumps([event, data], separators=(",", ":"))}'
            await to_browser_queue.put(pkt)
    except TypeError:
        print("WARNING: python-socketio client wildcard not supported; register specific events explicitly.")

    # Connect to backend
    try:
        backend_url = config.AP_BASE  # e.g. "https://host"
        auth_payload = {"token": auth_token} if auth_token else None
        print(f"SIO Client: connecting to {backend_url} (token={bool(auth_token)})")

        await sio_client.connect(
            backend_url,
            auth=auth_payload,
            socketio_path="/api/socket.io",
            transports=["websocket"],
        )
    except Exception as e:
        print(f"SIO connect error: {e}")
        await websocket.close(code=4403)
        return

    async def forward_to_backend():
        try:
            while True:
                msg = await websocket.receive()
                if "text" in msg and msg["text"] is not None:
                    raw = msg["text"]

                    # Engine.IO ping from browser → reply with pong
                    if raw == "2":
                        await send_to_browser("3")
                        continue

                    # Socket.IO event frame
                    if raw.startswith("42"):
                        try:
                            arr = json.loads(raw[2:])
                            event = arr[0]
                            data = arr[1] if len(arr) > 1 else None
                            await sio_client.emit(event, data)
                        except Exception as e:
                            print(f"Parse/emit error: {e}")
                            continue
                elif "bytes" in msg and msg["bytes"] is not None:
                    # ignore/extend if you support binary packets
                    pass
        except WebSocketDisconnect:
            print("Browser disconnected.")
        finally:
            await to_browser_queue.put("__CLOSE__")

    async def forward_to_browser():
        while True:
            pkt = await to_browser_queue.get()
            if pkt == "__CLOSE__":
                break
            await send_to_browser(pkt)

    task_backend = asyncio.create_task(forward_to_backend())
    task_browser = asyncio.create_task(forward_to_browser())
    try:
        await asyncio.wait({task_backend, task_browser}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        task_backend.cancel()
        task_browser.cancel()
        if sio_client.connected:
            await sio_client.disconnect()
        if websocket.client_state.name != "DISCONNECTED":
            await websocket.close()
        print("WebSocket proxy connection closed.")


# =========================================================
# 4) Generic HTTP Proxy (Catch-All) with flags fix + safe token
# =========================================================
@router.api_route("/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def ap_proxy(request: Request, rest: str = ""):
    global TOKEN_  # <-- IMPORTANT: declare global since we may assign below

    # Build upstream URL robustly
    base = config.AP_BASE.rstrip("/")
    full_url = f"{base}/{rest.lstrip('/')}"

    # Headers
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

    # Body (read once)
    body = await request.body()

    # Query params
    q_params = dict(request.query_params)

    # Robust path check for flags (inject projectId from cookie if missing)
    norm_path = "/" + rest.lstrip("/").split("?", 1)[0].rstrip("/").lower()
    if norm_path.endswith("/api/v1/flags"):
        cookie_pid = request.cookies.get("ap_project_id")
        if cookie_pid and "projectId" not in q_params:
            q_params["projectId"] = cookie_pid

    # Perform upstream request without blocking the event loop
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

    # Capture token if upstream returns it in JSON (write under lock)
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

    rewritten_content = token_injection_and_url_rewrite(resp.content, content_type, token)
    excluded = {"content-encoding", "content-length", "transfer-encoding", "connection"}
    out_headers = {k: v for k, v in resp.headers.items() if k.lower() not in excluded}
    return Response(content=rewritten_content, status_code=resp.status_code, headers=out_headers)
