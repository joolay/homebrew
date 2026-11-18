"use strict";
// Core logic of the TV Tailscale service. No webOS APIs in here, so it runs (and is tested) anywhere.
// Written for the old Node on webOS 4 (Node 8): no optional chaining, no dependencies.
var https = require("https");
var http = require("http");
var net = require("net");
var crypto = require("crypto");
var urlmod = require("url");

var PKGS = "https://pkgs.tailscale.com/stable/";
var MAX_TGZ = 80 * 1024 * 1024;

var DEFAULTS = { auto: true, hostname: "lg-tv", mode: "auto", acceptDns: false, socksPort: 1055, forwards: [] };

// ---- config -------------------------------------------------------------------------------------------------------------
function cleanHost(s) { return typeof s === "string" && /^[A-Za-z0-9]([A-Za-z0-9.\-]{0,251}[A-Za-z0-9])?$/.test(s) ? s : null; }
function cleanPort(n) { n = Number(n); return n >= 1 && n <= 65535 && n === Math.floor(n) ? n : null; }

// Returns a full, safe config from stored JSON (unknown keys dropped, bad values replaced by defaults).
function normalizeConfig(c) {
  c = c || {};
  var o = {};
  for (var k in DEFAULTS) o[k] = DEFAULTS[k];
  if (typeof c.auto === "boolean") o.auto = c.auto;
  var hn = typeof c.hostname === "string" ? c.hostname.toLowerCase().replace(/[^a-z0-9\-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) : "";
  if (hn) o.hostname = hn;
  if (c.mode === "auto" || c.mode === "tun" || c.mode === "userspace") o.mode = c.mode;
  if (typeof c.acceptDns === "boolean") o.acceptDns = c.acceptDns;
  if (cleanPort(c.socksPort)) o.socksPort = cleanPort(c.socksPort);
  if (Array.isArray(c.forwards)) {
    o.forwards = [];
    c.forwards.slice(0, 8).forEach(function (f) {
      if (f && cleanPort(f.listen) && cleanHost(f.host) && cleanPort(f.port)) o.forwards.push({ listen: cleanPort(f.listen), host: cleanHost(f.host), port: cleanPort(f.port) });
    });
  }
  return o;
}

// "umbrel:3901" or "100.101.102.103:3901" -> one forward on the same local port, or null. "" clears.
function parseForward(text) {
  var m = /^\s*([A-Za-z0-9][A-Za-z0-9.\-]*)\s*:\s*(\d{1,5})\s*$/.exec(String(text || ""));
  if (!m || !cleanHost(m[1]) || !cleanPort(m[2])) return null;
  return { listen: cleanPort(m[2]), host: m[1], port: cleanPort(m[2]) };
}

// ---- which build to download -------------------------------------------------------------------------------------------
function archFor(machine) {
  var m = String(machine || "").trim();
  if (/^aarch64|^arm64/.test(m)) return "arm64";
  if (/^armv[5-9]|^arm/.test(m)) return "arm";
  if (/^x86_64|^amd64/.test(m)) return "amd64";
  if (/^i[3-6]86/.test(m)) return "386";
  throw new Error("Unknown CPU type: " + m);
}

// pkgs.tailscale.com/stable/?mode=json -> { version, file, url, shaUrl }
function pickTarball(json, arch, base) {
  base = base || PKGS;
  var file = json && json.Tarballs && json.Tarballs[arch];
  if (typeof file !== "string" || !/^tailscale_[0-9.]+_[a-z0-9]+\.tgz$/.test(file)) throw new Error("No Tailscale download for " + arch);
  return { version: String(json.TarballsVersion || ""), file: file, url: base + file, shaUrl: base + file + ".sha256" };
}

// The .sha256 file is either just the hash or "hash  filename".
function parseSha(text) {
  var m = /\b([0-9a-f]{64})\b/i.exec(String(text || ""));
  if (!m) throw new Error("Could not read the checksum file");
  return m[1].toLowerCase();
}
function sha256(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }

function request(url, opts, hops) {
  opts = opts || {}; hops = hops || 0;
  return new Promise(function (resolve, reject) {
    var u = urlmod.parse(url);
    if (u.protocol !== "https:" && !opts.allowHttp) return reject(new Error("Only https addresses are allowed: " + url));
    var lib = u.protocol === "http:" ? http : https;
    var req = lib.get({ hostname: u.hostname, port: u.port, path: u.path, headers: { "User-Agent": "joolay-tv-tailscale" } }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (hops >= 5) return reject(new Error("Too many redirects"));
        return resolve(request(urlmod.resolve(url, res.headers.location), opts, hops + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error("HTTP " + res.statusCode + " for " + url)); }
      var chunks = [], size = 0, max = opts.max || 2 * 1024 * 1024;
      res.on("data", function (c) { size += c.length; if (size > max) { req.abort(); return reject(new Error("Download too large: " + url)); } chunks.push(c); });
      res.on("end", function () { resolve(Buffer.concat(chunks)); });
      res.on("error", reject);
    });
    req.setTimeout(60000, function () { req.abort(); reject(new Error("Timed out: " + url)); });
    req.on("error", reject);
  });
}

