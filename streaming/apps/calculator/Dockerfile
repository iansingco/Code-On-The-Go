# Calculator — single-app neko streaming container
#
# Streams galculator (a GTK calculator) fullscreen to the browser.
# Template: to stream any other Linux GUI app, just swap the apt package
# and the NEKO_APP value.
#
# Other ideas:
#   kolourpaint  → paint/drawing app  (NEKO_APP: "kolourpaint")
#   gedit        → text editor        (NEKO_APP: "gedit")
#   vlc          → media player       (NEKO_APP: "vlc")
#   chromium     → browser            (use ghcr.io/m1k1o/neko/chromium instead)

FROM ghcr.io/m1k1o/neko/base:latest

RUN apt-get update && apt-get install -y --no-install-recommends \
    galculator \
    && rm -rf /var/lib/apt/lists/*

ENV NEKO_APP="galculator"
