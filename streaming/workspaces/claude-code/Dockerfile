# Claude Code — KASM Workspace Image (standalone mode)
#
# Run standalone (no KASM platform needed):
#   docker compose up -d --build claude-code
#   Open https://<ip>:6902
#   Username: kasm_user   Password: value of KASM_PASSWORD in .env

ARG BASE_TAG="latest"
ARG BASE_IMAGE="core-ubuntu-jammy"
FROM kasmweb/$BASE_IMAGE:$BASE_TAG
USER root

ENV HOME=/home/kasm-default-profile
ENV STARTUPDIR=/dockerstartup
WORKDIR $HOME

# Install Node.js 20 + git + Claude Code
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl git ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

# Workspace dir — mounted via docker-compose volume
RUN mkdir -p $HOME/workspace && chown 1000:1000 $HOME/workspace

# Auto-start: open terminal with claude on session launch
COPY custom_startup.sh $STARTUPDIR/custom_startup.sh
RUN chmod 755 $STARTUPDIR/custom_startup.sh

# Single-app XFCE layout (no taskbar)
RUN cp $HOME/.config/xfce4/xfconf/single-application-xfce-perchannel-xml/* \
       $HOME/.config/xfce4/xfconf/xfce-perchannel-xml/ \
    && apt-get remove -y xfce4-panel 2>/dev/null || true

RUN chown 1000:0 $HOME
RUN $STARTUPDIR/set_user_permission.sh $HOME

ENV HOME=/home/kasm-user
WORKDIR $HOME
RUN mkdir -p $HOME && chown -R 1000:0 $HOME

USER 1000
