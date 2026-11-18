#!/bin/sh
# Serves the codegarden folder (so the prototype can read ../blakkis sources).
# Open http://localhost:8137/garden/
cd "$(dirname "$0")/.." && exec python3 -I garden/tools/devserver.py "$PWD" "${PORT:-8137}"
