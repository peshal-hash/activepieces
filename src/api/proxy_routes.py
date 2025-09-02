import requests
import asyncio
import json
import socketio
from fastapi import APIRouter, Request, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import Response, JSONResponse
from bs4 import BeautifulSoup
from typing import Optional
from pydantic import BaseModel

from ..core import config
from ..services import activepieces_service
from ..database_management import db_manager

router = APIRouter()

# Captured bearer token (set after /workflow, or from API responses containing {"token": ...})
TOKEN_ = ""


# --------------------------
# Helpers
# --------------------------
class WorkflowPayload(BaseModel):
    email: str
    password: str
    firstName: Optional[str] = "Workflow"
    lastName: Optional[str] = "User"


def is_webhook_path(path: str) -> bool:
    """Allow webhooks without auth on both forms."""
    return path.startswith("/v1/webhooks") or path.startswith("/api/v1/webhooks")


def _is_public_asset(path: str) -> bool:
    """Allow SPA shell & static assets unauthenticated so the app can bootstrap."""
    if path in ("/", "/index.html"):
        return True
    return any([
        path.startswith("/assets/"),
        path.startswith("/static/"),
        path.endswith(".js"),
        path.endswith(".css"),
        path.endswith(".png"),
        path.endswith(".jpg"),
        path.endswith(".jpeg"),
        path.endswith(".svg"),
        path.endswith(".ico"),
        path.endswith(".map"),
        path.endswith(".txt"),
        path.endswith(".json"),  # manifest/service worker
        path.endswith(".woff"),
        path.endswith(".woff2"),
        path.endswith(".ttf"),
    ])


def token_injection_and_url_rewrite(content, content_type, token_to_inject):
    """
    Rewrite any backend/base absolute URLs to the proxy origin, and inject token into HTML.
    This ensures when you open the app on :5000, all baked absolute links keep using :5000.
    """
    proxy_url = (getattr(config, "AP_PROXY_URL", "") or "").rstrip("/")

    # Build a set of possible "old" bases we want to rewrite back to the proxy
    candidates = set()
    if getattr(config, "AP_BASE", None):
        candidates.add(config.AP_BASE.rstrip("/"))
    if getattr(config, "AP_FRONTEND_URL", None):
        candidates.add(config.AP_FRONTEND_URL.rstrip("/"))
    # Common locals that sometimes get baked in
    candidates.update([
        "http://localhost:80",
        "http://127.0.0.1:80",
        "http://127.0.0.1:3000",
    ])

    # Only attempt rewrites for text-ish content
    lower_ct = content_type.lower() if content_type else ""
    if ("text" in lower_ct) or ("javascript" in lower_ct) or ("json" in lower_ct) or ("html" in lower_ct):
        try:
            content_str = content.decode("utf-8")
        except (UnicodeDecodeError, AttributeError):
            content_str = content  # already str

        for old in list(candidates):
            if old and proxy_url and old != proxy_url:
                content_str = content_str.replace(old, proxy_url)

        if "text/html" in lower_ct and token_to_inject:
            soup = BeautifulSoup(content_str, "html.parser")
            body = soup.find("body")
            if body:
                script_tag = soup.new_tag("script")
                script_tag.string = f"localStorage.setItem('token', '{token_to_inject}');"
                body.insert(0, script_tag)
            return str(soup)
        return content_str

    return content


# --------------------------
# Endpoints
# --------------------------
@router.post("/workflow")
async def workflow(payload: WorkflowPayload):
    global TOKEN_
    try:
        ap_data = activepieces_service.sign_in(payload.email, payload.password)
    except requests.HTTPError:
        try:
            ap_data = activepieces_service.sign_up(
                payload.email, payload.password, payload.firstName, payload.lastName
            )
        except requests.RequestException as e:
            raise HTTPException(status_code=401, detail=f"Activepieces auth failed: {e}")

    db_manager.store_user_data(ap_data)
    token = ap_data.get("token")
    if not token:
        raise HTTPException(status_code=500, detail="Failed to get token")
    TOKEN_ = token
    print(f"AUTH: Token obtained and set globally: {TOKEN_[:10]}...")
    return JSONResponse(content={"success": True, "redirectUrl": config.AP_PROXY_URL})


