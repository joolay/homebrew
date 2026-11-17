# Plan: thin TV wrapper + single JoolzFlix codebase (NOT built yet)

Status: **BUILT (2026-11-17)** - see "Build summary" at the end. Originally written as notes before building.

## Decision
Make the webOS TV app a tiny launcher. The whole interface (browse, details, player, profiles, settings) is served by the
JoolzFlix Umbrel app, so design/features change by updating the Umbrel app only. One codebase instead of two.

## Where things stand today (before this change)
| Piece | Repo / location | State |
|---|---|---|
| TV app "JoolzFlix" (id `io.stremio.flix.tv`) | `joolay/homebrew` → `app-flix/`, IPK in `dist/`, Homebrew Channel files in `webosbrew/` | v1.5.0 on `main`; full UI bundled in the IPK |
| Umbrel app "JoolzFlix" (id `joolay-flix`) | `joolay/umbrel-apps` branch `claude/torrentflix-umbrel` (commit `d1032fa`), **not merged to `main`** | `src/flix` (UI mirror + `server.js`), `joolay-flix/` store entry, v1.0.0 |
| Old Stremio Umbrel app | `joolay-stremio/`, `src/stremio/` | deleted on that branch (merge pending) |
| UI source of truth | `homebrew/app-flix/`, mirrored with `src/flix/sync-ui.sh` | **duplicate code = the problem this plan removes** |
| Ports | UI 3900 (behind Umbrel login), profile-sync API 3901 (open, API only), streaming server 11470 (open) | ports checked unique across the store |
| Streaming server | `tsaridas/stremio-docker:latest` in the JoolzFlix compose, Intel iGPU passthrough | replaces joolay-stremio |

