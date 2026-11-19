"use strict";
var http = require("http"), net = require("net"), assert = require("assert");
var core = require("../core");

// ---- config
var c = core.normalizeConfig({ hostname: "Living Room TV!", mode: "nonsense", socksPort: 99999, forwards: [{ listen: 3901, host: "umbrel", port: 3901 }, { listen: 0, host: "x", port: 1 }, { listen: 80, host: "bad host", port: 80 }], evil: 1 });
assert.strictEqual(c.hostname, "living-room-tv"); assert.strictEqual(c.mode, "auto"); assert.strictEqual(c.socksPort, 1055);
assert.deepStrictEqual(c.forwards, [{ listen: 3901, host: "umbrel", port: 3901 }]); assert.strictEqual(c.evil, undefined);
assert.deepStrictEqual(core.parseForward(" umbrel:3901 "), { listen: 3901, host: "umbrel", port: 3901 });
assert.strictEqual(core.parseForward("umbrel"), null); assert.strictEqual(core.parseForward("a b:80"), null); assert.strictEqual(core.parseForward("x:70000"), null);

// ---- install folder: makes missing parents, skips folders it cannot write, and says why when none work
var made = {};
var fakeFs = function (denyAccess, denyMkdir) { return { exists: function (d) { return !!made[d] || d === "/" || d === "/media" || d === "/var"; }, mkdir: function (d) { if (denyMkdir && d.indexOf(denyMkdir) === 0) { var e = new Error("no"); e.code = "EACCES"; throw e; } made[d] = 1; }, access: function (d) { if (denyAccess === d) { var e = new Error("no"); e.code = "EACCES"; throw e; } } }; };
assert.deepStrictEqual(core.pickDir(fakeFs(), ["/media/developer/x"]), { dir: "/media/developer/x" }); assert.ok(made["/media/developer"], "parent folder is created too");
made = {}; assert.deepStrictEqual(core.pickDir(fakeFs("/media/developer/x"), ["/media/developer/x", "/var/lib/x"]), { dir: "/var/lib/x" });
made = {}; var none = core.pickDir(fakeFs("/a", "/var"), ["/a", "/var/lib/x"]); assert.strictEqual(none.dir, undefined); assert.ok(/^\/a: EACCES/.test(none.errors[0]) && /^\/var\/lib\/x: EACCES/.test(none.errors[1]), "reasons are reported");

// ---- build choice
assert.strictEqual(core.archFor("armv7l"), "arm"); assert.strictEqual(core.archFor("aarch64"), "arm64"); assert.strictEqual(core.archFor("x86_64"), "amd64");
assert.throws(function () { core.archFor("mips"); });
var pick = core.pickTarball({ TarballsVersion: "1.80.0", Tarballs: { arm: "tailscale_1.80.0_arm.tgz", bad: "../evil.tgz" } }, "arm", "https://x/");
assert.deepStrictEqual(pick, { version: "1.80.0", file: "tailscale_1.80.0_arm.tgz", url: "https://x/tailscale_1.80.0_arm.tgz", shaUrl: "https://x/tailscale_1.80.0_arm.tgz.sha256" });
assert.throws(function () { core.pickTarball({ Tarballs: { bad: "../evil.tgz" } }, "bad"); }); assert.throws(function () { core.pickTarball({ Tarballs: {} }, "arm"); });
var H = "a".repeat(64);
assert.strictEqual(core.parseSha(H + "  tailscale_1.80.0_arm.tgz\n"), H); assert.strictEqual(core.parseSha(H.toUpperCase()), H); assert.throws(function () { core.parseSha("nope"); });

