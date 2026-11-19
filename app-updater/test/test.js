// TV Updater 2.0: runs hb-updater.js against a fake Homebrew Channel + feed (no TV needed).
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path");
const HB = require("../hb-updater.js");
let n = 0; const ok = (c, m) => { assert(c, m); console.log("ok   " + m); n++; };
const man = (id, v, extra) => Object.assign({ id, version: v, title: id, rootRequired: false, ipkUrl: "https://x/" + id + "_" + v + ".ipk", ipkHash: { sha256: "AB".repeat(32) } }, extra || {});
function world(installed, manifests, o) {
  o = o || {}; const calls = [], execs = [];
  const feed = { packages: Object.keys(manifests).filter(id => !o.own || o.own.indexOf(id) >= 0).map(id => ({ id, title: id, manifestUrl: "https://x/m-" + id + ".json" })) };
  const call = (uri, p) => { calls.push(uri.split("/").pop() + " " + JSON.stringify(p));
    if (/exec$/.test(uri)) { execs.push(p.command); return Promise.resolve({ returnValue: true, stdoutString: p.command === "id -u" ? "0\n" : /test -f/.test(p.command) ? (o.boot ? "yes\n" : "no\n") : "" }); }
    if (/listApps$/.test(uri)) return Promise.resolve({ apps: Object.keys(installed).map(id => ({ id, version: installed[id] })) });
    if (/install$/.test(uri) && /\/(\w+)_(\d[\d.]*)\.ipk$/.test(p.ipkUrl) && !Object.keys(manifests).some(k => manifests[k].ipkUrl === p.ipkUrl)) { const m = /\/(\w+)_(\d[\d.]*)\.ipk$/.exec(p.ipkUrl); installed[m[1]] = m[2]; return Promise.resolve({ finished: true }); }   // an archived version
    if (/install$/.test(uri)) { const id = Object.keys(manifests).filter(k => manifests[k].ipkUrl === p.ipkUrl)[0]; if (o.failInstall === id) return Promise.reject(new Error("install failed")); if (o.stuck !== id) installed[id] = manifests[id].version; return Promise.resolve({ finished: true }); }
    return Promise.reject(new Error("unexpected " + uri)); };
  const other = o.other || { packages: [] };   // the second repo's feed (an app listed there is shown only when installed)
  const archive = o.archive || { versions: {} };
  const getText = (u) => u === HB.ARCHIVE ? Promise.resolve(JSON.stringify(archive)) : u === HB.FEED ? Promise.resolve(JSON.stringify(feed)) : u === HB.REPOS[1].url ? (o.otherFails ? Promise.reject(new Error("offline")) : Promise.resolve(JSON.stringify(other))) : Promise.resolve(JSON.stringify(manifests[/m-(.*)\.json/.exec(u)[1]]));
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
  // repos: apps are labelled with the repo they come from, other repos only show installed apps, and one bad repo does not stop the rest
  const pkg = id => ({ id, title: id, manifestUrl: "https://x/m-" + id + ".json" });
  w = world({ a: "1.0.0", z: "1.0.0" }, { a: man("a", "1.1.0"), b: man("b", "9.0.0"), z: man("z", "2.0.0"), y: man("y", "5.0.0") }, { own: ["a", "b"], other: { packages: [pkg("z"), pkg("y"), pkg("a")] } });
  items = await w.u.check(); const by = Object.fromEntries(items.map(i => [i.id, i]));
  ok(by.a.repo === "JoolzTV" && by.b.repo === "JoolzTV" && by.z.repo === "webOS Homebrew", "each app is labelled with the repo it comes from");
  ok(by.z.state === "update" && !by.y, "an update from another repo is shown; an app that is not on the TV is not listed from other repos");
  ok(items.filter(i => i.id === "a").length === 1, "an app listed in two repos belongs to the first one");
  items = await w.u.run({}); ok(w.installed.z === "2.0.0" && w.installed.a === "1.1.0" && !w.installed.y, "run: updates from every repo, installed apps only");
  w = world({ a: "1.0.0" }, { a: man("a", "1.1.0") }, { otherFails: true }); items = await w.u.check();
  ok(items.some(i => i.id === "a" && i.state === "update") && items.some(i => i.state === "error" && i.repo === "webOS Homebrew" && /offline/.test(i.error)), "a repo that cannot be read shows one error row and the others still work");
  w = world({ a: "1.0.0" }, { a: man("a", "1.1.0") }); w.u.setConfig({ repos: [{ id: "x", name: "Mine", url: HB.FEED, all: true }] }); items = await w.u.check();
  ok(items.length === 1 && items[0].repo === "Mine", "the list of repos can be changed");
  // history and roll-back
  const av = (id, v) => ({ version: v, date: "2026-11-1" + v.slice(-1), ipkUrl: "https://x/" + id + "_" + v + ".ipk", ipkHash: { sha256: "CD".repeat(32) } });
  w = world({ a: "1.0.0" }, { a: man("a", "1.1.0") }); await w.u.run({}); let hist = w.u.history();
  ok(hist.length === 1 && hist[0].id === "a" && hist[0].from === "1.0.0" && hist[0].to === "1.1.0" && hist[0].ok && hist[0].kind === "update" && hist[0].repo === "JoolzTV", "an update is saved in the history");
  w = world({ a: "1.0.0" }, { a: man("a", "1.1.0") }, { failInstall: "a" }); await w.u.run({}); hist = w.u.history();
  ok(hist.length === 1 && hist[0].ok === false && /install failed/.test(hist[0].error), "a failed update is saved too");
  ok(w.execs.some(e => /joolay-updater-history/.test(e) && /base64/.test(e)), "the history is also copied to a file");
  w = world({ a: "1.1.0" }, { a: man("a", "1.1.0") }, { archive: { versions: { a: [av("a", "1.0.0"), av("a", "1.1.0")] } } });
  let vs = await w.u.versions("a"); ok(vs.length === 2 && vs[0].version === "1.1.0" && vs[1].version === "1.0.0", "versions come from the archive, newest first");
  const res = await w.u.installVersion("a", "1.0.0"); ok(w.installed.a === "1.0.0" && res.rolledBack, "roll back installs the older archived version");
  ok(w.calls.some(c => /install/.test(c) && /a_1\.0\.0\.ipk/.test(c) && /"ipkHash":"(cd){32}"/.test(c)), "the archived IPK is checked with its own sha256");
  w.installed.a = "1.0.0"; items = await w.u.check(); ok(items[0].state === "held", "after a roll back the app is held, not offered the same update again");
  items = await w.u.run({}); ok(w.installed.a === "1.0.0", "automatic update leaves a held app alone");
  hist = w.u.history(); ok(hist[hist.length - 1].kind === "rollback" && hist[hist.length - 1].from === "1.1.0" && hist[hist.length - 1].to === "1.0.0", "the roll back is in the history");
  w.u.setConfig({}); w.installed.a = "1.0.0"; const w2 = world({ a: "1.0.0" }, { a: man("a", "1.2.0") }, { archive: { versions: { a: [av("a", "1.0.0")] } } });
  w2.u.setConfig({ hold: { a: "1.1.0" } }); items = await w2.u.check(); ok(items[0].state === "update", "a release newer than the one that was undone is offered again");
  await w.u.installVersion("a", "1.1.0"); items = await w.u.check(); ok(w.installed.a === "1.1.0" && items[0].state === "current", "installing a newer archived version lifts the hold");
  let bad = null; try { await w.u.installVersion("a", "9.9.9"); } catch (e) { bad = e; } ok(bad && /not in the archive/.test(bad.message), "an unknown version is refused");
  // app browser
  w = world({ a: "1.0.0" }, { a: man("a", "1.1.0"), b: man("b", "9.0.0") }, { own: ["a", "b"], other: { packages: [Object.assign(pkg("z"), { shortDescription: "Zed" })] } });
  let cat = await w.u.catalog(); ok(cat.length === 2 && cat[0].name === "JoolzTV" && cat[0].apps.map(x => x.id).join() === "a,b" && cat[1].apps[0].desc === "Zed", "the browser lists every app of every repo, by repo");
  ok(cat[0].apps[0].installed === "1.0.0" && cat[0].apps[1].installed === null, "each app knows what is installed");
  let ai = await w.u.appInfo(cat[0].apps[1]); ok(ai.version === "9.0.0", "an app's details come from its manifest");
  const r1 = await w.u.installApp(cat[0].apps[1]); ok(w.installed.b === "9.0.0" && r1.from === null, "an app that is not on the TV can be installed from the browser");
  ok(w.u.history().pop().kind === "install", "and is saved in the history as an install");
  bad = null; try { await w.u.installApp(cat[0].apps[1]); } catch (e) { bad = e; } ok(bad && /up to date/.test(bad.message), "installing what is already current is refused");
  ok(fs.readFileSync(path.join(__dirname, "../hb-updater.js"), "utf8") === fs.readFileSync(path.join(__dirname, "../../app-flix/hb-updater.js"), "utf8"), "the launcher carries the same updater code");
  console.log("ALL PASSED (" + n + ")");
})().catch(e => { console.log("FAIL", e.stack); process.exit(1); });
