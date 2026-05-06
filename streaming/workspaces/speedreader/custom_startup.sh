#!/usr/bin/env bash
# Called by XFCE autostart after the desktop is ready.
# Installs deps if needed, starts Expo dev server, opens browser to preview.

WORKSPACE=/home/kasm-user/workspace
APP_PORT=8081

# Write a loading page to disk
cat > /tmp/loading.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#0d0d0d; color:#e8e8e8;
    font-family:-apple-system,BlinkMacSystemFont,sans-serif;
    display:flex; align-items:center; justify-content:center;
    height:100vh; flex-direction:column; gap:16px; }
  .dot { width:10px; height:10px; border-radius:50%; background:#6c63ff;
    display:inline-block; margin:0 4px; animation:b 1.2s infinite both; }
  .dot:nth-child(2){animation-delay:.2s} .dot:nth-child(3){animation-delay:.4s}
  @keyframes b{0%,80%,100%{opacity:.2}40%{opacity:1}}
  p { font-size:.9rem; color:#555; }
</style>
</head>
<body>
  <div><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
  <p id="msg">Starting app…</p>
  <script>
    setInterval(() => {
      fetch("http://localhost:8081")
        .then(() => { location = "http://localhost:8081"; })
        .catch(() => {});
    }, 2000);
  </script>
</body>
</html>
EOF

# Find an available browser
BROWSER=$(command -v firefox || command -v chromium-browser || command -v chromium || echo "")

# Open loading page immediately so the desktop is covered
if [ -n "$BROWSER" ]; then
  "$BROWSER" --kiosk "file:///tmp/loading.html" &>/dev/null &
fi

# Start Expo if the repo is mounted
if [ -f "$WORKSPACE/package.json" ]; then
  cd "$WORKSPACE"

  # Install dependencies on first run (repo cloned but npm install not yet run)
  if [ ! -d "node_modules" ]; then
    npm install &>/tmp/npm-install.log
  fi

  npm run web -- --port $APP_PORT &>/tmp/expo.log &
fi
