# Claude Code — KASM Workspace Image
#
# Streams a terminal running Claude Code via the KASM platform.
# Register this image in KASM admin panel → Workspaces → Add Workspace.
#
# Build:
#   docker build -t claude-code-workspace .
#
# Test standalone (no KASM install needed):
#   docker run --rm -it --shm-size=512m -p 6901:6901 \
#     -e VNC_PW=password \
#     -e ANTHROPIC_API_KEY=sk-ant-... \
#     claude-code-workspace
#   → open https://localhost:6901  (user: kasm_user  password: password)

ARG BASE_TAG="latest"
ARG BASE_IMAGE="core-ubuntu-jammy"
FROM kasmweb/$BASE_IMAGE:$BASE_TAG
USER root

ENV HOME=/home/kasm-default-profile
ENV STARTUPDIR=/dockerstartup
WORKDIR $HOME

# Install Node.js 20, git, and Claude Code
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

# Workspace directory (persistent if KASM profile storage is configured)
RUN mkdir -p $HOME/workspace && chown 1000:1000 $HOME/workspace

# Startup script — launches terminal with claude on session start
COPY custom_startup.sh $STARTUPDIR/custom_startup.sh
RUN chmod 755 $STARTUPDIR/custom_startup.sh

# Single-app XFCE layout: no taskbar, minimal chrome, app fills screen
RUN cp $HOME/.config/xfce4/xfconf/single-application-xfce-perchannel-xml/* \
       $HOME/.config/xfce4/xfconf/xfce-perchannel-xml/ \
    && apt-get remove -y xfce4-panel 2>/dev/null || true

RUN chown 1000:0 $HOME
RUN $STARTUPDIR/set_user_permission.sh $HOME

ENV HOME=/home/kasm-user
WORKDIR $HOME
RUN mkdir -p $HOME && chown -R 1000:0 $HOME

USER 1000
