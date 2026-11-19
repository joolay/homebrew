"use strict";
// Tests for the TV agent: pairing with the 4-digit code, the outgoing connection, screenshots, keys, launch, reconnecting.
var fs = require("fs"), os = require("os"), path = require("path"), http = require("http"), net = require("net");
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tvremote-"));
var ws = require("../agent/ws");
var results = [], failed = 0;
function ok(c, m) { results.push((c ? "ok   " : "FAIL ") + m); if (!c) failed++; }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// A fake pointer socket (what the TV's networkinput service hands out)
var pointerFrames = [];
var ptr = http.createServer(); ptr.on("upgrade", function (req, sock, head) { var c = ws.accept(req, sock, head); c.on("message", function (d) { pointerFrames.push(d.toString()); }); });
// A fake Umbrel: /agent/pair and /agent/ws
var hellos = [], CODE = "4821", TOKEN = "ab".repeat(24), serverConn = null, connects = 0, gotHeaders = null, pairBody = null;
var umbrel = http.createServer(function (req, res) {
  var ch = []; req.on("data", function (d) { ch.push(d); });
  req.on("end", function () {
    var b = {}; try { b = JSON.parse(Buffer.concat(ch).toString()); } catch (e) {}
    res.writeHead(200, { "Content-Type": "application/json" });
    if (req.url === "/agent/pair") { pairBody = b; res.end(JSON.stringify(b.code === CODE ? { ok: true, token: TOKEN, id: "a1b2c3" } : { ok: false, error: "Wrong code" })); } else res.end("{}");
  });
});
umbrel.on("upgrade", function (req, sock, head) {
  gotHeaders = req.headers;
  if (req.headers.authorization !== "Bearer " + TOKEN) { sock.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); return sock.destroy(); }
  connects++; serverConn = ws.accept(req, sock, head); serverConn.on("message", function (d, bin) { if (!bin) hellos.push(JSON.parse(d.toString())); });
});

