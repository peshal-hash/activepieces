#!/bin/sh

# Exit immediately if a command exits with a non-zero status.
set -e

# Set default values if not provided
export AP_APP_TITLE="${AP_APP_TITLE:-NexOpta}"
export AP_FAVICON_URL="${AP_FAVICON_URL:-statics/favicon.png}"

# Debug: Print environment variables
echo "AP_APP_TITLE: $AP_APP_TITLE"
echo "AP_FAVICON_URL: $AP_FAVICON_URL"

# Process environment variables in index.html BEFORE starting services
envsubst '${AP_APP_TITLE} ${AP_FAVICON_URL}' < /usr/share/nginx/html/index.html > /usr/share/nginx/html/index.html.tmp && \
mv /usr/share/nginx/html/index.html.tmp /usr/share/nginx/html/index.html


# Start Nginx server in the background
nginx -g "daemon off;" &

AP_ENTRY="dist/packages/server/api/main.js"
if [ ! -f "$AP_ENTRY" ] && [ -f "dist/packages/server/api/main.cjs" ]; then
  AP_ENTRY="dist/packages/server/api/main.cjs"
fi
echo "Starting Activepieces backend: $AP_ENTRY"
node --enable-source-maps "$AP_ENTRY" &
NODE_PID=$!

echo "Waiting for Activepieces backend on :3000..."
AP_READY=0
i=1
while [ "$i" -le 180 ]; do
  if ! kill -0 "$NODE_PID" 2>/dev/null; then
    echo "Activepieces backend died during startup (entry: $AP_ENTRY)."
    exit 1
  fi
  if curl -fsS http://127.0.0.1:3000/v1/flags >/dev/null 2>&1; then
    AP_READY=1
    echo "Activepieces backend is ready after ${i}s."
    break
  fi
  sleep 1
  i=$((i + 1))
done

if [ "$AP_READY" -ne 1 ]; then
  echo "Activepieces backend did not become ready within 180s (entry: $AP_ENTRY)."
  exit 1
fi


# --- Start Python Proxy Application ---
echo "Starting Python Proxy Application..."
# Navigate to the Python app directory.
cd /usr/src/app/python-app
# Start the Python Uvicorn server in the FOREGROUND.
# 'exec' replaces the shell process with this one, making it the main process
# that keeps the container running.
exec python3 app.py

