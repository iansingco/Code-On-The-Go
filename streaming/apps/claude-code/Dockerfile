# Claude Code — Neko streaming container
# Streams a terminal running Claude Code directly to a browser tab via WebRTC.
#
# The ANTHROPIC_API_KEY must be passed via docker-compose environment or .env

FROM ghcr.io/m1k1o/neko/base:latest

# Install Node.js 20, git, and a lightweight terminal (xterm)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    xterm \
    ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code globally
RUN npm install -g @anthropic-ai/claude-code

# Workspace directory (mount your project here via docker-compose volume)
RUN mkdir -p /workspace

# Start script: opens xterm and drops into claude
COPY start.sh /usr/local/bin/start-claude
RUN chmod +x /usr/local/bin/start-claude

# neko will launch this as the streaming app
ENV NEKO_APP="/usr/local/bin/start-claude"
