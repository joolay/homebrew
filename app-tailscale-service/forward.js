"use strict";
// Standalone process (started by the service and by the boot hook): node forward.js <config.json>
// Makes tailnet addresses reachable on the TV itself: http://127.0.0.1:<port> -> <host>:<port> through Tailscale's local SOCKS5 proxy.
var fs = require("fs");
var core = require("./core");

var cfg = core.normalizeConfig(JSON.parse(fs.readFileSync(process.argv[2], "utf8")));
if (!cfg.forwards.length) { console.log("no forwards configured"); process.exit(0); }
cfg.forwards.forEach(function (f) {
  core.makeForwarder(f, cfg.socksPort, function (m) { console.log(new Date().toISOString() + " " + m); });
  console.log(new Date().toISOString() + " 127.0.0.1:" + f.listen + " -> " + f.host + ":" + f.port);
});
