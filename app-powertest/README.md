# Power Test (LG webOS, rooted + Homebrew Channel)

A throw-away test app, separate from TV Updater. It answers: **what does the TV actually do when you switch it off with the remote?** (full shutdown, or standby with Linux still running?) That decides whether TV Updater's 24-hour timer can ever fire.

- **Start logging** writes a small script to `/var/lib/webosbrew/init.d/91-joolay-powertest` (runs at every boot) and starts it now. It adds a line to `/var/lib/webosbrew/joolay-power-log.txt` every 30 s: time, uptime, the TV's power state (`com.webos.service.tvpower`), and a tag (BOOT, BEAT, APP-OPEN, PROBE-OPEN, MARK).
- **Probe** (optional): every 30 min the script launches this app from the background and the app logs PROBE-OPEN, then closes itself. If PROBE-OPEN appears while the TV was in standby, a standby TV can launch apps (what TV Updater's timer needs).
- **Mark** logs a MARK line so you can tell when you pressed the power button.
- The screen reads the log and lists boots, pauses (no heartbeat for over 75 s), power state changes and probes.

Needs a rooted TV with Homebrew Channel (it runs commands through Homebrew Channel's service). Stop and remove deletes the script and stops the logger; the log file is kept until you press Clear log.
