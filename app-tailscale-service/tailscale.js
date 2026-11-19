"use strict";
// webOS service: io.joolay.tvtailscale.service  (needs a rooted TV with Homebrew Channel)
var fs = require("fs");
var cp = require("child_process");
var core = require("./core");

var Service = require("webos-service");
var service = new Service("io.joolay.tvtailscale.service");

var DIRS = ["/media/developer/joolay-tailscale", "/var/lib/joolay-tailscale"];
var INIT_DIRS = ["/var/lib/webosbrew/init.d", "/media/cryptofs/apps/usr/palm/services/org.webosbrew.hbchannel.service/init.d"];
var BOOT_FILE = "91-joolay-tailscale";
var SOCKET = "/tmp/joolay-tailscaled.sock";
var state = { busy: false, lastError: null, log: [] };

function dir() {
  var r = core.pickDir({ exists: fs.existsSync, mkdir: function (d) { fs.mkdirSync(d); }, access: function (d) { fs.accessSync(d, fs.W_OK); } }, DIRS);
  if (r.dir) return r.dir;
  throw new Error("No writable folder on the TV (running as user " + (process.getuid ? process.getuid() : "?") + "; " + r.errors.join(", ") + ")");
}
function P() {
  var d = dir();
  return { dir: d, bin: d + "/bin", state: d + "/tailscaled.state", socket: SOCKET, logFile: d + "/tailscale.log", config: d + "/config.json", pid: d + "/tailscaled.pid", stopFlag: d + "/stopped" };
}
function log(msg) {
  var line = new Date().toISOString() + " " + msg;
  state.log.push(line); if (state.log.length > 60) state.log.shift();
  try { fs.appendFileSync(P().logFile, line + "\n"); } catch (e) {}
}
function readConfig() {
  var c = {}; try { c = JSON.parse(fs.readFileSync(P().config, "utf8")); } catch (e) {}
  return core.normalizeConfig(c);
}
function writeConfig(patch) {
  var c = readConfig();
  var merged = {};
  for (var k in c) merged[k] = c[k];
  ["auto", "hostname", "mode", "acceptDns", "socksPort"].forEach(function (k) { if (patch[k] !== undefined) merged[k] = patch[k]; });
  if (typeof patch.forward === "string") {            // one forward, "host:port"; "" clears
    if (!patch.forward.trim()) merged.forwards = [];
    else { var f = core.parseForward(patch.forward); if (!f) throw new Error("Use host:port, for example umbrel:3901"); merged.forwards = [f]; }
  }
  merged = core.normalizeConfig(merged);
  fs.writeFileSync(P().config, JSON.stringify(merged, null, 1));
  return merged;
}

function run(file, args, timeoutMs) {
  return new Promise(function (resolve, reject) {
    cp.execFile(file, args, { timeout: timeoutMs || 30000, maxBuffer: 4 * 1024 * 1024 }, function (err, out, errOut) {
      if (err) return reject(new Error((String(errOut || "").trim() || err.message).slice(0, 300)));
      resolve(String(out));
    });
  });
}
function installed() { try { fs.accessSync(P().bin + "/tailscaled", fs.X_OK); fs.accessSync(P().bin + "/tailscale", fs.X_OK); return true; } catch (e) { return false; } }
function version() { return installed() ? run(P().bin + "/tailscale", ["--version"], 8000).then(function (o) { return o.split("\n")[0].trim(); }, function () { return null; }) : Promise.resolve(null); }

function daemonPid() {
  try { var pid = parseInt(fs.readFileSync(P().pid, "utf8"), 10); if (pid > 0) { process.kill(pid, 0); return pid; } } catch (e) {}
  return 0;
}
function hasTun() { return fs.existsSync("/dev/net/tun"); }
function isRoot() { return process.getuid ? process.getuid() === 0 : false; }
function currentMode(cfg) { return core.chooseMode(cfg, hasTun(), isRoot()); }

function cliStatus() {
  if (!daemonPid()) return Promise.resolve(null);
  return run(P().bin + "/tailscale", ["--socket=" + SOCKET, "status", "--json"], 10000).then(function (o) { return JSON.parse(o); }, function () { return null; });
}

