# Link Test (LG webOS, rooted + Homebrew Channel)

A throw-away test app, separate from JoolzTV.

- **Netflix: just open the app** and **Netflix: play, DIAL style** (type a title ID with the number keys, Yellow deletes). The DIAL-style link opens the title and plays it.
- **Netflix Watch** (0.4.0): *start logging* runs a read-only background logger for 30 min. When Netflix starts it records where Netflix lives (its process, sandbox folder, mounts and open files), then watches the folders it uses for new or changed files (names, sizes, times only, never contents). Open Netflix, pick a profile, play a few seconds, then open *report*. Log: `/var/lib/webosbrew/joolay-netflix-log.txt`.