# 1) Webhooks (no auth) — canonical path
@router.api_route("/v1/webhooks/{rest_of_path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"])
async def v1_webhook_handler(request: Request, rest_of_path: str):
    print("\n✅ --- HTTP Webhook Intercepted! --- ✅")
    body = await request.body()
    print(f"PATH: /v1/webhooks/{rest_of_path}, METHOD: {request.method}")
    print("FORWARDING to backend...")

    full_url = f"{config.AP_BASE.rstrip('/')}/v1/webhooks/{rest_of_path}"
    headers_to_forward = {k: v for k, v in request.headers.items() if k.lower() != "host"}

    try:
        resp = requests.request(
            method=request.method,
            url=full_url,
            headers=headers_to_forward,
            params=request.query_params,
            data=body,
            timeout=getattr(config, "TIMEOUT", 30),
        )
        print(f"BACKEND RESPONSE: Status {resp.status_code}")
        excluded_headers = ["content-encoding", "content-length", "transfer-encoding", "connection"]
        response_headers = {k: v for k, v in resp.headers.items() if k.lower() not in excluded_headers}
        return Response(content=resp.content, status_code=resp.status_code, headers=response_headers)
    except requests.exceptions.RequestException as e:
        return Response(content=f"Proxy connection error on webhook: {e}", status_code=502)


# 1b) Webhooks via /api/v1/webhooks/* — forward to backend /v1/webhooks/*
@router.api_route("/api/v1/webhooks/{rest_of_path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"])
async def api_v1_webhook_handler(request: Request, rest_of_path: str):
    print("\n✅ --- HTTP Webhook Intercepted via /api --- ✅")
    body = await request.body()
    print(f"PATH: /api/v1/webhooks/{rest_of_path}, METHOD: {request.method}")
    print("FORWARDING to backend /v1/webhooks/...")

    full_url = f"{config.AP_BASE.rstrip('/')}/v1/webhooks/{rest_of_path}"  # backend expects /v1/webhooks
    headers_to_forward = {k: v for k, v in request.headers.items() if k.lower() != "host"}

    try:
        resp = requests.request(
            method=request.method,
            url=full_url,
            headers=headers_to_forward,
            params=request.query_params,
            data=body,
            timeout=getattr(config, "TIMEOUT", 30),
        )
        excluded_headers = ["content-encoding", "content-length", "transfer-encoding", "connection"]
        response_headers = {k: v for k, v in resp.headers.items() if k.lower() not in excluded_headers}
        return Response(content=resp.content, status_code=resp.status_code, headers=response_headers)
    except requests.exceptions.RequestException as e:
        return Response(content=f"Proxy connection error on webhook (api form): {e}", status_code=502)