// ---- command lines
assert.strictEqual(core.chooseMode({ mode: "auto" }, true, true), "tun"); assert.strictEqual(core.chooseMode({ mode: "auto" }, true, false), "userspace");
assert.strictEqual(core.chooseMode({ mode: "auto" }, false, true), "userspace"); assert.strictEqual(core.chooseMode({ mode: "tun" }, false, false), "tun");
var cfg = core.normalizeConfig({}), paths = { state: "/s", socket: "/k" };
assert.ok(core.daemonArgs(cfg, "userspace", paths).indexOf("--tun=userspace-networking") >= 0); assert.ok(core.daemonArgs(cfg, "tun", paths).indexOf("--tun=userspace-networking") < 0);
var up = core.upArgs(cfg, paths, "tskey-auth-abcdefghij123456"); assert.ok(up.indexOf("--auth-key=tskey-auth-abcdefghij123456") >= 0); assert.ok(up.indexOf("--accept-dns=false") >= 0);
assert.ok(!core.upArgs(cfg, paths, "").some(function (a) { return /auth-key/.test(a); })); assert.throws(function () { core.upArgs(cfg, paths, "tskey-x; rm -rf /"); });
var boot = core.bootScript({ bin: "/b", dir: "/d", logFile: "/l", socket: "/k", state: "/s", node: "/usr/bin/node", forwardJs: "/f.js", configFile: "/c", daemonArgs: core.daemonArgs(cfg, "tun", paths), upArgs: core.upArgs(cfg, paths, ""), stopFlag: "/stopped" });
assert.ok(/^#!\/bin\/sh/.test(boot) && /'\/b\/tailscaled'/.test(boot) && !/auth-key/.test(boot), "boot script never carries a key");
assert.strictEqual(core.shq("a'b"), "'a'\\''b'");

// ---- status
var s = core.summarize({ BackendState: "Running", Self: { HostName: "lg-tv", DNSName: "lg-tv.x.ts.net.", TailscaleIPs: ["100.1.1.1"] }, Health: ["a"],
  Peer: { k1: { HostName: "umbrel", DNSName: "umbrel.x.ts.net.", TailscaleIPs: ["100.2.2.2"], Online: true, OS: "linux" }, k2: { HostName: "alpha", Online: false, TailscaleIPs: [] } } });
assert.strictEqual(s.connected, true); assert.strictEqual(s.self.dns, "lg-tv.x.ts.net"); assert.strictEqual(s.peers[0].name, "umbrel"); assert.strictEqual(s.peers[0].dns, "umbrel.x.ts.net"); assert.strictEqual(s.peers[1].online, false);
var n = core.summarize({ BackendState: "NeedsLogin", AuthURL: "https://login.tailscale.com/a/abc" }); assert.strictEqual(n.connected, false); assert.strictEqual(n.authUrl, "https://login.tailscale.com/a/abc");
assert.strictEqual(core.summarize({ AuthURL: "javascript:alert(1)" }).authUrl, ""); assert.strictEqual(core.summarize(null).state, "Unknown");

// ---- download: tampered file is refused, good one accepted
var good = Buffer.from("good tarball"), evil = Buffer.from("tampered"), base, hits = [];
var web = http.createServer(function (q, r) {
  hits.push(q.url);
  if (q.url === "/stable/?mode=json") return r.end(JSON.stringify({ TarballsVersion: "9.9.9", Tarballs: { arm: "tailscale_9.9.9_arm.tgz", arm64: "tailscale_9.9.9_arm64.tgz" } }));
  if (q.url === "/stable/tailscale_9.9.9_arm.tgz") return r.end(good);
  if (q.url === "/stable/tailscale_9.9.9_arm.tgz.sha256") return r.end(core.sha256(good) + "  tailscale_9.9.9_arm.tgz\n");
  if (q.url === "/stable/tailscale_9.9.9_arm64.tgz") return r.end(evil);
  if (q.url === "/stable/tailscale_9.9.9_arm64.tgz.sha256") return r.end(core.sha256(good) + "\n");
  r.statusCode = 404; r.end();
});

// ---- SOCKS5 + forwarder: a fake proxy that records the requested host and bridges to an echo server
var echo = net.createServer(function (c) { c.on("data", function (d) { c.write(Buffer.concat([Buffer.from("echo:"), d])); }); });
var asked = [], refuse = false;
var socks = net.createServer(function (c) {
  var step = 0;
  c.on("data", function (d) {
    if (step === 0) { assert.deepStrictEqual([].slice.call(d), [5, 1, 0]); c.write(Buffer.from([5, 0])); step = 1; return; }
    if (step === 1) {
      var len = d[4], host = d.slice(5, 5 + len).toString(), port = d.readUInt16BE(5 + len); asked.push(host + ":" + port); step = 2;
      if (refuse) return c.write(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0]));
      var up = net.connect(echo.address().port, "127.0.0.1", function () { c.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0])); c.pipe(up); up.pipe(c); });
      c.removeAllListeners("data");
    }
  });
  c.on("error", function () {});
});

web.listen(0, "127.0.0.1", function () {
  base = "http://127.0.0.1:" + web.address().port + "/stable/";
  core.fetchTailscale({ arch: "arm", base: base, allowHttp: true }).then(function (r) {
    assert.strictEqual(r.version, "9.9.9"); assert.ok(r.buffer.equals(good));
    return core.fetchTailscale({ arch: "arm64", base: base, allowHttp: true }).then(function () { throw new Error("tampered download was accepted"); }, function (e) { assert.ok(/Checksum/.test(e.message)); });
  }).then(function () {
    return core.fetchTailscale({ arch: "arm", base: base.replace("http:", "https:") }).then(function () { throw new Error("plain http/https mismatch accepted"); }, function () {});
  }).then(function () {
    return core.fetchTailscale({ arch: "arm", base: base, allowHttp: false }).then(function () { throw new Error("http accepted without allowHttp"); }, function (e) { assert.ok(/https/.test(e.message)); });
  }).then(function () {
    echo.listen(0, "127.0.0.1", function () { socks.listen(0, "127.0.0.1", function () {
      var proxy = socks.address().port, fwd = net.createServer().listen(0, "127.0.0.1", function () {
        var port = fwd.address().port; fwd.close();
        var f = core.makeForwarder({ listen: port, host: "umbrel", port: 3901 }, proxy, function () {});
        f.on("listening", function () {
          var c = net.connect(port, "127.0.0.1"); c.write("hello");
          c.once("data", function (d) {
            assert.strictEqual(d.toString(), "echo:hello"); assert.deepStrictEqual(asked, ["umbrel:3901"]); c.destroy();
            refuse = true;                                  // proxy says "connection refused": the TV side must just be closed, nothing thrown
            var c2 = net.connect(port, "127.0.0.1"); c2.on("close", function () {
              f.close(); socks.close(); echo.close(); web.close(); console.log("tailscale service tests: ok"); process.exit(0);
            }); c2.on("error", function () {});
          });
        });
      });
    }); });
  }).catch(function (e) { console.error(e); process.exit(1); });
});
setTimeout(function () { console.error("timeout"); process.exit(1); }, 20000).unref();