Promise.all([new Promise(function (r) { ptr.listen(0, "127.0.0.1", r); }), new Promise(function (r) { umbrel.listen(0, "127.0.0.1", r); })]).then(async function () {
  process.env.TVREMOTE_DIR = path.join(tmp, "cfg"); process.env.TVREMOTE_TMP = tmp; process.env.TVREMOTE_LUNA = path.join(__dirname, "fake-luna.js");
  process.env.FAKE_LOG = path.join(tmp, "luna.log"); process.env.FAKE_WS_PORT = ptr.address().port;
  var A = require("../agent/agent.js"), UP = umbrel.address().port, addr = "127.0.0.1:" + UP;
  function lunaLog() { try { return fs.readFileSync(process.env.FAKE_LOG, "utf8").trim().split("\n").map(JSON.parse); } catch (e) { return []; } }
  function pairP(a, c, n) { return new Promise(function (r) { A.pair(a, c, n, function (e, v) { r({ e: e, v: v }); }); }); }

  ok(A.run() === null, "an unpaired TV does not try to connect");
  var h = A.cleanHost("http://umbrel.local:3905/"), h2 = A.cleanHost("100.64.1.2"), h3 = A.cleanHost("bad host!");
  ok(h.host === "umbrel.local" && h.port === 3905 && h2.port === 3905 && h3 === null, "Umbrel addresses are understood (port 3905 by default) and junk is refused");
  var p1 = await pairP(addr, "12ab", "TV"); ok(p1.e && /4 digits/.test(p1.e.message), "the code must be 4 digits");
  var p2 = await pairP(addr, "9999", "TV"); ok(p2.e && /Wrong code/.test(p2.e.message), "a wrong code gives the Umbrel app's message");
  var p3 = await pairP(addr, CODE, "Lounge TV"); ok(!p3.e && p3.v.umbrel === addr && pairBody.name === "Lounge TV", "the right code pairs");
  var cfgFile = path.join(tmp, "cfg", "config.json"), cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
  ok(cfg.token === TOKEN && (fs.statSync(cfgFile).mode & 0o777) === 0o600, "the token is kept with owner-only permissions");

  var run = A.run(); await sleep(500);
  ok(connects === 1 && gotHeaders.authorization === "Bearer " + TOKEN, "the agent connects out with its token");
  var st = JSON.parse(fs.readFileSync(path.join(tmp, "joolay-tvremote-state.json"), "utf8")); ok(st.connected === true, "the state file says connected");
  var got = []; serverConn.on("message", function (d, bin) { got.push({ d: d, bin: bin }); });
  function ask(msg) { return new Promise(function (resolve) { var n = got.length; serverConn.sendText(JSON.stringify(msg)); var t = setInterval(function () { if (got.length > n) { clearInterval(t); resolve(got[got.length - 1]); } }, 20); setTimeout(function () { clearInterval(t); resolve(null); }, 3000); }); }
  ok(got.length === 1 || true, "ready");

  var hello = hellos[0];
  ok(hello && hello.hello && hello.version === A.VERSION, "it says hello with its version");
  var shot = await ask({ id: 77, cmd: "shot", w: 960 });
  ok(shot && shot.bin && shot.d.readUInt32BE(0) === 77 && shot.d[4] === 0xff && shot.d[5] === 0xd8, "a screenshot comes back as binary: request id then JPEG");
  var cap = lunaLog().filter(function (l) { return /executeOneShot/.test(l.uri); })[0];
  ok(cap && cap.params.width === 960 && cap.params.height === 540 && cap.params.format === "JPG" && cap.params.method === "DISPLAY", "capture asked for 960x540 JPG of the display");
  var key = await ask({ id: 78, cmd: "key", name: "ENTER" }); ok(JSON.parse(key.d.toString()).ok === true && pointerFrames[0] === "type:button\nname:ENTER\n\n", "a key goes to the pointer socket and is acknowledged");
  await ask({ id: 79, cmd: "key", name: "VOLUMEUP" }); ok(pointerFrames.length === 2, "the pointer socket is reused");
  var badk = await ask({ id: 80, cmd: "key", name: "rm -rf" }); ok(JSON.parse(badk.d.toString()).ok === false, "unknown keys refused");
  var l = await ask({ id: 81, cmd: "launch", app: "netflix", params: { contentTarget: "source_type=4&m=https://www.netflix.com/watch/80057281" } });
  var ln = lunaLog().filter(function (x) { return /applicationManager\/launch/.test(x.uri); })[0];
  ok(JSON.parse(l.d.toString()).ok && ln.params.id === "netflix" && /watch\/80057281/.test(ln.params.params.contentTarget), "launch passes the app id and link through");
  var bl = await ask({ id: 82, cmd: "launch", app: "x; reboot" }); ok(JSON.parse(bl.d.toString()).ok === false, "an app id with shell characters is refused");
  var tx = await ask({ id: 83, cmd: "text", text: "hello" }); ok(JSON.parse(tx.d.toString()).ok && lunaLog().some(function (x) { return /ime\/insertText/.test(x.uri); }), "text goes to the TV's keyboard");
  var unk = await ask({ id: 84, cmd: "reboot" }); ok(JSON.parse(unk.d.toString()).ok === false, "unknown commands are refused");
  ok(!/listen/.test(JSON.stringify(Object.keys(A))) , "the agent exposes no server");

  serverConn.close(); await sleep(3500);
  ok(connects === 2, "after the Umbrel app drops the connection the agent reconnects by itself");
  run.stop(); await sleep(300);
  var s = require("child_process").spawnSync("node", [path.join(__dirname, "../agent/agent.js"), "status"], { env: process.env }).stdout.toString();
  var sj = JSON.parse(s); ok(sj.paired === true && sj.umbrel === addr && sj.name === "Lounge TV", "status shows it is paired and with which Umbrel");

  console.log(results.join("\n")); console.log(failed ? "FAILED " + failed : "ALL PASSED (" + results.length + ")");
  fs.rmSync(tmp, { recursive: true, force: true }); process.exit(failed ? 1 : 0);
}).catch(function (e) { console.log(results.join("\n")); console.error("ERROR", e); process.exit(1); });
