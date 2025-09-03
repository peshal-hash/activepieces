import requests
import re
import asyncio
import json
import socketio
from fastapi import APIRouter, Request, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import Response, JSONResponse
from bs4 import BeautifulSoup
from typing import Optional
from pydantic import BaseModel
from urllib.parse import urlencode

# In a real app, these would be imported from their respective modules
from ..core import config
from ..services import activepieces_service
from ..database_management import db_manager
# The following imports are based on the modular structure we discussed.
# You would create these files to hold the corresponding logic.
# from ..main import db_manager # Or from a dedicated services.database file
# from ..core import config, state
# from ..services import activepieces_service, html_rewriter

# For demonstration, I am including the necessary helper classes and functions
# that would normally be in separate files.

from typing import Optional
from pydantic import BaseModel
import asyncio
import websockets
import json
from typing import Dict, Optional
import threading
from concurrent.futures import ThreadPoolExecutor

class WorkflowPayload(BaseModel):
    email: str
    password: str
    firstName: Optional[str] = "Workflow"
    lastName: Optional[str] = "User"

def token_injection_and_url_rewrite(content, content_type, token_to_inject):
    # This function remains useful for rewriting URLs in the main HTML/JS files
    base_url_to_replace = config.AP_PROXY_URL
    new_base_url = config.AP_FRONTEND_URL

    if 'text' in content_type or 'javascript' in content_type or 'json' in content_type:
        try: content_str = content.decode('utf-8')
        except (UnicodeDecodeError, AttributeError): content_str = content

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

# --- Router Definition ---
router = APIRouter()

TOKEN_ = ""

# --- API Endpoints ---
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
    TOKEN_ = token
    print(f"AUTH: Token obtained and set globally: {TOKEN_[:10]}...")
    return JSONResponse(content={'success': True, 'redirectUrl': config.AP_PROXY_URL})
# 1. Specific Webhook Handler (HTTP/S)

# 1. Specific Webhook Handler (HTTP/S)
@router.api_route("/v1/webhooks/{rest_of_path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def v1_webhook_handler(request: Request, rest_of_path: str):
    print("\n✅ --- HTTP Webhook Intercepted! --- ✅")
    body = await request.body()
    print(f"PATH: /v1/webhooks/{rest_of_path}, METHOD: {request.method}")
    print("FORWARDING to backend...")

    full_url = f"{config.AP_BASE}/v1/webhooks/{rest_of_path}"
    headers_to_forward = {k: v for k, v in request.headers.items() if k.lower() not in ['host']}

    try:
        resp = requests.request(
            method=request.method, url=full_url, headers=headers_to_forward,
            params=request.query_params, data=body, timeout=config.TIMEOUT
        )
        print(f"BACKEND RESPONSE: Status {resp.status_code}")
        excluded_headers = ['content-encoding', 'content-length', 'transfer-encoding', 'connection']
        response_headers = {k: v for k, v in resp.headers.items() if k.lower() not in excluded_headers}
        return Response(content=resp.content, status_code=resp.status_code, headers=response_headers)
    except requests.exceptions.RequestException as e:
        return Response(content=f"Proxy connection error on webhook: {e}", status_code=502)

# 2. WebSocket Proxy
@router.websocket("/{rest:path}")
async def websocket_proxy(websocket: WebSocket, rest: str):
    await websocket.accept()
    # A new, isolated client is created for every browser connection.
    sio_client = socketio.AsyncClient()
    to_browser_queue = asyncio.Queue()

    @sio_client.event
    async def connect():
        print("SIO Client: Successfully connected to Activepieces backend.")
    @sio_client.event
    async def disconnect():
        print("SIO Client: Disconnected from Activepieces backend.")
        await to_browser_queue.put(None)
    @sio_client.on('*')
    async def catch_all(event, data):
        message = f'42{json.dumps([event, data])}'
        print(f"  SIO MSG [Server -> Proxy]: {message[:150]}")
        await to_browser_queue.put(message)

    try:
        # The captured token is sent in the 'auth' object, as required by the backend.
        auth_payload = {'token': TOKEN_} if TOKEN_ else None
        print(f"SIO Client: Attempting to connect to backend at {config.AP_BASE} with token {'YES' if TOKEN_ else 'NO'}")

        await sio_client.connect(
            config.AP_BASE,
            auth=auth_payload,
            socketio_path="/api/socket.io",
            transports=['websocket'] # Force WebSocket transport as required by backend
        )

        async def forward_to_backend():
            try:
                while True:
                    raw_message = await websocket.receive_text()
                    print(f"  Raw MSG [Client -> Proxy]: {raw_message[:150]}")
                    if raw_message.startswith('42'): # Standard Socket.IO message
                        msg = json.loads(raw_message[2:])
                        await sio_client.emit(msg[0], msg[1] if len(msg) > 1 else None)
                    elif raw_message == '2': # Ping from browser
                        await to_browser_queue.put('3') # Respond with Pong
            except WebSocketDisconnect:
                print("Browser disconnected.")
            finally:
                await to_browser_queue.put(None)

        async def forward_to_browser():
            while True:
                message = await to_browser_queue.get()
                if message is None: break
                await websocket.send_text(message)

        # Run both forwarders concurrently until one closes the connection
        done, pending = await asyncio.wait(
            [forward_to_backend(), forward_to_browser()],
            return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending: task.cancel()

    except socketio.exceptions.ConnectionError as e:
        print(f"SIO Client Connection Error: {e}")
    except Exception as e:
        print(f"WebSocket proxy error: {e}")
    finally:
        if sio_client.connected:
            await sio_client.disconnect()
        # This check is now corrected to properly inspect the connection state.
        if websocket.client_state.name != 'DISCONNECTED':
            await websocket.close()
        print("WebSocket proxy connection closed and cleaned up.")

# 3. Generic HTTP Proxy (Catch-All) with Token Interception
@router.api_route("/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def ap_proxy(request: Request, rest: str = ""):
    global TOKEN_
    full_url = f"{config.AP_BASE}/{rest}"
    headers = {k: v for k, v in request.headers.items() if k.lower() not in ['host']}

    if TOKEN_:
        headers['Authorization'] = f"Bearer {TOKEN_}"

    try:
        body = await request.body()
        resp = requests.request(
            method=request.method, url=full_url, headers=headers, data=body,
            cookies=request.cookies, params=request.query_params,
            allow_redirects=False, timeout=config.TIMEOUT
        )
    except requests.exceptions.RequestException as e:
        return Response(content=f"Proxy connection error: {e}", status_code=502)

    # ** THE FIX IS HERE: More aggressive token capture **
    # Inspect every successful JSON response for a token.
    content_type = resp.headers.get('Content-Type', '')
    if resp.status_code == 200 and 'application/json' in content_type:
        try:
            data = resp.json()
            if 'token' in data and isinstance(data['token'], str):
                new_token = data['token']
                if TOKEN_ != new_token:
                    TOKEN_ = new_token
                    print(f"AUTH: Real token CAPTURED from '{rest}': {TOKEN_[:10]}...")
        except json.JSONDecodeError:
            pass # Response was not valid JSON, ignore.

    rewritten_content = token_injection_and_url_rewrite(resp.content, content_type, TOKEN_)
    excluded_headers = ['content-encoding', 'content-length', 'transfer-encoding', 'connection']
    response_headers = {k: v for k, v in resp.headers.items() if k.lower() not in excluded_headers}
    return Response(content=rewritten_content, status_code=resp.status_code, headers=response_headers)

