# TV Tailscale (LG webOS 4, rooted + Homebrew Channel)

Puts the TV on your Tailscale network, so JoolzTV can reach your Umbrel from anywhere, not only at home.

- **Service** (`../app-tailscale-service`): downloads the newest Tailscale for the TV's CPU from `pkgs.tailscale.com` (sha256 checked, never installed on a mismatch), runs `tailscaled`, signs in, and can start everything again after a reboot (Homebrew Channel `init.d` script, 30 s after boot).
- **App** (`./`): *Install/Update*, *Connect/Disconnect*, *Start at boot*, *Log out*, the sign-in address, this TV's tailnet IP and your other devices.
- Remote: arrows move, OK presses, Back exits.

## Signing in
1. **Sign-in address (default).** Choose Connect; the screen shows an address. Open it on your phone, sign in, approve the TV.
2. **Auth key.** Type a reusable key (`tskey-auth-…`) in the key box first, then Connect. The key is passed to `tailscale up` once and is never saved or written into the boot script; the TV's login lives in Tailscale's own state file.

## Two modes (Mode is automatic)
- **TUN**: used when `/dev/net/tun` exists and the service runs as root. The whole TV can reach tailnet addresses (100.x.y.z). MagicDNS names are not used (`accept-dns` is off so the TV's own DNS is untouched); use the Umbrel's 100.x address in JoolzTV's address screen.
- **Userspace**: the fallback. Tailscale gives no network device, so apps on the TV cannot use tailnet addresses directly. Use **Forward** instead: type `umbrel:3901` and Save, and `http://127.0.0.1:3901` on the TV is carried through Tailscale to the Umbrel (`forward.js`, listens on 127.0.0.1 only). Set the JoolzTV launcher's address to `http://127.0.0.1:3901`. Forward also works in TUN mode.

## Release
Tag `tailscale-v1.0.0` (or Actions > Release > `tailscale`) builds the IPK and `manifest-tailscale.json` (rootRequired) and adds it to `webosbrew/apps.json`. The TV Updater keeps it current once installed.

## Not verified on a real TV
Everything with no TV in it is tested: `node app-tailscale-service/test/test.js` (config, build choice, checksum refusal with a tampered download, command lines, boot script has no key, status parsing, SOCKS5 forwarder against a fake proxy). What has **not** run on the 2018 UK6300PVB: whether the kernel has `/dev/net/tun`, whether `/media/developer` allows running programs, the live `pkgs.tailscale.com` layout (`?mode=json` + `.tgz.sha256`), and whether `tailscaled` survives the service exiting. Logs: `/media/developer/joolay-tailscale/tailscale.log`. If Install says Tailscale "will not run on this TV", that is the folder/CPU problem.
