#!/usr/bin/env bash
# Rebuilds the Nasdaq Signal Board from the latest daily prices.
# Usage: ./update.sh <output.html> [--standalone]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
git clone -q --depth 1 --filter=blob:none --sparse https://github.com/yennanliu/finance_data.git "$WORK/src"
git -C "$WORK/src" sparse-checkout set data/prices
node "$HERE/build.js" "$WORK/src/data/prices" "$WORK/data.json"
node "$HERE/assemble.js" "$HERE/template.html" "$HERE/engine.js" "$WORK/data.json" "$1" ${2:-}
rm -rf "$WORK"
