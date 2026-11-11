#!/bin/sh
# Rebuild the single-file app (index.html) from src/. Needs Node and the material-next skill bundler.
set -e
cd "$(dirname "$0")"
node "${MN_BUNDLER:-$HOME/.claude/skills/material-next/scripts/mn.mjs}" bundle src/index.html > index.html
echo "Built index.html"