// Finds, downloads and checks the newest build. Returns { version, file, buffer }. Never returns a file whose checksum differs.
// deps: { arch, base, allowHttp, log }
function fetchTailscale(deps) {
  var base = deps.base || PKGS, o = { allowHttp: deps.allowHttp };
  return request(base + "?mode=json", o).then(function (b) {
    var pick = pickTarball(JSON.parse(b.toString("utf8")), deps.arch, base);
    if (deps.log) deps.log("Newest Tailscale for " + deps.arch + ": " + pick.version);
    return Promise.all([request(pick.shaUrl, o), request(pick.url, { allowHttp: deps.allowHttp, max: MAX_TGZ })]).then(function (r) {
      var want = parseSha(r[0].toString("utf8")), got = sha256(r[1]);
      if (want !== got) throw new Error("Checksum does not match, download discarded");
      return { version: pick.version, file: pick.file, buffer: r[1] };
    });
  });
}

// ---- command lines ------------------------------------------------------------------------------------------------------
function chooseMode(cfg, hasTun, isRoot) {
  if (cfg.mode === "tun") return "tun";
  if (cfg.mode === "userspace") return "userspace";
  return hasTun && isRoot ? "tun" : "userspace";
}
// paths: { state, socket }
function daemonArgs(cfg, mode, paths) {
  var a = ["--state=" + paths.state, "--socket=" + paths.socket];
  if (mode === "userspace") a.push("--tun=userspace-networking");
  a.push("--socks5-server=127.0.0.1:" + cfg.socksPort, "--outbound-http-proxy-listen=127.0.0.1:" + cfg.socksPort);
  return a;
}
// authKey is only ever passed here, never stored.
function upArgs(cfg, paths, authKey) {
  var a = ["--socket=" + paths.socket, "up", "--reset", "--hostname=" + cfg.hostname, "--accept-dns=" + (cfg.acceptDns ? "true" : "false"), "--accept-routes=false"];
  if (authKey) {
    if (!/^tskey-[A-Za-z0-9\-_]{10,200}$/.test(authKey)) throw new Error("That does not look like a Tailscale key (it starts with tskey-)");
    a.push("--auth-key=" + authKey);
  }
  return a;
}
function shq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }

// Boot hook for Homebrew Channel's init.d: starts the daemon, reconnects, starts the forwards. Same commands as the app uses.
// p: { bin, dir, logFile, socket, state, node, forwardJs, configFile, daemonArgs, upArgs, stopFlag }
function bootScript(p) {
  return "#!/bin/sh\n# TV Tailscale: written by the app, removed with the app's switch\n" +
    "( sleep 30\n" +
    "  [ -e " + shq(p.stopFlag) + " ] && exit 0\n" +
    "  mkdir -p " + shq(p.dir) + "\n" +
    "  nohup " + shq(p.bin + "/tailscaled") + " " + p.daemonArgs.map(shq).join(" ") + " >> " + shq(p.logFile) + " 2>&1 &\n" +
    "  sleep 6\n" +
    "  nohup " + shq(p.bin + "/tailscale") + " " + p.upArgs.map(shq).join(" ") + " >> " + shq(p.logFile) + " 2>&1 &\n" +
    "  nohup " + shq(p.node) + " " + shq(p.forwardJs) + " " + shq(p.configFile) + " >> " + shq(p.logFile) + " 2>&1 &\n" +
    ") &\n";
}

