# Stremio for webOS 4.0 (LG UK6300PVB) — feasibility notes

Status: **no working build yet.** This repo currently holds research findings only.

## What I checked
- `kieranbrown/stremio-webos` (Theater frontend + official streaming server, webOS 5+ only; its README says webOS 4.x is unsupported).
- Official `Stremio/stremio-web` v5.1.0 (installs and builds with Node 22 / pnpm 11).

## Why webOS 4.0 is hard
| Piece | webOS 4.0 (2018, UK6300) | Stremio needs |
|---|---|---|
| Web engine | Chromium 53 | Chromium 57+ for WebAssembly |
| Service runtime | Node.js 0.12 | Node 8+ (streaming server) |

1. **WebAssembly**: `stremio_core_web_bg.wasm` (5.5 MB) is the app's core. Chromium 53 cannot run it.
2. **WASM→JS fallback**: `wasm2js` (binaryen 123) refuses the module: *"modules with multiple tables are not supported"* (wasm-bindgen's externref table). Even if worked around, the result would be tens of MB of JS on a 2018 TV SoC — likely unusably slow. Reproduce with `scripts/probe-core-wasm.sh`.
3. **Streaming server**: the bundled server cannot run on Node 0.12, so it must live off-TV (PC/NAS/Docker) anyway.

## Realistic options
- Run the streaming server elsewhere and use an external device (Fire Stick/Chromecast) or cast to the TV.
- Experimental: hand-patch the wasm to drop the externref table, then wasm2js + Babel/core-js for Chrome 53 (low odds, unverifiable without the TV).
- Improve the webOS 5+ build instead.

## Update: WASM-patching attempt (frontend-only scope; server dropped, Umbrel server assumed)
Removing the server doesn't remove the blocker — the frontend core itself is WASM.
Tried: rewrite `stremio_core_web_bg.wasm` so the externref table becomes three imported JS functions
(`table.get/set/grow $1` → `call`; only 54/47/1 uses, so this part is easy and the patched module validates and assembles).
Then `wasm2js --all-features` (binaryen 123) fails inside its own lowering with validator errors
(`local.set's value type must be correct` without `-O`; `i64 != i32` with `-O`) — remaining 188 `externref`
locals/params are the likely cause. Output file was empty. Next steps if continued: also lower externref locals to i32
handles (rewrite in WAT), then retry; and even on success expect a very large, slow asm.js blob on a 2018 TV.
