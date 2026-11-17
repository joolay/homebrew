# JoolzTV for LG webOS

Homebrew Channel repository for the **JoolzTV launcher**, a tiny app that opens your JoolzTV server on an older LG TV (tested target: 2018 UK6300PVB, webOS 4.0, Chromium 53).

**Add this repository in Homebrew Channel:**
```
https://raw.githubusercontent.com/joolay/homebrew/main/webosbrew/apps.json
```

## How it works
The interface (Apple TV style glass design, profiles, player, sources) is **not** inside this app. It lives in the JoolzTV Umbrel app
([joolay/umbrel-apps](https://github.com/joolay/umbrel-apps), `src/joolztv/`). This launcher only:
1. tries your **home address** first (`http://umbrel.local:3901` by default), then your **public address** (`https://joolztv.macaw-chroma.ts.net`),
2. checks the server answers (`/healthz`), and
3. opens it with `?tv=1`, so the server hands the TV the **old-browser (Chromium 53) build** of the interface.

So design changes and new features arrive by updating the Umbrel app; the TV app rarely changes. First run on a new household shows a wizard: sign in with a JoolzApp account,
add the other household members (one JoolzApp account each, up to 12 profiles), then pick who is watching. Sign-ins last 90 days since you last used the app.

- Change the addresses: hold the **Red** button while the splash shows, or choose *Change addresses* on the "Can't reach JoolzTV" screen. Back exits.
- If only the public address fails with a secure-connection error, an older TV may not trust its certificate: use the home address (use the Umbrel's IP if `umbrel.local` doesn't resolve on the TV).
- Install: Homebrew Channel (repository above), or `ares-install dist/io.stremio.flix.tv_2.0.0_all.ipk` (app id `io.stremio.flix.tv`, unchanged so it upgrades in place).

## This repo
- `app-flix/`: the launcher (one `index.html`, icons, `appinfo.json`).
- `webosbrew/`: Homebrew Channel files. `dist/`: the IPK. `.github/workflows/release.yml`: builds a release IPK on a `v*` tag.
- `docs/`: design notes (`PLAN-thin-tv-wrapper.md`) and why modern Stremio Web can't run on webOS 4 (`NOTES-modern-stremio-web.md`).