// ---- status -------------------------------------------------------------------------------------------------------------
// `tailscale status --json` -> what the screen shows
function summarize(j) {
  j = j || {};
  var self = j.Self || {};
  var peers = [];
  var P = j.Peer || {};
  Object.keys(P).forEach(function (k) {
    var p = P[k] || {};
    peers.push({ name: String(p.HostName || p.DNSName || k), dns: String(p.DNSName || "").replace(/\.$/, ""), ip: (p.TailscaleIPs || [])[0] || "", online: !!p.Online, os: String(p.OS || "") });
  });
  peers.sort(function (a, b) { return (b.online - a.online) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); });
  var state = String(j.BackendState || "Unknown");
  return {
    state: state,
    connected: state === "Running",
    authUrl: /^https:\/\//.test(j.AuthURL || "") ? j.AuthURL : "",
    self: { name: String(self.HostName || ""), dns: String(self.DNSName || "").replace(/\.$/, ""), ips: self.TailscaleIPs || [] },
    health: (j.Health || []).map(String).slice(0, 4),
    peers: peers.slice(0, 40)
  };
}

// ---- SOCKS5 client and local forwarder ----------------------------------------------------------------------------------
// Opens a connection to host:port through a SOCKS5 proxy without a login. Resolves with the connected socket.
function socks5Connect(proxyHost, proxyPort, host, port) {
  return new Promise(function (resolve, reject) {
    var s = net.connect(proxyPort, proxyHost), buf = Buffer.alloc(0), step = 0, need = 2, done = false;
    function fail(e) { if (done) return; done = true; s.destroy(); reject(e instanceof Error ? e : new Error(String(e))); }
    s.setTimeout(15000, function () { fail(new Error("Proxy timed out")); });
    s.on("error", fail);
    s.on("close", function () { fail(new Error("Proxy closed the connection")); });
    s.on("connect", function () { s.write(Buffer.from([5, 1, 0])); });
    s.on("data", function onData(d) {
      buf = Buffer.concat([buf, d]);
      while (!done && buf.length >= need) {
        if (step === 0) {
          if (buf[0] !== 5 || buf[1] !== 0) return fail(new Error("Proxy refused the handshake"));
          buf = buf.slice(2); step = 1;
          var h = Buffer.from(host);
          s.write(Buffer.concat([Buffer.from([5, 1, 0, 3, h.length]), h, Buffer.from([port >> 8, port & 255])]));
          need = 5;
        } else {
          // reply: VER REP RSV ATYP then the bound address (4, 16 or 1+len bytes) and 2 port bytes
          var atyp = buf[3], total = atyp === 1 ? 10 : atyp === 4 ? 22 : atyp === 3 ? 7 + buf[4] : 0;
          if (!total) return fail(new Error("Bad proxy reply"));
          if (buf.length < total) { need = total; return; }
          if (buf[1] !== 0) return fail(new Error("Could not reach " + host + ":" + port + " through Tailscale (code " + buf[1] + ")"));
          var rest = buf.slice(total);
          done = true; s.removeAllListeners("data"); s.removeAllListeners("close"); s.removeAllListeners("error"); s.setTimeout(0);
          if (rest.length) s.unshift(rest);
          return resolve(s);
        }
      }
    });
  });
}

// Listens on 127.0.0.1:<listen> and pipes each connection through the proxy to host:port. Returns the server.
function makeForwarder(f, proxyPort, log) {
  var srv = net.createServer(function (c) {
    c.pause();
    socks5Connect("127.0.0.1", proxyPort, f.host, f.port).then(function (up) {
      c.pipe(up); up.pipe(c);
      c.on("error", function () { up.destroy(); }); up.on("error", function () { c.destroy(); });
      c.on("close", function () { up.destroy(); }); up.on("close", function () { c.destroy(); });
      c.resume();
    }, function (e) { if (log) log("forward " + f.listen + ": " + e.message); c.destroy(); });
    c.on("error", function () {});
  });
  srv.on("error", function (e) { if (log) log("forward " + f.listen + ": " + e.message); });
  srv.listen(f.listen, "127.0.0.1");
  return srv;
}

module.exports = {
  DEFAULTS: DEFAULTS, PKGS: PKGS, normalizeConfig: normalizeConfig, parseForward: parseForward, archFor: archFor, pickTarball: pickTarball, parseSha: parseSha,
  sha256: sha256, fetchTailscale: fetchTailscale, chooseMode: chooseMode, daemonArgs: daemonArgs, upArgs: upArgs, bootScript: bootScript, shq: shq,
  summarize: summarize, socks5Connect: socks5Connect, makeForwarder: makeForwarder
};
