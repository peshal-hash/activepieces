#!/bin/sh

# Exit immediately if a command exits with a non-zero status.
set -e

# Set default values if not provided
export AP_APP_TITLE="${AP_APP_TITLE:-SalesOptAi}"
export AP_FAVICON_URL="${AP_FAVICON_URL:-statics/favicon.png}"

# Debug: Print environment variables
echo "AP_APP_TITLE: $AP_APP_TITLE"
echo "AP_FAVICON_URL: $AP_FAVICON_URL"

# Process environment variables in index.html BEFORE starting services
envsubst '${AP_APP_TITLE} ${AP_FAVICON_URL}' < /usr/share/nginx/html/index.html > /usr/share/nginx/html/index.html.tmp && \
mv /usr/share/nginx/html/index.html.tmp /usr/share/nginx/html/index.html


# Start Nginx server in the background
nginx -g "daemon off;" &

# Start backend server in the background
node --enable-source-maps dist/packages/server/api/main.js &


# --- Start Python Proxy Application ---
echo "Starting Python Proxy Application..."
# Navigate to the Python app directory.
cd /usr/src/app/python-app
# Start the Python Uvicorn server in the FOREGROUND.
# 'exec' replaces the shell process with this one, making it the main process
# that keeps the container running.
exec python3 app.py

