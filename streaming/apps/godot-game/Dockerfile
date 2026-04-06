# Godot Game — Neko streaming container
# Streams a running Godot game directly to a browser tab via WebRTC.
# Mount your Godot project at /app/game via docker-compose volume.
#
# To use the Godot editor instead, set NEKO_APP to:
#   godot --editor --path /app/game

FROM ghcr.io/m1k1o/neko/base:latest

# Install Godot 4 (headless export template + display runtime)
# Replace the URL with the version you need from godotengine.org/download
ARG GODOT_VERSION=4.3
ARG GODOT_URL="https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}-stable/Godot_v${GODOT_VERSION}-stable_linux.x86_64.zip"

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    unzip \
    libgl1 \
    libegl1 \
    libxrandr2 \
    libpulse0 \
    && curl -L "${GODOT_URL}" -o /tmp/godot.zip \
    && unzip /tmp/godot.zip -d /tmp/godot \
    && mv /tmp/godot/Godot_v${GODOT_VERSION}-stable_linux.x86_64 /usr/local/bin/godot \
    && chmod +x /usr/local/bin/godot \
    && rm -rf /tmp/godot /tmp/godot.zip \
    && rm -rf /var/lib/apt/lists/*

# Game project goes here (mounted via docker-compose)
RUN mkdir -p /app/game

# Run the game — switch to --editor for the Godot editor
ENV NEKO_APP="bash -c 'godot --path /app/game 2>/dev/null'"
