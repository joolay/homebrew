# Link Test (LG webOS, rooted + Homebrew Channel)

A throw-away test app, separate from JoolzTV. It answers one question: can an app open or play a video **directly inside the Netflix app** from a link?

Each row launches Netflix (`com.webos.applicationManager/launch`, id `netflix`) with a different parameter style. Type a Netflix title id with the number keys (Yellow deletes). If webOS refuses the direct call, the app repeats it as root through Homebrew Channel's `exec`. A YouTube row is the control, which is known to work. The top line lists the streaming apps found on the TV, so the real Netflix app id is confirmed.

Report which row opened the right title, and which one started playing (not just the title page).

The first two rows are hard-coded to Stranger Things (Netflix id 80057281, TMDB tv 66732), which the Netflix South Africa site lists as available. The TMDB id was not checked online; the Netflix id and South Africa listing were.

0.2.0 adds two groups of tests. **Browser** rows open Netflix's web pages in the TV browser (do they load, signed in, with the profile list?). **App data** rows read the Netflix folders and `appinfo.json` as root, read only, and show the result on screen: file names, sizes and which files mention "profile" (contents are not printed). Left/Right scroll the result panel.

0.3.0 adds **Netflix Watch**: *start logging* runs a read-only background logger for 30 min (which Netflix files appear or change (only the folders Netflix can write to, so the scan stays fast), which files the Netflix process has open, which app is in front; names, sizes and times only, never contents). Open Netflix, pick a profile, play something, then open *report*. Log: `/var/lib/webosbrew/joolay-netflix-log.txt`.
0.3.2: the file scan only covers the writable folders and is timed (SLOW line if it takes 10 s or more); a TICK line every ~30 s shows the logger is alive.
