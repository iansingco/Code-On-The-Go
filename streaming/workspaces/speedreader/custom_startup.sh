#!/usr/bin/env bash
# Runs when the KASM session starts.
# Starts the Expo dev server then opens Chromium fullscreen to the preview.

WORKSPACE=/home/kasm-user/workspace

# Start Expo web server in the background (only if repo is mounted)
if [ -f "$WORKSPACE/package.json" ]; then
  cd "$WORKSPACE"
  npm run web -- --port 8081 &>/tmp/expo.log &
fi

# Wait for the server to be ready (up to 45s)
for i in $(seq 1 45); do
  sleep 1
  curl -sf http://localhost:8081 -o /dev/null 2>/dev/null && break
done

# Find Chromium — path varies by base image
CHROMIUM=$(command -v chromium-browser || command -v chromium || command -v google-chrome || echo "")

if [ -n "$CHROMIUM" ]; then
  "$CHROMIUM" \
    --no-sandbox \
    --disable-gpu \
    --kiosk \
    --app=http://localhost:8081 &
fi
