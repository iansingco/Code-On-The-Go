#!/usr/bin/env bash
# Runs inside the KASM session after the desktop starts.
# Opens a terminal that auto-launches Claude Code in ~/workspace.

xfce4-terminal \
  --title="Claude Code" \
  --geometry=220x55 \
  -e "bash -c '
    cd ~/workspace
    echo -e \"\033[1;36m── Claude Code ──────────────────────────────\033[0m\"
    echo -e \"\033[0;90mWorkspace: ~/workspace\033[0m\"
    echo \"\"
    claude
    echo \"\"
    echo -e \"\033[0;90mClaude exited. Shell is open — type exit to close.\033[0m\"
    exec bash
  '" &
