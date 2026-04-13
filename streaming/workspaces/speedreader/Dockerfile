# SpeedReader — Browser-only KASM Workspace
#
# Streams Expo web preview in a browser, fullscreen, no VS Code.
# Mount the repo at /home/kasm-user/workspace via docker run -v.

ARG BASE_TAG="1.18.0-rolling-daily"
FROM kasmweb/vs-code:$BASE_TAG
USER root

ENV HOME=/home/kasm-default-profile
ENV STARTUPDIR=/dockerstartup

# Install Node 20 — use the base image's existing browser (Firefox)
RUN apt-get update && apt-get install -y --no-install-recommends curl git ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g expo-cli

COPY custom_startup.sh $STARTUPDIR/custom_startup.sh
RUN chmod 755 $STARTUPDIR/custom_startup.sh

# System-wide XFCE autostart — /etc/xdg/autostart is read by XFCE for all
# users and does not depend on KASM's user-profile copy mechanism.
RUN mkdir -p /etc/xdg/autostart
COPY app-startup.desktop /etc/xdg/autostart/speedreader.desktop

RUN chown 1000:0 $HOME
RUN $STARTUPDIR/set_user_permission.sh $HOME

ENV HOME=/home/kasm-user
WORKDIR $HOME
RUN mkdir -p $HOME && chown -R 1000:0 $HOME

USER 1000
