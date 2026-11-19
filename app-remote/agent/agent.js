"use strict";
// TV Remote agent: runs on the rooted TV (started by the TV Remote app through Homebrew Channel). It listens on NO port: it connects OUT to the
// TV Remote app on your Umbrel and does only what that server asks: one screenshot at a time, remote keys / pointer, text, app launch. All the
// work of showing the picture to people (sharing frames, slowing down when nothing changes) is done by the Umbrel server, not the TV.
// Written for the old Node on webOS 4 (Node 8): no optional chaining, no dependencies.
var http = require("http");
var fs = require("fs");
var path = require("path");
var cp = require("child_process");
var ws = require("./ws");

var VERSION = "0.1.0";
var CFG_DIR = process.env.TVREMOTE_DIR || "/var/lib/joolay-tvremote";
var CFG_FILE = path.join(CFG_DIR, "config.json");
var PID_FILE = path.join(CFG_DIR, "agent.pid");
var STATE_FILE = path.join(process.env.TVREMOTE_TMP || "/tmp", "joolay-tvremote-state.json");
var SHOT_FILE = path.join(process.env.TVREMOTE_TMP || "/tmp", "joolay-tvremote-shot.jpg");
var LUNA = process.env.TVREMOTE_LUNA || "luna-send-pub";
var DEFAULT_AGENT_PORT = 3905;
var KEYS = /^(LEFT|RIGHT|UP|DOWN|ENTER|BACK|HOME|EXIT|MENU|INFO|DASH|ASTERISK|RED|GREEN|YELLOW|BLUE|VOLUMEUP|VOLUMEDOWN|MUTE|CHANNELUP|CHANNELDOWN|PLAY|PAUSE|STOP|REWIND|FASTFORWARD|[0-9])$/;

// ---- config ----------------------------------------------------------------------------------------------------------------
function readConfig() { try { return JSON.parse(fs.readFileSync(CFG_FILE, "utf8")) || {}; } catch (e) { return {}; } }
function writeConfig(c) {
  try { fs.mkdirSync(CFG_DIR); } catch (e) {}
  fs.writeFileSync(CFG_FILE, JSON.stringify(c), { mode: 384 });
  try { fs.chmodSync(CFG_FILE, 384); } catch (e) {}
}
function cleanHost(s) {                       // "192.168.1.5", "umbrel.local:3905", "100.64.1.2" -> { host, port }
  var m = /^\s*(?:https?:\/\/)?([A-Za-z0-9]([A-Za-z0-9.\-]{0,251}[A-Za-z0-9])?)(?::(\d{2,5}))?\s*\/?\s*$/.exec(String(s || ""));
  if (!m) return null;
  var port = m[3] ? Number(m[3]) : DEFAULT_AGENT_PORT; if (port < 1 || port > 65535) return null;
  return { host: m[1], port: port };
}
function setState(o) { try { fs.writeFileSync(STATE_FILE, JSON.stringify(o)); } catch (e) {} }

// ---- pairing: POST the 4-digit code shown by the Umbrel app; keep the long token it answers with -----------------------
function pair(addr, code, name, cb) {
  var a = cleanHost(addr); if (!a) return cb(new Error("That Umbrel address does not look right"));
  if (!/^\d{4}$/.test(String(code || ""))) return cb(new Error("The code is 4 digits"));
  var body = JSON.stringify({ code: String(code), name: name || "LG TV" }), done = false;
  var req = http.request({ host: a.host, port: a.port, path: "/agent/pair", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }, timeout: 10000 }, function (res) {
    var ch = []; res.on("data", function (d) { ch.push(d); });
    res.on("end", function () {
      if (done) return; done = true; var j = {}; try { j = JSON.parse(Buffer.concat(ch).toString("utf8")); } catch (e) {}
      if (!j.ok || !j.token) return cb(new Error(j.error || ("The Umbrel app answered " + res.statusCode)));
      var c = readConfig(); c.umbrel = a.host + ":" + a.port; c.token = j.token; c.tvId = j.id; c.name = name || "LG TV"; writeConfig(c);
      cb(null, { umbrel: c.umbrel, tvId: j.id });
    });
  });
  req.on("timeout", function () { req.destroy(new Error("The Umbrel app did not answer")); });
  req.on("error", function (e) { if (done) return; done = true; cb(e); });
  req.end(body);
}

