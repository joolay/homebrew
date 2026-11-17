# Torrentflix for LG webOS

Homebrew Channel repository for **Torrentflix**, a classic Netflix-style app for older LG TVs (tested target: 2018 UK6300PVB, webOS 4.0, Chromium 53).

**Add this repository in Homebrew Channel:**
```
https://raw.githubusercontent.com/joolay/homebrew/main/webosbrew/apps.json
```

Why a from-scratch app? Current Stremio Web needs WebAssembly (Chromium 57+), which webOS 4.0 lacks; see `docs/NOTES-modern-stremio-web.md`.
(The earlier "Stremio (Legacy 4.4)" app has been retired and removed from this repository.)

## Torrentflix (classic Netflix TV style) — `app-flix/`
A separate app (id `io.stremio.flix.tv`, shown as **Torrentflix**) styled like the older Netflix TV app: black screen, info panel for the focused title above the rows, square white-framed box art, pop-out left menu (press Left on the first title, or Back). Written for Chromium 53 (no WebAssembly).

- **Sources: Torrentio only.** Top 3 sources by seeds in each of 4K, 1080p, 720p, Other. "Play" starts the top-seeded 1080p source (then 720p, 4K, other); "Choose source" shows all.
- Posters/details/episodes: Cinemeta. Subtitles: OpenSubtitles. No Stremio account needed.
- Playback through your own Stremio streaming server via `http://<server>:11470/<infoHash>/<file>`, with automatic HLS transcoding fallback.
- **Up to 12 profiles** ("Who's watching?"), each with its own **My List**, **watch progress / Continue Watching** and optional Stremio account. Add/edit/delete under Manage Profiles; switch via the left menu or the avatar top-right.
- Seasons/episodes, resume, auto-play next episode, playback speed, subtitles.

Install on the TV: Homebrew Channel (same repository URL), or `ares-install dist/io.stremio.flix.tv_1.4.1_all.ipk`.

## Torrentflix for Umbrel
The Umbrel app lives in **[joolay/umbrel-apps](https://github.com/joolay/umbrel-apps)** (`src/torrentflix/`, store entry `joolay-torrentflix/`), not in this repo.
Install it from your Umbrel's community app store (`https://github.com/joolay/umbrel-apps`).
It uses the streaming server of the Stremio app (`joolay-stremio`, port 11470) and stores profiles, lists and progress on your Umbrel.

Connect the **TV app**: Torrentflix → Settings → *Profile sync* = `http://umbrel.local:3901`, *Streaming server* = `http://umbrel.local:11470`
(use the Umbrel's IP address if `umbrel.local` doesn't resolve on the TV).

The UI in `app-flix/` is the single source of truth; the Umbrel app mirrors it with `src/torrentflix/sync-ui.sh` (in the umbrel-apps repo).
