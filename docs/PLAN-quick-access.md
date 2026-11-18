# Plan: Quick Access (PIN / pattern) and sign-out (notes first, then build)

Request: a faster but less secure sign-in with a 4 or 6 digit PIN or a pattern; ask at sign-up whether to add it; JoolzTV users stay signed in until signed out; an admin can sign out any user in Portal Admin.
Decisions (asked): works in Portal AND JoolzTV; the code is checked by the server and tied to the device; JoolzTV sessions never expire.

## Community check
Pattern-lock libraries exist (vanilla-pattern-lock, Tympanix pattern-lock-js (jQuery), s-yadav patternlock, PatternLockJS), all MIT but dormant since 2017-2021. We need ES5 for Chromium 53, a glass look and remote-key control on the TV, and the lock is ~80 lines, so we write our own (no dependency).

## Design
- A device (a phone browser, a TV) that sets Quick Access gets `deviceId` + `deviceSecret` (random). Portal Admin stores only hashes: row `qa.<deviceId>` in `portal_settings` (scope user, secret = true: hidden from every signed-in person) = { kind: pin4|pin6|pattern, codeHash (scrypt, per-device salt), secretHash, label, created, lastUsed, fails }.
- Sign in = deviceId + deviceSecret + code. Wrong code: 1 s delay between tries; 5 wrong in a row deletes the device's Quick Access (password needed again). A code alone is useless without the device secret.
- Portal: success returns a PocketBase session for that person (superuser impersonation, 14 days, non-refreshable; PocketBase 0.23+). Apps (JoolzTV): `qa.login` over Portal API returns only the userId and the app mints its own session (same model as QR sign-in).
- Pattern = dot numbers 0-8 in order, at least 4 dots; PIN = digits. Both stored the same way (`p:` prefix for patterns).
- Sign-out: `portal.signedOutAt` (scope user, not secret, only the superuser can write) + all `qa.*` rows of that person deleted. Portal checks it against its own sign-in time on load and every minute; JoolzTV rejects sessions minted before it. Admin > Users > Sign out.
- JoolzTV: no idle expiry any more (sessions last until signed out). Profile tile on a TV with Quick Access opens a PIN pad (remote digits) or pattern pad (arrows + OK).

## Not covered / honest limits
Quick Access is less secure on purpose: a 4 digit PIN has 10,000 combinations, protected by the lockout and the device secret. Real TV behaviour (remote keys on the pad) is unverified.
