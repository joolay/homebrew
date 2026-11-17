#!/usr/bin/env bash
# Reproduces the webOS 4.0 blocker: can the Stremio core (WASM) be converted to
# plain JS for Chromium 53? Usage: scripts/probe-core-wasm.sh path/to/stremio_core_web_bg.wasm
set -euo pipefail
W=${1:?path to stremio_core_web_bg.wasm}
D=$(mktemp -d); cd "$D"; npm init -y >/dev/null; npm i binaryen@123 >/dev/null 2>&1
echo "wasm size: $(stat -c%s "$W") bytes"
node_modules/binaryen/bin/wasm-dis "$W" | grep -E '^\s*\(table \$' || true
node_modules/binaryen/bin/wasm2js "$W" -O -o core.asm.js || echo "wasm2js FAILED (expected: multiple tables / externref)"
