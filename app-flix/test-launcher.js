// Runs the launcher script against stubs: update flow, no loop, never blocks opening JoolzTV.
"use strict";
const vm = require("vm"), fs = require("fs"), assert = require("assert");
const html = fs.readFileSync(__dirname + "/index.html", "utf8"), js = html.split("<script>")[1].split("</script>")[0];
function run(o) {
  return new Promise(res => {
    const log = { opened: null, svc: [], screens: [] }, store = o.store || {};
    const el = { innerHTML: "", querySelectorAll: () => [], className: "", getBoundingClientRect: () => ({}) };
    function XHR() { this.open = (m, u) => { this.u = u; }; this.send = () => setTimeout(() => {
      if (/appinfo/.test(this.u)) return o.mine ? (this.responseText = JSON.stringify({ version: o.mine }), this.onload()) : this.onerror();
      if (o.latest === "down") return this.onerror();
      this.responseText = JSON.stringify({ launcher: { version: o.latest } }); this.onload(); }, 0); }
    function PSB() { this.call = (u, p) => { log.svc.push(u.split("/").pop() + " " + p); if (o.svc === "none") throw new Error("no service"); setTimeout(() => { this.onservicecallback(JSON.stringify(o.svc)); }, 0); }; }
    const ctx = { document: { getElementById: () => el, addEventListener() {} }, localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; } },
      fetch: () => Promise.resolve({ json: () => ({ ok: true }) }), XMLHttpRequest: XHR, PalmServiceBridge: PSB, Promise, JSON, Date, console,
      location: { replace: u => { log.opened = u; res(log); } }, window: { close() {} }, setTimeout: (f, ms) => setTimeout(f, ms > 1500 ? 200 : 0), clearTimeout };
    ctx.window.addEventListener = () => {};
    const _st = el; Object.defineProperty(el, "innerHTML", { set(v) { log.screens.push(v.replace(/<[^>]+>/g, "")); }, get() { return ""; } });
    vm.runInNewContext(js, ctx);
    setTimeout(() => res(log), 400);   // an update that restarts the app never opens the site
  });
}
(async () => {
  let l = await run({ mine: "2.0.2", latest: "2.1.0", svc: { returnValue: true, updated: true } });
  assert(!l.opened && /updateApp/.test(l.svc[0]) && l.screens.some(s => /Restarting/.test(s)), "newer: asks updater, shows restarting, does not open the old UI"); console.log("ok   newer version is installed");
  l = await run({ mine: "2.0.2", latest: "2.1.0", svc: { returnValue: false, errorText: "x" } });
  assert(l.opened && l.opened.endsWith("/?tv=1"), "failed update still opens JoolzTV"); console.log("ok   failed update still opens the app");
  l = await run({ mine: "2.0.2", latest: "2.1.0", svc: "none" });
  assert(l.opened, "no updater installed: opens"); console.log("ok   no updater installed: opens normally");
  l = await run({ mine: "2.1.0", latest: "2.1.0", svc: {} });
  assert(l.opened && !l.svc.length, "same version: no update call"); console.log("ok   same version: nothing to do");
  l = await run({ mine: "2.1.0", latest: "2.0.2", svc: {} });
  assert(l.opened && !l.svc.length, "server older: no downgrade"); console.log("ok   never downgrades");
  l = await run({ mine: "2.0.2", latest: "down", svc: {} });
  assert(l.opened && !l.svc.length, "server cannot say: opens"); console.log("ok   server can't report: opens");
  l = await run({ mine: "2.0.2", latest: "2.1.0", svc: {}, store: { "jtv.updTry": JSON.stringify({ v: "2.1.0", t: Date.now() }) } });
  assert(l.opened && !l.svc.length, "tried an hour ago: no loop"); console.log("ok   same version not retried within 6 h");
  process.exit(0);
})().catch(e => { console.log("FAIL", e.message); process.exit(1); });