## Target architecture
```
LG TV (webOS 4, Chromium 53)                      Umbrel
  JoolzFlix launcher (file://, ~50 lines)  --->   :3901  UI + /tf/api  (open on LAN, no login)   [web container]
     stores server address                        :3900  UI + /tf/api  (behind Umbrel login, for browsers)
     redirects to http://<umbrel>:3901/?tv=1      :11470 Stremio streaming server               [server container]
  page runs from the Umbrel origin:
     UI, player (<video>), profiles, My List, progress, Torrentio source picker
     profile sync = same origin (automatic)
```
Launcher owns only what the server cannot change: saved address, "can't reach Umbrel" screen (Retry / Change address), start-up splash.
The player stays in the served UI (it is the TV's normal HTML5 `<video>`, not a native plugin).

## Work items (build order)
1. **umbrel-apps `src/flix/server.js`**: let port 3901 serve the UI *and* `/tf/api/*` (today API only). Keep 3900 as is. Keep `Cache-Control: no-cache` on html/js/css. `?tv=1` marks TV mode (hides "Profile sync" setting, forces fit-to-window off, enables TV key tweaks). Update `test.js`.
2. **Move UI source into umbrel-apps**: `src/flix/public/` becomes the source of truth (drop `sync-ui.sh` mirroring; keep the iPhone/PWA head tags there). Remove `app-flix/` UI from `homebrew` once the launcher ships.
3. **TV launcher = JoolzFlix TV 2.0** (`app-flix/` shrinks to: `appinfo.json`, `index.html`, `icon.png`, `largeIcon.png`):
   - First run: address field (default `http://umbrel.local:3901`), Test + Save → `localStorage`.
   - Every run: splash, probe `GET <addr>/healthz` (timeout ~6 s, retry ×3), then `location.replace(<addr>/?tv=1)`.
   - Failure screen: message, **Retry**, **Change address**. Remote Back exits the app.
   - Hold Red during splash = change address (since the page after redirect is a different origin).
   - Same appid `io.stremio.flix.tv` so it upgrades in place; bump to 2.0.0.
4. **Chromium 53 guard** (so Umbrel-side design changes cannot silently break the TV): in the `src/flix` Docker build run a check that fails CI on non-ES5 syntax / unsupported APIs (candidate: ESLint `ecmaVersion: 6` with no async/await, object spread, optional chaining, `Object.entries`-style APIs without our polyfills; CSS: no grid, no `gap` on flex, no `inset`). Option B: Babel `preset-env` targets `chrome 53` + core-js in the image build. Decide when building.
5. **Docs/notes**: README in both repos (new install flow, ports, address), update Umbrel app description, release notes, bump Umbrel app version + compose image tag together (repo rule).
6. **Release order** (important): merge Umbrel app to `main` → wait for green image build → uninstall old Stremio app (port 11470 clash) → install JoolzFlix on Umbrel → publish TV launcher 2.0 via Homebrew Channel → set address on TV.

## Acceptance checks
- Umbrel: `node src/flix/test.js` passes incl. new case "3901 serves `/` and `/tf/api/sync`, 3900 unchanged".
- Launcher (Playwright, desktop): first-run screen saves address; healthy server → redirects with `?tv=1`; dead server → failure screen with Retry/Change; Back/Red behaviours.
- Whole UI regression run against the served pages (browse → detail → source list → player with test video → profiles/sync) as done for 1.4.x.
- CI image build green; Chromium-53 guard passes and demonstrably fails on a deliberately bad snippet.
- On the real TV (user): launcher connects, UI loads, playback works, profiles persist after restart.

## Trade-offs accepted
- UI on 3901 is reachable on the LAN without a login (TV cannot use Umbrel's login). It holds no secrets; profile data had the same exposure via the API; the streaming server is already open. Keep the Umbrel off the public internet.
- TV app shows nothing useful when the Umbrel is off/unreachable (playback already needs it) → clear failure screen, no bundled fallback copy (that would bring the duplicate code back).
- A bad UI deploy reaches the TV immediately → pin `TF`/image version, test before merging to `main`; rollback = re-pin previous image tag.
- Everything must stay Chromium-53 compatible even though browsers are the "main" client now.

## Open questions (ask before/while building)
1. ~~Open UI on port 3901~~ **superseded** by the JoolzApp-account plan below: no open API/UI port any more; everything sits behind the account.
2. Keep the TV address default as `umbrel.local` or ask for an IP on first run (mDNS can fail on some TVs)?
3. Chromium-53 guard: **recommended = server-side device detection + a separate compat build (see "Device detection and the compat build" below)**; confirm.
4. Slug stays `flix` (`joolay-flix`) — confirm, since ids cannot change after release.
5. Merge of the current Umbrel branch to `main` is still pending the user's "merge JoolzFlix" (repo rule: green build + user confirmation; Glass preview skipped because JoolzFlix is deliberately not Glass-themed).

## Rollback
TV: previous IPKs stay in git history (`dist/`); Homebrew Channel manifest can point back to 1.5.0. Umbrel: re-pin compose image tag to the previous version.

## Not changing
Torrentio-only sources with top-3-by-seeds per resolution; Cinemeta metadata; OpenSubtitles; 12 local profiles with Umbrel sync; streaming server on 11470.

## Device detection and the compat build (added after discussion)
Idea: write the UI once in modern code; the Umbrel server detects old TV browsers and serves them an automatically converted copy.

**Detection (in `src/flix/server.js`, on every page request):**
- LG webOS TV browser User-Agent contains `Web0S` / `webOS` (webOS 4 reports `Chrome/53`). Also treat any Chrome/Chromium major version below ~70 as "compat".
- The launcher adds `?tv=1` as a belt-and-braces signal; `?compat=1` / `?modern=1` override it for testing.
- Respond with `Vary: User-Agent` and `Cache-Control: no-cache`; the two builds live under different folders (`/app/dist/modern`, `/app/dist/compat`), same URLs.

**Two builds from one source, made when the Docker image is built (not at request time):**
- JS: Babel `preset-env` with `targets: chrome 53` + core-js polyfills (Object.entries, padStart, Promise.finally, etc.) -> ES5 bundle. async/await, spread, optional chaining, classes all get converted.
- CSS: PostCSS (`postcss-preset-env`, browserslist `chrome 53`) adds prefixes and converts custom properties / modern colour syntax where possible.
- Modern build for browsers/phones/PCs keeps modern output (smaller, faster).

**What this does NOT fix (so we still need rules + checks):**
- Layout features Chromium 53 lacks cannot be converted: CSS grid, `gap` on flexbox, `aspect-ratio`, `position: sticky`, `inset`, `:is()/:where()`, container queries, `backdrop-filter`. Rule: the source CSS only uses flexbox/absolute layout (as today), or provides an explicit fallback.
- Missing platform APIs that cannot be polyfilled: WebAssembly, ResizeObserver, IntersectionObserver edge cases, service workers (http, not secure context), modern media/MSE features. Rule: no new dependence on them without a TV fallback.
- Bigger/slower bundles on the TV (polyfills) - measure memory; the TV has already restarted for memory once.

**CI guards (fail the image build):**
1. Compat build must produce syntax-valid ES5 (parse with an ES5 parser, e.g. acorn `ecmaVersion: 5`).
2. Stylelint `plugin/no-unsupported-browser-features` with `browsers: chrome 53` on the CSS source.
3. Stronger, optional: run the compat build in a real old Chromium (~r416k Linux snapshot, Chrome 53) under xvfb in CI and click through the main screens. Needs a snapshot download; try it when building, may not be reliable.
4. Deliberate-failure test: a bad snippet (grid, async/await without polyfill) must make CI red.

**Consequences for the plan:** step 4 becomes "compat build + CI guards"; step 2 moves UI source to `src/flix/ui/` (source) with `build.js` producing `dist/modern` and `dist/compat`; `server.js` gains `pickBuild(req)`; Dockerfile gets a build stage (`node` + Babel/PostCSS), runtime stage serves only the output. Launcher stays unchanged. Still on the real TV: only the user can confirm final behaviour.

## Public address + JoolzApp account + dashboard (added after discussion; supersedes the "open port 3901" idea)
Goal: reach JoolzFlix on a public HTTPS address, lock it behind the JoolzApp account, and show it on the JoolzApp dashboard.
Findings from `joolay/umbrel-apps` (Listify is the pattern to copy; read from `src/listify`, `joolay-listify/docker-compose.yml`, `deploy/tsdproxy/README.md`, `src/portal-admin/README.md`, `CLAUDE.md`):

**1. Public address = TSDProxy + Tailscale Funnel, driven by compose labels.** Add to the `web` service:
`ports: ["3901:3900"]` and labels `tsdproxy.enable: "true"`, `tsdproxy.name: "flix"`, `tsdproxy.port.1: "443/https:3901/http, no_autodetect, tailscale_funnel"`
-> `https://flix.<tailnet>.ts.net`. Allowed ONLY because the app locks itself behind the account. Host port 3901 is free once the old open sync-API port is dropped (keep ports unique store-wide). `app_proxy` gets `PROXY_AUTH_ADD: "false"` like Listify (no Umbrel login; the account is the lock).

**2. Lock = JoolzApp (PocketBase) account, copied from Listify.** `src/flix` gains `pocketbase.js`, `portal-client.js`, `activity.js`, `guardians.js` (copies), env `POCKETBASE_APP_ID=flix`, `POCKETBASE_APP_NAME=JoolzFlix`, `REQUIRE_ACCOUNTS=1`.
- Routes: `/api/account/login|me|logout|forgot` (token in header `x-gd-token` or cookie `gd_token`, "remember me" = 90 days), `gateOf(user)` for access (portal.access approval, app disabled / maintenance, guardian-pending minors).
- Sign-up stays on the shared JoolzApp sign-up page (Portal Admin); admin approval per app as configured there.
- Our UI gets its own login screen (TV-style, on-screen keyboard friendly) instead of Listify's Glass `gate.html`.
- Data becomes **per account**: `<data>/users/<userId>.json` with up to 12 profiles, each with My List and watch progress (replaces the global `state.json` + open `/tf/api`). `/tf/api/*` requires a valid account token. The merge rules (newest entry wins, tombstones) are reused per user.
- Preferences ("settings live on the account", CLAUDE.md): UI preferences such as TV zoom/transcode/Torrentio link move to a `pref.flix` row via `setAppPref` (see `src/diner-bell/pocketbase.js`) instead of only localStorage.
- No PocketBase collections needed (like Listify, data is files in the app data folder); Portal Admin links the app within ~30 s of install (`linkNewApps`) and writes `pocketbase.env`; the app must fail closed without it and not need a restart (`pb.reload()`).

**3. Dashboard.** Portal Admin scans compose files and puts every installed `joolay-*` app on the JoolzApp home screen unless the compose sets `JOOLZAPP_DASHBOARD=hidden` (that is for owner-only tools). JoolzFlix keeps the default (visible). Then, once, in Portal Admin > Apps > URL register `https://flix.<tailnet>.ts.net` so approved users get an **Open** button (manual step in the UI, not code). Check the tile + icon (generated with `make-icons.py`, already done).

**4. TV launcher changes.** Launcher holds an ordered address list: LAN first (`http://umbrel.local:3901` or the Umbrel IP), public second (`https://flix.<tailnet>.ts.net`); it picks the first that answers `/healthz` (healthz must stay open, nothing else). Sign-in happens inside the served UI (email + password, remember me); the TV keeps the token in the page's own storage. Optional later: a pairing code (TV shows a code, approve on phone) to avoid typing passwords with a remote.

**5. Streaming server exposure (the real design question).** Port 11470 has no auth and torrent/proxy endpoints; it must **never** be labelled for Funnel or exposed publicly.
- Option A (simplest, recommended first): streaming server stays LAN-only. The TV at home streams directly over the LAN (`http://<umbrel>:11470`, fast, no relay). Off-LAN devices can browse/sign in but cannot play.
- Option B: add an authenticated reverse proxy inside the `web` container (`/stremio/*` -> `server:11470`, requires a valid account token, streams range requests). Playback then works away from home, BUT all video goes through Tailscale Funnel (bandwidth limits / fair-use, extra latency, relay) and the TV must not use it at home (hairpin through the internet) -> launcher/UI picks the LAN server when on the LAN, `/stremio` when remote.
- Decide A first; B is a separate step.

**Risks specific to this plan**
- **TLS trust on the TV:** Funnel certificates are Let's Encrypt (ISRG Root X1). A 2018 webOS 4 CA store may not trust them -> the public address could fail on the TV while LAN works. Must be tested on the real TV (`https://flix.<tailnet>.ts.net/healthz` in the TV browser) before relying on it. That is why LAN-first + public-fallback is in the launcher design.
- **Public exposure:** Funnel makes the sign-in page reachable from the internet; rate limiting (`throttled()` in Listify) must be copied, and the account/approval flow is the only gate. Streaming server must stay unpublished.
- **Passwords on a TV remote** are painful (pairing code idea).
- **Repo rules:** CLAUDE.md wants the Glass theme and a preview before merging to `main`; JoolzFlix is deliberately a TV-style UI, so its login screen is TV-style too (flagged for the owner each time).
- Everything from the "compat build" section still applies (login screen and account UI must also survive Chromium 53).

**Updated work order (supersedes steps 1-3 where they conflict)**
1. `src/flix/server.js`: account gate (copy Listify modules), per-user profile store + authenticated `/tf/api`, `/healthz` open, device-aware compat build (see above). Tests: gate refuses unauthenticated `/tf/api` and UI data routes; login throttling; per-user isolation (user A cannot read B's profiles).
2. UI: login view, "sign out", profile data now loaded from the account; remove "Profile sync" setting; keep Stremio-account (progress sync) feature as is.
3. Compose: labels + port 3901, `PROXY_AUTH_ADD: "false"`, `POCKETBASE_APP_ID`, `REQUIRE_ACCOUNTS=1`, `extra_hosts` for `host.docker.internal`; version bump + image tag; README/notes.
4. Launcher (TV 2.0): address list LAN-then-public, health probe, failure screen.
5. Release order: merge to `main` after green build and owner OK; uninstall old Stremio app (port 11470); install JoolzFlix; wait for Portal Admin to link it; register the public URL in Portal Admin > Apps; verify `https://flix...ts.net` from mobile data shows the sign-in page and that `/tf/api/state` without a token is refused; then TV.

**New open questions**
a. TV address order: LAN first then public (recommended), or public only?
b. Streaming away from home: Option A (LAN-only, simplest) or B (authenticated proxy through Funnel)?
c. Profiles: up to 12 **per JoolzApp account** (recommended; each family member has an account, profiles for kids/guests) or one shared pool of 12 for the whole household?
d. TV sign-in: typed email/password first, pairing code later?
e. Slug/public name: `flix` -> `https://flix.<tailnet>.ts.net` fine?

## Build summary (what was decided and built)
Owner's answers: (1) TV tries **home first, then public**; public name **`joolztv`** -> `https://joolztv.macaw-chroma.ts.net`. (2) Streaming **always through the signed-in proxy**; sign-in happens when a profile is selected and lasts 90 days since last use. (3) **One JoolzApp account per profile, max 12 profiles per household.** (4) First-run **wizard** asks for a JoolzApp account; the user can then add household members and choose who stays signed in on the TV. No other service sign-ins (Torrentio is built in). (5) **Apple TV glass redesign**, app renamed **JoolzTV**. (6) Glass-style theme accepted.

Built:
- **umbrel-apps** (`src/joolztv`, `joolay-joolztv/`, branch `claude/torrentflix-umbrel`): `server.js` (JoolzApp account gate copied from Listify, household of <=12 profiles, per-account My List + progress, signed stream proxy `/s/<token>/`, device detection, open `/healthz`), UI in `ui/`, `build.js` (modern + Chromium-53 builds + guards), Dockerfile (multi-stage), compose (TSDProxy labels for `joolztv`, streaming server NOT published), icon via the repo script, tests (`test.js` 35 checks with mock accounts, `test-build.js` 20 guard checks).
- **homebrew** (this repo): TV app is now a ~100-line launcher (JoolzTV 2.0.0, same app id so it upgrades in place); the old bundled UI was removed.

Not verified (needs the real Umbrel / TV): container runtime; real PocketBase (tests use a stand-in with the same function shape); Portal Admin linking + dashboard tile + registering the public URL; Funnel certificate trust on the 2018 TV; real torrent playback and HLS transcoding through the proxy; Chromium 53 itself (guards + converter, not a real old browser).

Deliberate deviations from umbrel-apps CLAUDE.md (flagged to the owner): own glass styling in `ui/css/app.css` instead of `glass.css`; user preferences (Torrentio link, transcode, TV sign-in choice) are stored on the device/per account file, not yet as `pref.joolztv` rows in PocketBase.
