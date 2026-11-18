#!/bin/sh
# Serves this folder the same way GitHub Pages would (garden/ is the site root).
# Open http://localhost:8137/
cd "$(dirname "$0")" && exec python3 -I tools/devserver.py "$PWD" "${PORT:-8137}"