// Downloads the newest build for this CPU, checks its checksum, unpacks and puts the two programs in place.
function install() {
  if (state.busy) return Promise.reject(new Error("Already running"));
  state.busy = true; state.lastError = null;
  var p = P();
  return run("uname", ["-m"], 5000).then(function (m) {
    var arch = core.archFor(m);
    log("Installing Tailscale for " + arch);
    return core.fetchTailscale({ arch: arch, log: log });
  }).then(function (r) {
    var tmp = p.dir + "/tmp-install";
    return run("rm", ["-rf", tmp], 20000).then(function () { fs.mkdirSync(tmp); fs.writeFileSync(tmp + "/t.tgz", r.buffer); return run("tar", ["xzf", tmp + "/t.tgz", "-C", tmp], 120000); })
      .then(function () {
        var inner = fs.readdirSync(tmp).filter(function (n) { return /^tailscale_/.test(n) && fs.statSync(tmp + "/" + n).isDirectory(); })[0];
        if (!inner) throw new Error("The download did not have the expected layout");
        if (!fs.existsSync(p.bin)) fs.mkdirSync(p.bin);
        var wasRunning = daemonPid();
        if (wasRunning) { try { process.kill(wasRunning, "SIGTERM"); } catch (e) {} }
        ["tailscale", "tailscaled"].forEach(function (n) {
          fs.writeFileSync(p.bin + "/" + n + ".new", fs.readFileSync(tmp + "/" + inner + "/" + n)); fs.chmodSync(p.bin + "/" + n + ".new", 493);
          fs.renameSync(p.bin + "/" + n + ".new", p.bin + "/" + n);
        });
        return run("rm", ["-rf", tmp], 20000);
      }).then(function () { return version(); }).then(function (v) {
        if (!v) throw new Error("Tailscale was unpacked but will not run on this TV (wrong CPU type or no permission to run programs from " + p.dir + ")");
        log("Installed Tailscale " + v); state.busy = false; return { version: v };
      });
  }).catch(function (e) { state.busy = false; state.lastError = e.message; log("Install failed: " + e.message); throw e; });
}

function startDaemon(cfg) {
  var p = P(), mode = currentMode(cfg);
  if (daemonPid()) return Promise.resolve(mode);
  try { fs.unlinkSync(p.stopFlag); } catch (e) {}
  var out = fs.openSync(p.logFile, "a");
  var c = cp.spawn(p.bin + "/tailscaled", core.daemonArgs(cfg, mode, p), { detached: true, stdio: ["ignore", out, out] });
  c.unref(); fs.writeFileSync(p.pid, String(c.pid));
  log("Started tailscaled (" + mode + ") pid " + c.pid);
  return new Promise(function (resolve, reject) {
    var n = 0, t = setInterval(function () {
      n++; if (fs.existsSync(SOCKET)) { clearInterval(t); resolve(mode); } else if (n > 30) { clearInterval(t); reject(new Error("tailscaled did not start. See the log; if it says 'tun' try Mode: userspace.")); }
    }, 500);
  });
}
function startForwards(cfg) {
  if (!cfg.forwards.length) return;
  var p = P(), out = fs.openSync(p.logFile, "a");
  try { run("pkill", ["-f", "forward.js " + p.config], 5000).catch(function () {}); } catch (e) {}
  setTimeout(function () {
    var c = cp.spawn(process.execPath, [__dirname + "/forward.js", p.config], { detached: true, stdio: ["ignore", out, out] }); c.unref();
    log("Forwarding " + cfg.forwards.map(function (f) { return "127.0.0.1:" + f.listen + " -> " + f.host + ":" + f.port; }).join(", "));
  }, 600);
}

