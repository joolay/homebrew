# Plan: thin TV wrapper + single JoolzFlix codebase (NOT built yet)

Status: **notes only, agreed direction, awaiting "go"**. Written 2026-11-17.

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
1. Is serving the full UI on open port 3901 acceptable? (alternative: shared-secret token in the launcher URL, more work, still LAN-only).
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
