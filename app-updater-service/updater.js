"use strict";
// webOS service: io.joolay.tvupdater.service  (needs a rooted TV with Homebrew Channel)
var fs = require("fs");
var cp = require("child_process");
var core = require("./core");

var Service = require("webos-service");
var service = new Service("io.joolay.tvupdater.service");

var SELF = "io.joolay.tvupdater";
var DIRS = ["/media/developer/joolay-updater", "/tmp/joolay-updater"];
var INIT_DIRS = ["/var/lib/webosbrew/init.d", "/media/cryptofs/apps/usr/palm/services/org.webosbrew.hbchannel.service/init.d"];
var BOOT_FILE = "90-joolay-updater";

var DEFAULTS = { feedUrl: core.DEFAULT_FEED, auto: true, intervalHours: 24, ignore: [] };
var state = { running: false, lastRun: null, lastResult: [], lastError: null, log: [] };

function dir() {
  for (var i = 0; i < DIRS.length; i++) {
    try { if (!fs.existsSync(DIRS[i])) fs.mkdirSync(DIRS[i]); fs.accessSync(DIRS[i], fs.W_OK); return DIRS[i]; } catch (e) {}
  }
  throw new Error("No writable folder on the TV");
}
function log(msg) {
  var line = new Date().toISOString() + " " + msg;
  state.log.push(line); if (state.log.length > 60) state.log.shift();
  try { fs.appendFileSync(dir() + "/updater.log", line + "\n"); } catch (e) {}
}
function readConfig() {
  var c = {}; try { c = JSON.parse(fs.readFileSync(dir() + "/config.json", "utf8")); } catch (e) {}
  var o = {}; for (var k in DEFAULTS) o[k] = c[k] === undefined ? DEFAULTS[k] : c[k];
  return o;
}
function writeConfig(patch) {
  var c = readConfig();
  if (typeof patch.feedUrl === "string" && /^https:\/\//.test(patch.feedUrl)) c.feedUrl = patch.feedUrl;
  if (typeof patch.auto === "boolean") c.auto = patch.auto;
  if (typeof patch.intervalHours === "number" && patch.intervalHours >= 1 && patch.intervalHours <= 168) c.intervalHours = Math.round(patch.intervalHours);
  if (Array.isArray(patch.ignore)) c.ignore = patch.ignore.filter(function (s) { return typeof s === "string"; });
  fs.writeFileSync(dir() + "/config.json", JSON.stringify(c, null, 1));
  return c;
}

// One luna call from the shell. -n 1 = wait for one answer.
function luna(uri, payload, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var bin = fs.existsSync("/usr/bin/luna-send-pub") ? "luna-send-pub" : "luna-send";
    cp.execFile(bin, ["-n", "1", "-f", uri, JSON.stringify(payload || {})], { timeout: timeoutMs || 30000 }, function (err, out) {
      if (err) return reject(new Error("luna call failed: " + uri + " " + err.message));
      var j; try { j = JSON.parse(String(out).trim().split("\n").pop()); } catch (e) { return reject(new Error("Bad answer from " + uri)); }
      if (j.returnValue === false) return reject(new Error(j.errorText || ("error " + j.errorCode)));
      resolve(j);
    });
  });
}
function listInstalled() {
  return luna("luna://com.webos.applicationManager/listApps", {}).then(function (j) {
    var o = {}; (j.apps || []).forEach(function (a) { o[a.id] = a.version; }); return o;
  });
}
// Same call Homebrew Channel and webOS Dev Manager use. The caller checks the new version afterwards,
// so this only has to wait for the installer to finish.
function installIpk(file, id) {
  return new Promise(function (resolve, reject) {
    var bin = fs.existsSync("/usr/bin/luna-send-pub") ? "luna-send-pub" : "luna-send";
    var p = cp.spawn(bin, ["-i", "-f", "luna://com.webos.appInstallService/dev/install", JSON.stringify({ id: id, ipkUrl: file, subscribe: true })]);
    var out = "", done = false;
    var t = setTimeout(function () { if (!done) { done = true; p.kill(); reject(new Error("Install timed out")); } }, 180000);
    p.stdout.on("data", function (d) {
      out += d;
      if (/"installed"|Install(ation)? complete|"state"\s*:\s*"installed"/i.test(out) && !done) { done = true; clearTimeout(t); p.kill(); resolve(); }
      if (/"returnValue"\s*:\s*false|"errorCode"|failed/i.test(out) && !done) { done = true; clearTimeout(t); p.kill(); reject(new Error("Installer said: " + out.trim().split("\n").pop().slice(0, 200))); }
    });
    p.on("close", function () { if (!done) { done = true; clearTimeout(t); resolve(); } }); // the version check decides
    p.on("error", function (e) { if (!done) { done = true; clearTimeout(t); reject(e); } });
  });
}

