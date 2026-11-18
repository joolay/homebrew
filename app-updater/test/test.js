// TV Updater 2.0: runs hb-updater.js against a fake Homebrew Channel + feed (no TV needed).
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path");
const HB = require("../hb-updater.js");
let n = 0; const ok = (c, m) => { assert(c, m); console.log("ok   " + m); n++; };
const man = (id, v, extra) => Object.assign({ id, version: v, title: id, rootRequired: false, ipkUrl: "https://x/" + id + "_" + v + ".ipk", ipkHash: { sha256: "AB".repeat(32) } }, extra || {});
function world(installed, manifests, o) {
  o = o || {}; const calls = [], execs = [];
  const feed = { packages: Object.keys(manifests).map(id => ({ id, title: id, manifestUrl: "https://x/m-" + id + ".json" })) };
  const call = (uri, p) => { calls.push(uri.split("/").pop() + " " + JSON.stringify(p));
    if (/exec$/.test(uri)) { execs.push(p.command); return Promise.resolve({ returnValue: true, stdoutString: p.command === "id -u" ? "0\n" : /test -f/.test(p.command) ? (o.boot ? "yes\n" : "no\n") : "" }); }
    if (/listApps$/.test(uri)) return Promise.resolve({ apps: Object.keys(installed).map(id => ({ id, version: installed[id] })) });
    if (/install$/.test(uri)) { const id = Object.keys(manifests).filter(k => manifests[k].ipkUrl === p.ipkUrl)[0]; if (o.failInstall === id) return Promise.reject(new Error("install failed")); if (o.stuck !== id) installed[id] = manifests[id].version; return Promise.resolve({ finished: true }); }
    return Promise.reject(new Error("unexpected " + uri)); };
  const getText = (u) => u === HB.FEED ? Promise.resolve(JSON.stringify(feed)) : Promise.resolve(JSON.stringify(manifests[/m-(.*)\.json/.exec(u)[1]]));
  const mem = {}; return { u: HB.create({ call, getText, store: { get: k => mem[k] || null, set: (k, v) => { mem[k] = v; } } }), calls, execs, installed };
}
(async () => {
  ok(HB.compareVersions("2.0.10", "2.0.9") === 1 && HB.compareVersions("1.0", "1.0.0") === 0 && HB.compareVersions("1.9", "2.0") === -1, "versions compare numerically");
  let w = world({ a: "1.0.0", self: "1.0.0", [HB.SELF]: "2.0.0" }, { a: man("a", "1.1.0"), b: man("b", "9.0.0"), [HB.SELF]: man(HB.SELF, "2.0.1") });
  let items = await w.u.check(); const st = Object.fromEntries(items.map(i => [i.id, i.state]));
  ok(st.a === "update" && st.b === "not-installed" && st[HB.SELF] === "update", "check: newer installed apps are 'update', apps not on the TV are never offered");
  ok(!items.some(i => i.manifest), "check hides the raw manifests");
  items = await w.u.run({}); ok(w.installed.a === "1.1.0" && !w.installed.b && w.installed[HB.SELF] === "2.0.1", "run: updates the installed apps only");
  ok(items.filter(i => i.state === "updated").length === 2, "run: reports what was updated");
  const lastInstall = w.calls.map((c, i) => /^install/.test(c) ? c : null).filter(Boolean); ok(/a_1\.1\.0/.test(lastInstall[0]) && new RegExp(HB.SELF).test(lastInstall[1]), "the updater updates itself last");
  ok(w.calls.some(c => /install/.test(c) && /"ipkHash":"(ab){32}"/.test(c)), "the sha256 is sent lower-case to Homebrew Channel");
  ok(w.execs.some(e => /sleep 30/.test(e) || /base64/.test(e)), "before updating itself it schedules reopening itself");
  w = world({ a: "1.0.0" }, { a: man("a", "1.1.0") }, { failInstall: "a" }); items = await w.u.run({}); ok(items[0].state === "failed" && /install failed/.test(items[0].error), "a failed install is reported, nothing throws");
  w = world({ a: "1.0.0" }, { a: man("a", "1.1.0") }, { stuck: "a" }); items = await w.u.run({}); ok(items[0].state === "failed" && /still reports/.test(items[0].error), "an install the TV does not confirm counts as failed");
  w = world({ a: "1.0.0" }, { a: man("a", "1.1.0", { ipkHash: undefined }) }); items = await w.u.run({}); ok(items[0].state === "failed", "a manifest without sha256 is refused");
  w = world({ a: "1.0.0", c: "1.0.0" }, { a: man("a", "1.1.0"), c: man("c", "1.1.0") }); w.u.setConfig({ ignore: ["c"] }); items = await w.u.run({}); ok(w.installed.a === "1.1.0" && w.installed.c === "1.0.0", "ignored apps are left alone");
  w = world({ a: "1.0.0", c: "1.0.0" }, { a: man("a", "1.1.0"), c: man("c", "1.1.0") }); await w.u.run({ only: ["c"], relaunch: "c" }); ok(w.installed.c === "1.1.0" && w.installed.a === "1.0.0" && w.execs.some(e => /sleep 2/.test(Buffer.from((/echo (\S+) \|/.exec(e) || [])[1] || "", "base64").toString())), "only: updates just that app, and relaunch reopens it");
  w = world({ a: "2.0.0" }, { a: man("a", "1.0.0") }); items = await w.u.run({}); ok(items[0].state === "current" && w.installed.a === "2.0.0", "never downgrades");
  w = world({}, {}, { boot: true }); ok(await w.u.bootState() === true, "boot state reads the init.d file"); await w.u.setBoot(true, 12); ok(w.execs.some(e => /init\.d/.test(e) && /base64/.test(e)), "auto-update writes the init.d script");
  const script = Buffer.from(/echo (\S+) \|/.exec(w.execs.filter(e => /init\.d/.test(e) && /base64/.test(e))[0])[1], "base64").toString(); ok(script.indexOf("io.joolay.tvupdater") > 0 && /sleep 43200/.test(script) && /auto/.test(script), "the script launches the updater app with auto:true every N hours");
  await w.u.setBoot(false); ok(w.execs.some(e => /rm -f .*init\.d/.test(e)), "auto-update off removes the script");
  ok(fs.readFileSync(path.join(__dirname, "../hb-updater.js"), "utf8") === fs.readFileSync(path.join(__dirname, "../../app-flix/hb-updater.js"), "utf8"), "the launcher carries the same updater code");
  console.log("ALL PASSED (" + n + ")");
})().catch(e => { console.log("FAIL", e.stack); process.exit(1); });