// Connect. With a key it logs in at once; without one it reconnects, or (first time) produces a sign-in address to open on a phone.
function connect(authKey) {
  var cfg = readConfig(), p = P();
  if (!installed()) return Promise.reject(new Error("Install Tailscale first"));
  return startDaemon(cfg).then(function (mode) {
    var args = core.upArgs(cfg, p, authKey || "");
    var proc = cp.spawn(p.bin + "/tailscale", args, { detached: true, stdio: ["ignore", fs.openSync(p.logFile, "a"), fs.openSync(p.logFile, "a")] }); proc.unref();
    log("Connecting (" + (authKey ? "with key" : "no key") + ")");
    startForwards(cfg);
    return { mode: mode };
  });
}
function disconnect() {
  var p = P();
  fs.writeFileSync(p.stopFlag, "1");              // stops the boot hook from bringing it back until the next Connect
  var pid = daemonPid();
  return (pid ? run(p.bin + "/tailscale", ["--socket=" + SOCKET, "down"], 15000).catch(function () {}) : Promise.resolve()).then(function () {
    if (pid) { try { process.kill(pid, "SIGTERM"); } catch (e) {} }
    try { fs.unlinkSync(p.pid); } catch (e) {}
    run("pkill", ["-f", "forward.js " + p.config], 5000).catch(function () {});
    log("Disconnected"); return {};
  });
}
function logout() {
  var p = P();
  return (daemonPid() ? run(p.bin + "/tailscale", ["--socket=" + SOCKET, "logout"], 20000).catch(function () {}) : Promise.resolve()).then(function () { return disconnect(); }).then(function () {
    try { fs.unlinkSync(p.state); } catch (e) {}
    log("Logged out and forgot this TV's Tailscale identity"); return {};
  });
}

function setBoot(on) {
  var cfg = readConfig(), p = P(), mode = currentMode(cfg), done = null;
  for (var i = 0; i < INIT_DIRS.length && !done; i++) {
    try {
      if (!fs.existsSync(INIT_DIRS[i])) continue;
      var f = INIT_DIRS[i] + "/" + BOOT_FILE;
      if (on) {
        fs.writeFileSync(f, core.bootScript({ bin: p.bin, dir: p.dir, logFile: p.logFile, socket: SOCKET, state: p.state, node: process.execPath, forwardJs: __dirname + "/forward.js", configFile: p.config,
          daemonArgs: core.daemonArgs(cfg, mode, p), upArgs: core.upArgs(cfg, p, ""), stopFlag: p.stopFlag }));
        fs.chmodSync(f, 493);
      } else if (fs.existsSync(f)) fs.unlinkSync(f);
      done = f;
    } catch (e) {}
  }
  if (!done) throw new Error("Could not find or write Homebrew Channel's init.d folder (is the TV rooted with Homebrew Channel?)");
  return { path: done, on: on };
}
function bootState() {
  for (var i = 0; i < INIT_DIRS.length; i++) if (fs.existsSync(INIT_DIRS[i] + "/" + BOOT_FILE)) return true;
  return false;
}

function reply(message, fn) {
  var pr; try { pr = Promise.resolve(fn(message.payload || {})); } catch (e) { pr = Promise.reject(e); }
  pr.then(function (r) { r = r || {}; r.returnValue = true; message.respond(r); },
          function (e) { message.respond({ returnValue: false, errorText: e.message }); });
}

service.register("status", function (m) {
  reply(m, function () {
    var cfg = readConfig();
    return Promise.all([version(), cliStatus()]).then(function (r) {
      return { installed: installed(), version: r[0], daemon: !!daemonPid(), busy: state.busy, lastError: state.lastError, mode: currentMode(cfg), hasTun: hasTun(), root: isRoot(),
               config: cfg, boot: bootState(), tailnet: r[1] ? core.summarize(r[1]) : null, log: state.log.slice(-20) };
    });
  });
});
service.register("install", function (m) { reply(m, function () { return install(); }); });
service.register("connect", function (m) { reply(m, function (p) { return connect(typeof p.authKey === "string" ? p.authKey.trim() : ""); }); });
service.register("disconnect", function (m) { reply(m, function () { return disconnect(); }); });
service.register("logout", function (m) { reply(m, function () { return logout(); }); });
service.register("setConfig", function (m) {
  reply(m, function (p) { var c = writeConfig(p); if (p.auto !== undefined || bootState()) setBoot(c.auto); return { config: c, boot: bootState() }; });
});
