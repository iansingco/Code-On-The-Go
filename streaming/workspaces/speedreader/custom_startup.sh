#!/usr/bin/env bash
# Runs when the KASM session starts.
# Starts the Expo dev server then opens Chromium fullscreen to the preview.

WORKSPACE=/home/kasm-user/workspace

# Start Expo web server in the background
if [ -f "$WORKSPACE/package.json" ]; then
  cd "$WORKSPACE"
  npm run web -- --port 8081 &>/tmp/expo.log &
fi

# Wait for the server to be ready (up to 30s)
for i in $(seq 1 30); do
  sleep 1
  curl -sf http://localhost:8081 -o /dev/null 2>/dev/null && break
done

# Open Chromium fullscreen (kiosk mode, no chrome UI)
chromium-browser \
  --no-sandbox \
  --disable-gpu \
  --kiosk \
  --app=http://localhost:8081 &
