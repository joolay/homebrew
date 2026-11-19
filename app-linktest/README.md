# Link Test (LG webOS, rooted + Homebrew Channel)

A throw-away test app, separate from JoolzTV. It answers one question: can an app open or play a video **directly inside the Netflix app** from a link?

Each row launches Netflix (`com.webos.applicationManager/launch`, id `netflix`) with a different parameter style. Type a Netflix title id with the number keys (Yellow deletes). If webOS refuses the direct call, the app repeats it as root through Homebrew Channel's `exec`. A YouTube row is the control, which is known to work. The top line lists the streaming apps found on the TV, so the real Netflix app id is confirmed.

Report which row opened the right title, and which one started playing (not just the title page).

The first two rows are hard-coded to Stranger Things (Netflix id 80057281, TMDB tv 66732), which the Netflix South Africa site lists as available. The TMDB id was not checked online; the Netflix id and South Africa listing were.
