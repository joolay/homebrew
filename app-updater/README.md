# TV Updater (LG webOS 4, rooted + Homebrew Channel)

Keeps the apps on your TV up to date without opening Homebrew Channel.

- **Service** (`../app-updater-service`): reads the feed (default `webosbrew/apps.json` in this repo), compares each listed app's manifest version with what is installed, downloads newer IPKs over https, checks sha256 and size, installs them, then confirms the TV reports the new version. Apps not already on the TV are never installed. The updater updates itself last.
- **App** (`./`): status screen with *Check now*, *Update all*, and *Auto-update* (writes/removes a Homebrew Channel `init.d` script that runs the service 2 min after boot and every 24 h).
- Remote: Left/Right move between buttons, OK presses, Back exits.

## Release
Tag `updater-v1.0.0` → the `release-updater` job builds the IPK + `manifest.json` (rootRequired). Then add this to `webosbrew/apps.json` (manifestUrl = the release's manifest.json) so Homebrew Channel can install it the first time.

## Not verified on a real TV
Logic is tested against a mock feed (`node app-updater-service/test/test.js`). The webOS calls (`listApps`, `appInstallService/dev/install`, `init.d` path, `webos-service` on webOS 4) follow Homebrew Channel / Dev Manager behaviour but have not run on the 2018 UK6300PVB yet. Logs: `/media/developer/joolay-updater/updater.log`.

## Used by the JoolzTV launcher (self-update)
The launcher (`app-flix`, 2.1.0+) asks the JoolzTV server `/tv/update` after connecting. If a newer launcher exists it calls this service's `updateApp {id}` and shows "Updating JoolzTV…". The service re-reads the feed, checks sha256, installs only that app, and reopens it. If the updater isn't installed, doesn't answer, or fails, the launcher just opens JoolzTV; the same version is not retried for 6 h. The first move from 2.0.2 to 2.1.0 must be done by hand (Homebrew Channel or `ares-install`), since 2.0.2 has no update step. Tests: `node app-flix/test-launcher.js`.
