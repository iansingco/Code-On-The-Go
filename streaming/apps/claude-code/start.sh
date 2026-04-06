#!/bin/bash
# Start a terminal with Claude Code in the workspace.
# If claude exits (e.g. /exit), the terminal stays open as a plain shell.
exec xterm \
  -fa "Monospace" \
  -fs 13 \
  -bg "#0d0d0d" \
  -fg "#e8e8e8" \
  -title "Claude Code" \
  -e bash -c '
    cd /workspace
    export TERM=xterm-256color
    echo -e "\033[1;36m── Claude Code ──────────────────────────────\033[0m"
    echo -e "\033[0;90mWorkspace: /workspace\033[0m"
    echo ""
    claude
    echo ""
    echo -e "\033[0;90mClaude exited. You are in a shell. Type '\''exit'\'' to quit.\033[0m"
    exec bash
  '
