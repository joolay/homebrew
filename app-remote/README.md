# TV Remote, TV side (LG webOS, rooted + Homebrew Channel)

Connects this TV to the **TV Remote** app on your Umbrel (`joolay-tv-remote`, source `joolay/umbrel-apps/src/tv-remote`), so you can see and control the TV from a phone or computer, at home or through Tailscale. **Nothing connects to the TV.** The TV's agent listens on no port: it connects *out* to your Umbrel, and people use the page on the Umbrel (behind Umbrel's own login).

**Why this design.** The TV's CPU is small. The Umbrel server asks the TV for one screenshot at a time, only while someone is watching, shares each picture with every viewer, and asks less often when the picture is not changing. With nobody watching the agent does nothing at all.

**Pairing (4-digit code).** In the Umbrel app press *Add TV*: it shows a 4-digit code (valid 10 minutes, one use). On the TV open TV Remote, type the Umbrel address (the one you open Umbrel with, no `http://`; the agent port 3905 is assumed) and the code, then *Pair with Umbrel*. The Umbrel answers with a long random token that the TV keeps (`/var/lib/joolay-tvremote/config.json`, owner-only); the 4-digit code is spent and never used again. Five wrong codes cancel the code, so it cannot be guessed. *Forget Umbrel* un-pairs; remove the TV in the Umbrel app too.

**Protocol (TV agent to Umbrel).** `POST http://<umbrel>:3905/agent/pair {code,name}` then a WebSocket to `/agent/ws` with `Authorization: Bearer <token>`. The Umbrel sends JSON commands `{id, cmd: shot|key|move|click|launch|text, ...}`; the agent answers `{id, ok}` or, for `shot`, a binary frame (4-byte request id + JPEG). `agent/ws.js` is identical to `src/tv-remote/ws.js` in `joolay/umbrel-apps`: change both together.

**What the agent can do** (only what the paired Umbrel asks): one screenshot (`com.webos.service.capture/executeOneShot`, `com.webos.service.tv.capture` as the fallback; DISPLAY, JPG), remote keys through the pointer input socket (`com.webos.service.networkinput/getPointerInputSocket`), text (`com.webos.service.ime/insertText`) and app launch (`applicationManager/launch`). No shell, no file access. The link between TV and Umbrel is plain HTTP: use your home network or Tailscale (which encrypts it).

**Not verified on a real TV yet:** whether the capture service answers for DISPLAY on this TV (and whether protected video shows as black), whether the pointer socket accepts key frames, whether Node is on the root path, and the text-entry call. The Umbrel page shows the TV's last error when a call fails.

Tests: `node test/test.js` (fake Umbrel, fake `luna-send`, fake pointer socket).
