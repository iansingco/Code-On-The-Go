# SpeedReader — Browser-only KASM Workspace
#
# Streams Expo web preview in Chromium fullscreen.
# The coding happens on the host PC; this is just the live preview.
# Mount the repo at /home/kasm-user/workspace via docker-compose volume.
# The startup script runs: npm run web  and opens Chromium to localhost:8081.

ARG BASE_TAG="1.18.0-rolling-daily"
FROM kasmweb/core-ubuntu-jammy:$BASE_TAG
USER root

ENV HOME=/home/kasm-default-profile
ENV STARTUPDIR=/dockerstartup

# Install Node 20 + Chromium
RUN apt-get update && apt-get install -y --no-install-recommends curl git ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs chromium-browser \
    && rm -rf /var/lib/apt/lists/*

# Pre-install Expo CLI globally so first run is fast
RUN npm install -g expo-cli

# Auto-start: npm run web + Chromium fullscreen
COPY custom_startup.sh $STARTUPDIR/custom_startup.sh
RUN chmod 755 $STARTUPDIR/custom_startup.sh

RUN chown 1000:0 $HOME
RUN $STARTUPDIR/set_user_permission.sh $HOME

ENV HOME=/home/kasm-user
WORKDIR $HOME
RUN mkdir -p $HOME && chown -R 1000:0 $HOME

USER 1000
