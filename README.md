# Stremio (Legacy 4.4) for webOS 4.0

Frontend-only Stremio for older LG TVs (tested target: 2018 UK6300PVB, webOS 4.0, Chromium 53).

**Why 4.4?** Current Stremio Web needs WebAssembly (Chromium 57+). The legacy Stremio 4.4 web shell is plain
AngularJS/JavaScript, so it runs on Chromium 53 with a few small polyfills. It still talks to the live Stremio API,
so your account, library and addons work. See `docs/NOTES-modern-stremio-web.md` for why modern builds can't run.

**No server is bundled.** Playback uses your own streaming server (e.g. Umbrel's Stremio app).

## What's changed vs. upstream 4.4 (`app.strem.io/shell-v4.4`)
- Bundled locally (stable, can't break when the website changes; no remote loading).
- `polyfills.js`: Object.values/entries, padStart, flat, Promise.finally, AbortController, etc. for Chromium 53.
- `config.js`: default streaming-server URL (edit before packaging, or change in-app: Settings → Streaming server).
- `tv.js`: remote Back button (key 461) → history back; TV zoom (default 150%, set in `config.js`; Red = smaller, Green = larger, Yellow = reset, remembered).
- `calendar-fallback.css`: flexbox fallback for the one CSS-grid screen (calendar).

## Install
Prebuilt IPK: `dist/io.stremio.legacy.tv_1.0.3_all.ipk`
```sh
npm i -g @webos-tools/cli@3.2.6
ares-setup-device                       # add your TV (Developer Mode app on the TV)
ares-install --device tv dist/io.stremio.legacy.tv_1.0.3_all.ipk
ares-launch  --device tv io.stremio.legacy.tv
```
Or with Homebrew Channel (rooted TV): install the IPK from the release / add this repository URL in Homebrew Channel settings: `https://raw.githubusercontent.com/joolay/homebrew/main/webosbrew/apps.json`

## Configure your Umbrel server
Edit `app/config.js` (`http://<umbrel-ip>:11470`), then `ares-package --no-minify app -o dist`.
Use the Umbrel's **IP address** if `umbrel.local` (mDNS) doesn't resolve on the TV.

## Known limits (untested on real hardware — please report)
- Smoke-tested only in desktop Chromium; not yet on a real UK6300PVB.
- HEVC/AC3 support depends on the TV; the Umbrel server can transcode if enabled.
- Stremio 4.4 is unmaintained upstream; new features of Stremio 5 aren't available.