// ---- luna ----------------------------------------------------------------------------------------------------------------
function luna(uri, params, cb, bin) {
  var prog = bin || LUNA;
  cp.execFile(prog, ["-n", "1", "-f", uri, JSON.stringify(params || {})], { timeout: 15000, maxBuffer: 1 << 20 }, function (err, out) {
    if (err && err.code === "ENOENT" && !bin && prog === "luna-send-pub") return luna(uri, params, cb, "luna-send");
    var s = String(out || ""), j = null; try { j = JSON.parse(s.slice(s.indexOf("{"))); } catch (e) {}
    if (!j) return cb(new Error(err ? String(err.message).split("\n")[0] : "no answer from the TV"), null);
    if (j.returnValue === false) return cb(new Error(j.errorText || "refused"), j);
    cb(null, j);
  });
}
var capSvc = null;
function capture(w, cb) {
  w = Math.max(320, Math.min(1280, Number(w) || 960)); var h = Math.round(w * 9 / 16);
  var names = capSvc ? [capSvc] : ["com.webos.service.capture", "com.webos.service.tv.capture"], i = 0;
  (function next() {
    var svc = names[i++];
    luna("luna://" + svc + "/executeOneShot", { path: SHOT_FILE, method: "DISPLAY", format: "JPG", width: w, height: h }, function (err) {
      if (!err) { capSvc = svc; return fs.readFile(SHOT_FILE, cb); }
      if (i < names.length) return next();
      cb(err);
    });
  })();
}

// ---- pointer input socket (remote keys) ------------------------------------------------------------------------------------
var psock = null, popening = false, pwait = [];
function pointer(cb) {
  if (psock && !psock.socket.destroyed) return cb(null, psock);
  pwait.push(cb); if (popening) return; popening = true;
  function fin(err, c) { popening = false; var w = pwait; pwait = []; w.forEach(function (f) { f(err, c); }); }
  luna("luna://com.webos.service.networkinput/getPointerInputSocket", {}, function (err, j) {
    if (err || !j || !j.socketPath) return fin(err || new Error("no pointer socket path"));
    ws.connect(j.socketPath, {}, function (e2, c) {
      if (e2) return fin(e2);
      psock = c; c.on("close", function () { if (psock === c) psock = null; }); c.on("message", function () {});
      fin(null, c);
    });
  });
}
function sendPointer(text, cb) {
  pointer(function (err, c) {
    if (err) return cb(err);
    try { c.sendText(text); cb(null); } catch (e) { psock = null; cb(e); }
  });
}