function deps(cfg, extra) {
  var o = { feedUrl: cfg.feedUrl, ignore: cfg.ignore, selfId: SELF, tmpDir: dir(), isRoot: process.getuid ? process.getuid() === 0 : false,
            listInstalled: listInstalled, installIpk: installIpk, log: log };
  for (var k in extra || {}) o[k] = extra[k];
  return o;
}

function check() {
  var cfg = readConfig();
  return listInstalled().then(function (inst) { return core.plan(deps(cfg, { installed: inst })); }).then(function (items) {
    return items.map(function (i) { delete i.manifest; delete i.manifestUrl; return i; });
  });
}
function runAll(only, relaunch) {
  if (state.running) return Promise.reject(new Error("Already running"));
  state.running = true; state.lastError = null;
  log("Run started" + (only ? " for " + only.join(",") : ""));
  return core.run(deps(readConfig(), only ? { only: only } : {})).then(function (items) {
    if (relaunch) {
      // installing an app closes it: open it again once the new version is in
      var up = items.filter(function (i) { return i.id === relaunch && i.state === "updated"; }).length;
      if (up) setTimeout(function () { luna("luna://com.webos.applicationManager/launch", { id: relaunch }).catch(function (e) { log("Relaunch failed: " + e.message); }); }, 1500);
    }
    state.lastResult = items; state.lastRun = new Date().toISOString();
    log("Run finished: " + items.filter(function (i) { return i.state === "updated"; }).length + " updated, " +
        items.filter(function (i) { return i.state === "failed"; }).length + " failed");
    state.running = false; return items;
  }).catch(function (e) { state.running = false; state.lastError = e.message; state.lastRun = new Date().toISOString(); log("Run error: " + e.message); throw e; });
}

// Boot hook for Homebrew Channel's init.d: waits for the network, runs once, then repeats every interval.
function bootScript(hours) {
  return "#!/bin/sh\n# JoolzTV updater: written by the app, remove with the app's switch\n" +
    "( sleep 120; while true; do\n" +
    "  luna-send-pub -n 1 -f luna://io.joolay.tvupdater.service/run '{\"fromBoot\":true}' >/dev/null 2>&1\n" +
    "  sleep " + (hours * 3600) + "\n" +
    "done ) &\n";
}
function setBoot(on) {
  var cfg = readConfig(), done = null;
  for (var i = 0; i < INIT_DIRS.length && !done; i++) {
    try {
      if (!fs.existsSync(INIT_DIRS[i])) continue;
      var f = INIT_DIRS[i] + "/" + BOOT_FILE;
      if (on) { fs.writeFileSync(f, bootScript(cfg.intervalHours)); fs.chmodSync(f, 493); } else if (fs.existsSync(f)) fs.unlinkSync(f);
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
  var p; try { p = Promise.resolve(fn(message.payload || {})); } catch (e) { p = Promise.reject(e); }
  p.then(function (r) { r = r || {}; r.returnValue = true; message.respond(r); },
         function (e) { message.respond({ returnValue: false, errorText: e.message }); });
}

service.register("status", function (m) { reply(m, function () { return { running: state.running, lastRun: state.lastRun, lastResult: state.lastResult, lastError: state.lastError, log: state.log.slice(-20), config: readConfig(), boot: bootState() }; }); });
service.register("check", function (m) { reply(m, function () { return check().then(function (items) { return { items: items }; }); }); });
service.register("run", function (m) { reply(m, function () { return runAll().then(function (items) { return { items: items }; }); }); });
// Called by an app that was told (by its own server) that a newer version exists. Only the app's own id is touched, and the
// feed, checksum and "already installed" rules still apply, so a wrong or hostile hint changes nothing.
service.register("updateApp", function (m) {
  reply(m, function (p) {
    if (typeof p.id !== "string" || !/^[a-z0-9.\-_]{3,80}$/i.test(p.id)) throw new Error("Bad app id");
    return runAll([p.id], p.relaunch === false ? null : p.id).then(function (items) { return { items: items, updated: items.some(function (i) { return i.state === "updated"; }) }; });
  });
});
service.register("setConfig", function (m) {
  reply(m, function (p) { var c = writeConfig(p); if (typeof p.auto === "boolean") setBoot(c.auto); return { config: c, boot: bootState() }; });
});
service.register("setBoot", function (m) { reply(m, function (p) { return setBoot(!!p.on); }); });
