# TV Updater 2.1 (LG webOS, rooted + Homebrew Channel)

Keeps the apps on your TV up to date without opening Homebrew Channel. 2.0 has **no service of its own** (1.x needed `io.joolay.tvupdater.service`, which never registered on some TVs). It is a plain web app that uses Homebrew Channel's own service (`org.webosbrew.hbchannel.service`: `install` and `exec`), so nothing extra has to be installed or started.

- It reads more than one repo (`REPOS` in `hb-updater.js`: JoolzTV, then webOS Homebrew; change with `setConfig({repos:[{id,name,url,all}]})`) and the screen groups apps by repo. Other repos only list apps already installed. A repo that can't be read shows one error line and the others carry on. The webOS Homebrew address is not verified yet.
- `hb-updater.js` reads each feed (the JoolzTV one is `webosbrew/apps.json`), compares each listed app's manifest version with what the TV reports, and asks Homebrew Channel to install newer IPKs (sha256 checked). Apps not already on the TV are never installed. It updates itself last (a timer reopens it).
- The screen has *Check now*, *Update all* and *Auto-update* (writes/removes `/var/lib/webosbrew/init.d/90-joolay-updater`, which opens this app with `auto:true` 2 min after boot and every 24 h).
- The JoolzTV launcher (`app-flix`, 2.1.2+) carries the same `hb-updater.js` and updates itself through it.
- Remote: Left/Right move between buttons, OK presses, Back exits.

## Release
Run Actions > Release (or tag `updater-v2.1.0`) to build the IPK and manifest. Install once from Homebrew Channel (it replaces 1.x).

## Not verified on a real TV
The logic is tested against a fake Homebrew Channel (`node app-updater/test/test.js`, `node app-flix/test-launcher.js`). The real Homebrew Channel calls follow its documented `install` and `exec` methods but have not run on the TV yet.