// ---- commands from the Umbrel server -----------------------------------------------------------------------------------------
var busyShot = false;
function handle(conn, m) {
  function reply(err) { conn.sendText(JSON.stringify(err ? { id: m.id, ok: false, error: err.message } : { id: m.id, ok: true })); }
  if (m.cmd === "shot") {
    if (busyShot) return reply(new Error("busy"));
    busyShot = true;
    return capture(m.w, function (err, b) {
      busyShot = false;
      if (err || !b || !b.length) return reply(err || new Error("empty picture"));
      var head = Buffer.alloc(4); head.writeUInt32BE(m.id >>> 0, 0); conn.sendBinary(Buffer.concat([head, b]));
    });
  }
  if (m.cmd === "key") return typeof m.name === "string" && KEYS.test(m.name) ? sendPointer("type:button\nname:" + m.name + "\n\n", reply) : reply(new Error("Unknown key"));
  if (m.cmd === "move") return sendPointer("type:move\ndx:" + Math.max(-300, Math.min(300, Math.round(Number(m.dx) || 0))) + "\ndy:" + Math.max(-300, Math.min(300, Math.round(Number(m.dy) || 0))) + "\ndown:0\n\n", reply);
  if (m.cmd === "click") return sendPointer("type:click\n\n", reply);
  if (m.cmd === "launch") {
    if (typeof m.app !== "string" || !/^[A-Za-z0-9._-]{1,100}$/.test(m.app)) return reply(new Error("Bad app id"));
    return luna("luna://com.webos.service.applicationManager/launch", { id: m.app, params: m.params && typeof m.params === "object" ? m.params : {} }, reply);
  }
  if (m.cmd === "text") {
    if (typeof m.text !== "string" || m.text.length > 200) return reply(new Error("Bad text"));
    return luna("luna://com.webos.service.ime/insertText", { text: m.text, replace: 0 }, reply);
  }
  reply(new Error("Unknown command"));
}

// ---- stay connected --------------------------------------------------------------------------------------------------------
function run(opts) {
  opts = opts || {};
  var cfg = readConfig(), a = cleanHost(cfg.umbrel);
  if (!cfg.token || !a) { setState({ connected: false, error: "Not paired yet" }); console.error("Not paired. Run: agent.js pair <umbrel address> <4-digit code>"); return null; }
  try { fs.writeFileSync(PID_FILE, String(process.pid)); } catch (e) {}
  var delay = 2000, stopped = false, cur = null, watchdog = null;
  function loop() {
    if (stopped) return;
    ws.connect("ws://" + a.host + ":" + a.port + "/agent/ws", { Authorization: "Bearer " + cfg.token }, function (err, conn) {
      if (err) {
        setState({ connected: false, error: err.message, at: Date.now() });
        if (/401/.test(err.message)) setState({ connected: false, error: "The Umbrel app no longer knows this TV. Pair again.", at: Date.now() });
        delay = Math.min(60000, delay * 2); return setTimeout(loop, delay);
      }
      cur = conn; delay = 2000; setState({ connected: true, since: Date.now(), umbrel: cfg.umbrel });
      conn.sendText(JSON.stringify({ hello: true, version: VERSION, name: cfg.name }));
      var ping = setInterval(function () { if (!conn.alive) { conn.close(); return; } conn.alive = false; conn.ping(); }, 30000);
      conn.on("message", function (data, isBin) { if (isBin) return; var m; try { m = JSON.parse(data.toString("utf8")); } catch (e) { return; } if (m && typeof m.id === "number") handle(conn, m); });
      conn.on("close", function () { clearInterval(ping); cur = null; setState({ connected: false, error: "Disconnected, retrying", at: Date.now() }); if (!stopped) setTimeout(loop, 2000); });
    });
  }
  loop();
  return { stop: function () { stopped = true; if (cur) cur.close(); } };
}

module.exports = { run: run, pair: pair, cleanHost: cleanHost, VERSION: VERSION, KEYS: KEYS };

if (require.main === module) {
  var cmd = process.argv[2];
  if (cmd === "pair") {
    pair(process.argv[3], process.argv[4], process.argv[5], function (err, r) { console.log(JSON.stringify(err ? { ok: false, error: err.message } : { ok: true, umbrel: r.umbrel })); process.exit(err ? 1 : 0); });
  } else if (cmd === "status") {
    var c = readConfig(), st = {}; try { st = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch (e) {}
    console.log(JSON.stringify({ paired: !!c.token, umbrel: c.umbrel || "", name: c.name || "", connected: !!st.connected, error: st.error || "", version: VERSION }));
  } else if (cmd === "unpair") { var c2 = readConfig(); delete c2.token; delete c2.tvId; writeConfig(c2); console.log('{"ok":true}'); }
  else if (!run()) process.exit(2);
}