# 2) WebSocket Proxy (Socket.IO) with token-gated connect + reconnection on token change
@router.websocket("/{rest:path}")
async def websocket_proxy(websocket: WebSocket, rest: str):
    await websocket.accept()
    sio_client = socketio.AsyncClient()
    to_browser_queue = asyncio.Queue()
    last_token_used = None

    @sio_client.event
    async def connect():
        print("SIO Client: Successfully connected to Activepieces backend.")

    @sio_client.event
    async def disconnect():
        print("SIO Client: Disconnected from Activepieces backend.")
        await to_browser_queue.put(None)

    @sio_client.on("*")
    async def catch_all(event, data):
        message = f"42{json.dumps([event, data])}"
        print(f"  SIO MSG [Server -> Proxy]: {message[:150]}")
        await to_browser_queue.put(message)

    async def connect_socket_when_ready():
        nonlocal last_token_used
        # Wait up to ~30s for a token
        for _ in range(30):
            if TOKEN_:
                break
            await asyncio.sleep(1)
        if not TOKEN_:
            print("SIO Client: No token after waiting; skipping WS connect.")
            return
        try:
            print(f"SIO Client: Attempting to connect to backend at {config.AP_BASE} with token YES")
            await sio_client.connect(
                config.AP_BASE,
                auth={"token": TOKEN_},
                socketio_path="/api/socket.io",
                transports=["websocket"],
            )
            last_token_used = TOKEN_
        except Exception as e:
            print(f"SIO Client Connection Error: {e}")

    async def token_watcher():
        nonlocal last_token_used
        while True:
            await asyncio.sleep(2)
            try:
                if TOKEN_ and TOKEN_ != last_token_used:
                    print("SIO Client: Detected token change, reconnecting WS.")
                    if sio_client.connected:
                        await sio_client.disconnect()
                    await sio_client.connect(
                        config.AP_BASE,
                        auth={"token": TOKEN_},
                        socketio_path="/api/socket.io",
                        transports=["websocket"],
                    )
                    last_token_used = TOKEN_
            except Exception as e:
                print(f"SIO Client token watcher error: {e}")

    async def forward_to_backend():
        try:
            while True:
                raw_message = await websocket.receive_text()
                print(f"  Raw MSG [Client -> Proxy]: {raw_message[:150]}")
                if raw_message.startswith("42"):
                    msg = json.loads(raw_message[2:])
                    await sio_client.emit(msg[0], msg[1] if len(msg) > 1 else None)
                elif raw_message == "2":
                    await to_browser_queue.put("3")
        except WebSocketDisconnect:
            print("Browser disconnected.")
        finally:
            await to_browser_queue.put(None)

    async def forward_to_browser():
        while True:
            message = await to_browser_queue.get()
            if message is None:
                break
            await websocket.send_text(message)

    tasks = [
        asyncio.create_task(connect_socket_when_ready()),
        asyncio.create_task(token_watcher()),
        asyncio.create_task(forward_to_backend()),
        asyncio.create_task(forward_to_browser()),
    ]

    try:
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for t in pending:
            t.cancel()
    finally:
        try:
            if sio_client.connected:
                await sio_client.disconnect()
        finally:
            if websocket.client_state.name != "DISCONNECTED":
                await websocket.close()
        print("WebSocket proxy connection closed and cleaned up.")


# 3) Generic HTTP Proxy (with token capture + early 401)
@router.api_route("/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def ap_proxy(request: Request, rest: str = ""):
    global TOKEN_
    base = (getattr(config, "AP_BASE", "") or "").rstrip("/")
    path = request.url.path
    full_url = f"{base}/{rest.lstrip('/')}"

    headers = {k: v for k, v in request.headers.items() if k.lower() != "host"}

    # Let SPA shell/static & webhooks pass unauthenticated.
    # Only gate real API calls under /api/* when we truly lack a token.
    if (
        not TOKEN_
        and request.method != "OPTIONS"
        and path.startswith("/api/")
        and not is_webhook_path(path)
        and not _is_public_asset(path)
    ):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    if TOKEN_:
        headers["Authorization"] = f"Bearer {TOKEN_}"

    try:
        body = await request.body()
        resp = requests.request(
            method=request.method,
            url=full_url,
            headers=headers,
            data=body,
            cookies=request.cookies,
            params=request.query_params,
            allow_redirects=False,
            timeout=getattr(config, "TIMEOUT", 30),
        )
    except requests.exceptions.RequestException as e:
        return Response(content=f"Proxy connection error: {e}", status_code=502)

    # Capture token from successful JSON responses
    content_type = resp.headers.get("Content-Type", "")
    if resp.status_code in (200, 201) and "application/json" in (content_type or "").lower():
        try:
            data = resp.json()
            if isinstance(data, dict) and isinstance(data.get("token"), str):
                new_token = data["token"]
                if TOKEN_ != new_token:
                    TOKEN_ = new_token
                    print(f"AUTH: Real token CAPTURED from '{rest}': {TOKEN_[:10]}...")
        except json.JSONDecodeError:
            pass

    rewritten_content = token_injection_and_url_rewrite(resp.content, content_type, TOKEN_)
    excluded_headers = ["content-encoding", "content-length", "transfer-encoding", "connection"]
    response_headers = {k: v for k, v in resp.headers.items() if k.lower() not in excluded_headers}
    return Response(content=rewritten_content, status_code=resp.status_code, headers=response_headers)
