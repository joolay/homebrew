"use strict";
var http = require("http"), crypto = require("crypto"), fs = require("fs"), os = require("os"), assert = require("assert");
var core = require("../core");

assert.strictEqual(core.compareVersions("2.0.10", "2.0.9"), 1);
assert.strictEqual(core.compareVersions("2.0", "2.0.0"), 0);
assert.strictEqual(core.compareVersions("1.9.9", "2.0.0"), -1);

var good = Buffer.from("good ipk bytes"), evil = Buffer.from("tampered");
var sha = function (b) { return crypto.createHash("sha256").update(b).digest("hex"); };
var base;
var files = {
  "/feed.json": function () { return { packages: ["a", "b", "c", "d", "self"].map(function (n) { return { id: "app." + n, title: n, manifestUrl: base + "/m-" + n + ".json" }; }) }; },
  "/m-a.json": function () { return { id: "app.a", version: "1.1.0", ipkUrl: "a.ipk", ipkHash: { sha256: sha(good) }, ipkSize: good.length }; },   // update, ok (relative url)
  "/m-b.json": function () { return { id: "app.b", version: "1.0.0", ipkUrl: base + "/a.ipk", ipkHash: { sha256: sha(good) } }; },                         // current
  "/m-c.json": function () { return { id: "app.c", version: "3.0.0", ipkUrl: base + "/evil.ipk", ipkHash: { sha256: sha(good) }, ipkSize: good.length }; }, // bad checksum
  "/m-d.json": function () { return { id: "app.d", version: "1.0.0", ipkUrl: base + "/a.ipk", ipkHash: { sha256: sha(good) } }; },                         // not installed
  "/m-self.json": function () { return { id: "app.self", version: "1.0.1", ipkUrl: base + "/a.ipk", ipkHash: { sha256: sha(good) }, ipkSize: good.length }; }
};
var srv = http.createServer(function (q, r) {
  if (q.url === "/a.ipk") return r.end(good);
  if (q.url === "/evil.ipk") return r.end(evil);
  var f = files[q.url]; if (!f) { r.statusCode = 404; return r.end(); }
  r.end(JSON.stringify(f()));
}).listen(0, "127.0.0.1", function () {
  base = "http://127.0.0.1:" + srv.address().port;
  var installed = { "app.a": "1.0.0", "app.b": "1.0.0", "app.c": "1.0.0", "app.self": "1.0.0" }, order = [];
  var tmp = fs.mkdtempSync(os.tmpdir() + "/upd-");
  core.run({
    feedUrl: base + "/feed.json", allowHttp: true, selfId: "app.self", tmpDir: tmp, ignore: [], isRoot: true,
    listInstalled: function () { return Promise.resolve(JSON.parse(JSON.stringify(installed))); },
    installIpk: function (file, id) { order.push(id); assert.ok(fs.readFileSync(file).equals(good)); installed[id] = id === "app.a" ? "1.1.0" : "1.0.1"; return Promise.resolve(); },
    log: function () {}
  }).then(function (items) {
    var st = {}; items.forEach(function (i) { st[i.id] = i.state; });
    assert.deepStrictEqual(st, { "app.a": "updated", "app.b": "current", "app.c": "failed", "app.d": "not-installed", "app.self": "updated" });
    assert.deepStrictEqual(order, ["app.a", "app.self"], "self installs last, tampered file never installed");
    assert.ok(/Checksum/.test(items.filter(function (i) { return i.id === "app.c"; })[0].error));
    assert.deepStrictEqual(fs.readdirSync(tmp), [], "temp IPKs cleaned up");
    // only: look at one app, leave the others alone
    installed["app.a"] = "1.0.0"; installed["app.self"] = "1.0.0"; order.length = 0;
    return core.run({ feedUrl: base + "/feed.json", allowHttp: true, selfId: "app.self", tmpDir: tmp, ignore: [], only: ["app.a"],
      listInstalled: function () { return Promise.resolve(JSON.parse(JSON.stringify(installed))); },
      installIpk: function (f, id) { order.push(id); installed[id] = "1.1.0"; return Promise.resolve(); }, log: function () {} }).then(function (items) {
      assert.deepStrictEqual(items.map(function (i) { return i.id; }), ["app.a"]); assert.deepStrictEqual(order, ["app.a"], "only the named app is installed");
    }).then(function () {
    // https-only by default
    return core.plan({ feedUrl: base + "/feed.json", installed: {} }).then(function () { throw new Error("should refuse http"); }, function (e) { assert.ok(/https/.test(e.message)); });
    });
  }).then(function () { console.log("all tests passed"); srv.close(); }).catch(function (e) { console.error("FAIL", e); process.exit(1); });
});
