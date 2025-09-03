import asyncio
import json
from typing import Optional, Dict

import httpx
import socketio
from bs4 import BeautifulSoup
from fastapi import APIRouter, Request, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import Response, JSONResponse

from ..core import config
from ..services import activepieces_service
from ..database_management import db_manager

router = APIRouter()

# -----------------------
# Shared token management
# -----------------------
TOKEN_: str = ""
_token_lock = asyncio.Lock()

class WorkflowPayload(BaseModel):
    email: str
    password: str
    firstName: Optional[str] = "Workflow"
    lastName: Optional[str] = "User"

def token_injection_and_url_rewrite(content, content_type, token_to_inject):
    base_url_to_replace = config.AP_PROXY_URL
    new_base_url = config.AP_FRONTEND_URL

    if 'text' in content_type or 'javascript' in content_type or 'json' in content_type:
        try:
            content_str = content.decode('utf-8')
        except (UnicodeDecodeError, AttributeError):
            content_str = content

        content_str = content_str.replace(base_url_to_replace, new_base_url)

        if 'text/html' in content_type and token_to_inject:
            soup = BeautifulSoup(content_str, 'html.parser')
            body = soup.find('body')
            if body:
                script_tag = soup.new_tag('script')
                script_tag.string = f"localStorage.setItem('token', '{token_to_inject}');"
                body.insert(0, script_tag)
            return str(soup)
        return content_str
    return content

# -----------------------
# Auth bootstrap (unchanged interface)
# -----------------------
@router.post("/workflow")
async def workflow(payload: WorkflowPayload):
    global TOKEN_
    try:
        ap_data = activepieces_service.sign_in(payload.email, payload.password)
    except requests.HTTPError:
        try:
            ap_data = activepieces_service.sign_up(payload.email, payload.password, payload.firstName, payload.lastName)
        except requests.RequestException as e:
            raise HTTPException(status_code=401, detail=f"Activepieces auth failed: {e}")

    db_manager.store_user_data(ap_data)
    token = ap_data.get('token')
    if not token:
        raise HTTPException(status_code=500, detail="Failed to get token")

    async with _token_lock:
        TOKEN_ = token

    print(f"AUTH: Token obtained and set globally: {TOKEN_[:10]}...")
    return JSONResponse(content={'success': True, 'redirectUrl': config.AP_PROXY_URL})

# -----------------------------------
# 1) Specific Webhook Handler (HTTP)
# -----------------------------------
# Use httpx.AsyncClient to avoid blocking the event loop. Stream back the result.
def _filtered_outgoing_headers(incoming: Dict[str, str]) -> Dict[str, str]:
    # remove hop-by-hop headers; httpx will set length/encoding appropriately
    hop_by_hop = {
        'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
        'te', 'trailers', 'transfer-encoding', 'upgrade', 'content-length',
    }
    return {k: v for k, v in incoming.items() if k.lower() not in hop_by_hop and k.lower() != 'host'}

