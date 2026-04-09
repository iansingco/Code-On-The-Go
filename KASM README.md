# Godot Game Streaming Launcher (Kasm Workspaces)

## Goal
Self-hosted game/app streaming. Kasm streams a containerized Godot game or editor directly to a phone browser tab — no desktop, no app install, just a URL. Accessed over Tailscale from anywhere.

---

## How It Works
- **Kasm Workspaces CE** manages and streams containerized apps to the browser via WebRTC
- **Tailscale** handles remote access (already set up externally)
- On your phone: open `https://[tailscale-ip]` → log in → tap app → streams fullscreen instantly

---

## Server Setup (One Time)

```bash
curl -O https://kasm-releases.s3.amazonaws.com/1.16.0/kasm_release_1.16.0.tar.gz
tar -xf kasm_release_1.16.0.tar.gz
sudo bash kasm_release/install.sh
```

Kasm installs itself and manages Docker internally. Runs on port 443 (HTTPS). Self-signed cert by default — browser will warn on first visit, click through or add a real cert later.

---

## File Structure
```
/streaming
  Dockerfile.godot-game      # Kasm base image + Godot + your game
  Dockerfile.godot-editor    # Kasm base image + Godot editor
  apps/
    godot-game/              # game project files
```

---

## Dockerfile.godot-game

Build a custom Kasm workspace image that launches straight into your game.

```dockerfile
FROM kasmweb/core-ubuntu-focal:1.16.0

USER root

# Install Godot (update version URL as needed)
RUN apt-get update && apt-get install -y wget unzip && \
    wget https://downloads.tuxfamily.org/godotengine/4.x/Godot_v4.x-stable_linux.x86_64.zip && \
    unzip Godot_v4.x-stable_linux.x86_64.zip -d /usr/local/bin/ && \
    mv /usr/local/bin/Godot_v4.x-stable_linux.x86_64 /usr/local/bin/godot && \
    chmod +x /usr/local/bin/godot

# Copy game files
COPY apps/godot-game /app/game

# Kasm launches this app directly — no desktop shown
ENV KASM_APP="/usr/local/bin/godot --path /app/game"

USER 1000
```

## Dockerfile.godot-editor

```dockerfile
FROM kasmweb/core-ubuntu-focal:1.16.0

USER root

RUN apt-get update && apt-get install -y wget unzip && \
    wget https://downloads.tuxfamily.org/godotengine/4.x/Godot_v4.x-stable_linux.x86_64.zip && \
    unzip Godot_v4.x-stable_linux.x86_64.zip -d /usr/local/bin/ && \
    mv /usr/local/bin/Godot_v4.x-stable_linux.x86_64 /usr/local/bin/godot && \
    chmod +x /usr/local/bin/godot

COPY apps/godot-game /app/game

ENV KASM_APP="/usr/local/bin/godot --editor --path /app/game"

USER 1000
```

---

## Registering Apps in Kasm Admin

After building images:

1. Go to `https://[server-ip]/#/workspaces` (admin login)
2. Add Workspace → Custom Image
3. Point to your built Docker image name
4. Set name, icon, description
5. Save — appears in launcher for any user

---

## CI/CD Hook (add later)

On GitHub push, SSH into server and run:
```bash
cd /streaming
git pull
docker build -t godot-game -f Dockerfile.godot-game .
# Kasm will use the updated image on next session launch
```

---

## Day-to-Day Flow

```
Claude Code edits Godot project → push to GitHub
→ server pulls + rebuilds image
→ pick up phone
→ open browser: https://[tailscale-ip]
→ log in → tap "My Game"
→ game streams fullscreen in browser tab
→ test, close tab
```

---

## Notes for Claude Code
- Check latest Kasm release at kasm.com/downloads and update the install URL accordingly
- Kasm base images are at hub.docker.com/u/kasmweb — use `core-ubuntu-focal` for app streaming
- `KASM_APP` env var tells Kasm what to launch — no desktop shown, just that app fullscreen
- Port 443 must be open on the server firewall
- Tailscale IP is stable so no dynamic DNS needed
- Self-signed cert warning on first browser visit is normal — click through or set up Let's Encrypt later
- 5 concurrent session limit on CE is irrelevant for solo use
