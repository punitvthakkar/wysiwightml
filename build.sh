#!/bin/sh
# Rebuild the single-file app (index.html) from src/. Needs Node and the material-next skill bundler.
# Icons and the web manifest are copied next to it, because browsers fetch them as separate files.
set -e
cd "$(dirname "$0")"
node "${MN_BUNDLER:-$HOME/.claude/skills/material-next/scripts/mn.mjs}" bundle src/index.html > index.html
rm -rf icons && cp -R src/icons icons
cp src/manifest.webmanifest manifest.webmanifest
echo "Built index.html"