@router.api_route("/v1/webhooks/{rest_of_path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
async def v1_webhook_handler(request: Request, rest_of_path: str):
    print("\n✅ --- HTTP Webhook Intercepted! --- ✅")
    full_url = f"{config.AP_BASE.rstrip('/')}/v1/webhooks/{rest_of_path}"

    # Build outbound headers
    headers = _filtered_outgoing_headers(dict(request.headers))
    headers.setdefault('X-Forwarded-Proto', request.url.scheme)
    headers.setdefault('X-Forwarded-Host', request.headers.get('host', ''))
    headers.setdefault('X-Forwarded-For', request.client.host if request.client else '')

    # Read body once
    body = await request.body()

    try:
        async with httpx.AsyncClient(timeout=config.TIMEOUT, follow_redirects=False) as client:
            resp = await client.request(
                method=request.method,
                url=full_url,
                headers=headers,
                params=dict(request.query_params),
                content=body,
            )
    except httpx.RequestError as e:
        return Response(content=f"Proxy connection error on webhook: {e}", status_code=502)

    # Prepare response to client
    excluded = {'content-encoding', 'content-length', 'transfer-encoding', 'connection'}
    out_headers = {k: v for k, v in resp.headers.items() if k.lower() not in excluded}
    return Response(content=resp.content, status_code=resp.status_code, headers=out_headers)

# -------------------------
# 2) WebSocket / Socket.IO
# -------------------------
@router.websocket("/{rest:path}")
async def websocket_proxy(websocket: WebSocket, rest: str):
    await websocket.accept()

    # Local snapshot of token to avoid races
    async with _token_lock:
        auth_token = TOKEN_

    sio_client = socketio.AsyncClient(reconnection=True)
    to_browser_queue: asyncio.Queue[str] = asyncio.Queue()

    # --- Helpers to send frames to browser
    async def send_to_browser(text: str):
        try:
            await websocket.send_text(text)
        except RuntimeError:
            # connection likely closed
            pass

    # --- Backend event handlers
    @sio_client.event
    async def connect():
        print("SIO Client: connected to backend.")
        # Send Socket.IO "open" packet to the browser
        # Browser expects '40' after a successful connect
        await send_to_browser('40')

    @sio_client.event
    async def disconnect():
        print("SIO Client: disconnected from backend.")
        await to_browser_queue.put('__CLOSE__')

    # Wildcard handling: use native if available, otherwise shim with on_any_event
    if hasattr(sio_client, 'on') and callable(getattr(sio_client, 'on')):
        try:
            @sio_client.on('*')  # works on recent python-socketio
            async def _any(event, data):
                # Frame as a Socket.IO message ('42' + JSON array [event, data])
                pkt = f'42{json.dumps([event, data], separators=(",", ":"))}'
                await to_browser_queue.put(pkt)
        except TypeError:
            # Fallback for older versions: register a generic handler
            async def on_any_event(event, *args):
                data = args[0] if args else None
                pkt = f'42{json.dumps([event, data], separators=(",", ":"))}'
                await to_browser_queue.put(pkt)
            sio_client.on('*', handler=on_any_event)

    # Connect to backend
    try:
        backend_url = config.AP_BASE  # must include scheme, e.g. "https://host"
        auth_payload = {'token': auth_token} if auth_token else None
        print(f"SIO Client: connecting to {backend_url} (token={bool(auth_token)})")

        await sio_client.connect(
            backend_url,
            auth=auth_payload,
            socketio_path="/api/socket.io",
            transports=['websocket'],
        )
    except Exception as e:
        print(f"SIO connect error: {e}")
        await websocket.close(code=4403)
        return

    async def forward_to_backend():
        try:
            while True:
                msg = await websocket.receive()
                if 'text' in msg and msg['text'] is not None:
                    raw = msg['text']

                    # Engine.IO ping from browser
                    if raw == '2':
                        # reply with pong directly (Engine.IO)
                        await send_to_browser('3')
                        continue

                    # Socket.IO event frame
                    if raw.startswith('42'):
                        try:
                            arr = json.loads(raw[2:])
                            event = arr[0]
                            data = arr[1] if len(arr) > 1 else None
                            await sio_client.emit(event, data)
                        except Exception as e:
                            print(f"Parse/emit error: {e}")
                            continue

                    # Ignore other control frames from browser ('40' etc.) – we originate those
                elif 'bytes' in msg and msg['bytes'] is not None:
                    # If your frontend uses binary packets, you could forward via sio_client.emit with binary=True
                    # For now, ignore to avoid protocol drift.
                    pass
        except WebSocketDisconnect:
            print("Browser disconnected.")
        finally:
            await to_browser_queue.put('__CLOSE__')

    async def forward_to_browser():
        while True:
            pkt = await to_browser_queue.get()
            if pkt == '__CLOSE__':
                break
            await send_to_browser(pkt)

    # Run both directions until one ends
    task_backend = asyncio.create_task(forward_to_backend())
    task_browser = asyncio.create_task(forward_to_browser())
    try:
        await asyncio.wait({task_backend, task_browser}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        task_backend.cancel()
        task_browser.cancel()
        if sio_client.connected:
            await sio_client.disconnect()
        if websocket.client_state.name != 'DISCONNECTED':
            await websocket.close()
        print("WebSocket proxy connection closed.")

# ---------------------------------------------------------
# 3) Generic HTTP Proxy (Catch-All) with Token Interception
# ---------------------------------------------------------
@router.api_route("/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def ap_proxy(request: Request, rest: str = ""):
    global TOKEN_
    full_url = f"{config.AP_BASE.rstrip('/')}/{rest}"
    incoming_headers = dict(request.headers)
    headers = _filtered_outgoing_headers(incoming_headers)
    headers.setdefault('X-Forwarded-Proto', request.url.scheme)
    headers.setdefault('X-Forwarded-Host', incoming_headers.get('host', ''))
    headers.setdefault('X-Forwarded-For', request.client.host if request.client else '')

    # Auth header injection from captured token
    async with _token_lock:
        if TOKEN_:
            headers['Authorization'] = f"Bearer {TOKEN_}"

    body = await request.body()

    try:
        async with httpx.AsyncClient(timeout=config.TIMEOUT, follow_redirects=False) as client:
            resp = await client.request(
                method=request.method,
                url=full_url,
                headers=headers,
                params=dict(request.query_params),
                content=body,
                cookies=request.cookies
            )
    except httpx.RequestError as e:
        return Response(content=f"Proxy connection error: {e}", status_code=502)

    # Token capture (if backend returns JSON with 'token')
    content_type = resp.headers.get('Content-Type', '')
    if resp.status_code == 200 and 'application/json' in content_type:
        try:
            data = resp.json()
            if isinstance(data, dict) and isinstance(data.get('token'), str):
                new_token = data['token']
                async with _token_lock:
                    if TOKEN_ != new_token:
                        TOKEN_ = new_token
                        print(f"AUTH: Real token CAPTURED from '{rest}': {TOKEN_[:10]}...")
        except json.JSONDecodeError:
            pass

    rewritten_content = token_injection_and_url_rewrite(resp.content, content_type, TOKEN_)
    excluded = {'content-encoding', 'content-length', 'transfer-encoding', 'connection'}
    out_headers = {k: v for k, v in resp.headers.items() if k.lower() not in excluded}
    return Response(content=rewritten_content, status_code=resp.status_code, headers=out_headers)
