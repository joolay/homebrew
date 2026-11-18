/* hb-updater.js: updates apps on a rooted LG webOS TV through Homebrew Channel's own service (luna://org.webosbrew.hbchannel.service/),
   so no service of our own has to be installed or registered. Written in ES5 for the TV's old Chromium 53.
   The same file lives in app-updater/ and app-flix/ (scripts/test-updater.js checks that they match).

   What it uses:
     org.webosbrew.hbchannel.service/install  { ipkUrl, ipkHash }   downloads, checks the sha256 and installs (answers finished:true)
     org.webosbrew.hbchannel.service/exec     { command }           runs a shell command as root (used for listApps fallback, curl fallback, the boot script)
     com.webos.applicationManager/listApps                          which apps and versions are installed
   Everything runs from the app's own page. Not verified on a real TV yet: the first run on the TV is the test. */
(function (root) {
  "use strict";
  var FEED = "https://raw.githubusercontent.com/joolay/homebrew/main/webosbrew/apps.json";
  var HBC = "luna://org.webosbrew.hbchannel.service/";
  var AM = "luna://com.webos.applicationManager/";
  var SELF = "io.joolay.tvupdater";
  var BOOT_FILE = "/var/lib/webosbrew/init.d/90-joolay-updater";

  // "2.0.10" > "2.0.9". Non-numeric parts count as 0. Returns -1, 0, 1.
  function compareVersions(a, b) {
    var pa = String(a || "0").split(/[.\-+]/), pb = String(b || "0").split(/[.\-+]/), n = Math.max(pa.length, pb.length);
    for (var i = 0; i < n; i++) {
      var x = parseInt(pa[i], 10) || 0, y = parseInt(pb[i], 10) || 0;
      if (x > y) return 1;
      if (x < y) return -1;
    }
    return 0;
  }

  // One luna call through the TV's service bridge. o: { timeout, until(msg) -> bool (keep listening until true), onProgress(msg) }
  function bridgeCall(uri, params, o) {
    o = o || {};
    return new Promise(function (resolve, reject) {
      var done = false, b = null, t = null;
      function end(fn, v) { if (done) return; done = true; clearTimeout(t); try { if (b && b.cancel) b.cancel(); } catch (e) {} fn(v); }
      try {
        b = new PalmServiceBridge();
        t = setTimeout(function () { end(reject, new Error("No answer from " + uri)); }, o.timeout || 30000);
        b.onservicecallback = function (m) {
          var j; try { j = JSON.parse(m); } catch (e) { return end(reject, new Error("Bad answer from " + uri)); }
          if (j.returnValue === false) return end(reject, new Error(j.errorText || ("error " + j.errorCode + " from " + uri)));
          if (!o.until || o.until(j)) end(resolve, j); else if (o.onProgress) o.onProgress(j);
        };
        b.call(uri, JSON.stringify(params || {}));
      } catch (e) { end(reject, new Error("This only works on the TV (no webOS service bridge here)")); }
    });
  }

  function xhrText(url) {
    return new Promise(function (res, rej) {
      var x = new XMLHttpRequest();
      x.open("GET", url); x.timeout = 20000;
      x.onload = function () { if (x.status >= 200 && x.status < 300) res(x.responseText); else rej(new Error("HTTP " + x.status + " for " + url)); };
      x.onerror = x.ontimeout = function () { rej(new Error("Could not load " + url)); };
      x.send();
    });
  }
  function absolute(base, rel) {
    if (/^https?:\/\//i.test(rel)) return rel;
    try { return new URL(rel, base).href; } catch (e) { return rel; }
  }
  function b64(s) { return typeof btoa === "function" ? btoa(s) : Buffer.from(s, "utf8").toString("base64"); }

  // env (all optional, for tests): { call, getText, store: { get(k), set(k, v) } }
  function create(env) {
    env = env || {};
    var call = env.call || bridgeCall;
    var memory = {};
    var store = env.store || {
      get: function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return memory[k] === undefined ? null : memory[k]; } },
      set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { memory[k] = v; } }
    };
    var logs = [];
    function log(m) { logs.push(new Date().toISOString().slice(11, 19) + " " + m); if (logs.length > 60) logs.shift(); if (env.onLog) env.onLog(m); }

    function exec(command, timeout) {
      return call(HBC + "exec", { command: command }, { timeout: timeout || 30000 }).then(function (j) {
        return String(j.stdoutString != null ? j.stdoutString : (j.stdout != null ? j.stdout : ""));
      });
    }
    function runScript(script, timeout) { return exec("echo " + b64(script) + " | base64 -d | sh", timeout); }

    var getText = env.getText || function (url) {
      return xhrText(url).catch(function (e) {             // an old TV may not trust the site's certificate: let curl (root, via Homebrew Channel) try
        if (!/^https:\/\/[A-Za-z0-9._~:\/?#@!$&+,;=%-]+$/.test(url)) throw e;
        return exec("curl -fsSL --max-time 30 '" + url + "'", 40000).then(function (s) { if (!s) throw e; return s; });
      });
    };
    function getJson(url) { return getText(url).then(function (t) { return JSON.parse(t); }); }

    function config() {
      var c = store.get("jtv.updcfg") || {};
      return { feedUrl: typeof c.feedUrl === "string" && /^https:\/\//.test(c.feedUrl) ? c.feedUrl : FEED, ignore: Array.isArray(c.ignore) ? c.ignore : [] };
    }
    function setConfig(patch) {
      var c = config(); for (var k in patch) c[k] = patch[k];
      store.set("jtv.updcfg", c); return c;
    }

    function parseApps(j) { var o = {}; (j.apps || []).forEach(function (a) { if (a && a.id) o[a.id] = a.version; }); return o; }
    function listInstalled() {
      return call(AM + "listApps", {}).then(parseApps).catch(function () {
        return exec("luna-send -n 1 -f " + AM + "listApps '{}'").then(function (s) { return parseApps(JSON.parse(s.trim().split("\n").pop())); });
      });
    }
    // Is Homebrew Channel's service there, and are we root through it?
    function hbcState() {
      return exec("id -u").then(function (s) { return { ok: true, root: String(s).trim() === "0" }; }, function (e) { return { ok: false, root: false, error: e.message }; });
    }

    // The feed lists apps; each has a manifest with its version and IPK. Only apps already installed are ever touched.
    function plan(o) {
      o = o || {};
      var cfg = config();
      return getJson(cfg.feedUrl).then(function (feed) {
        var pk = (feed.packages || []).filter(function (p) { return p && p.id && p.manifestUrl && (!o.only || o.only.indexOf(p.id) >= 0); });
        return Promise.all(pk.map(function (p) {
          return getJson(p.manifestUrl).then(function (m) { return { id: p.id, title: p.title || m.title || p.id, manifest: m, manifestUrl: p.manifestUrl }; })
            .catch(function (e) { return { id: p.id, title: p.title || p.id, error: e.message }; });
        }));
      }).then(function (list) {
        return list.map(function (it) {
          var have = o.installed[it.id] || null;
          var out = { id: it.id, title: it.title, installed: have, available: it.manifest ? it.manifest.version : null, state: "" };
          if (it.error) { out.state = "error"; out.error = it.error; return out; }
          if (!have) out.state = "not-installed";
          else if (cfg.ignore.indexOf(it.id) >= 0) out.state = "ignored";
          else if (it.manifest.rootRequired && !o.root) out.state = "needs-root";
          else if (compareVersions(it.manifest.version, have) > 0) out.state = "update";
          else out.state = "current";
          out.manifest = it.manifest; out.manifestUrl = it.manifestUrl;
          return out;
        });
      });
    }
    function strip(items) { return items.map(function (i) { var o = {}; for (var k in i) if (k !== "manifest" && k !== "manifestUrl") o[k] = i[k]; return o; }); }

    // Check only: what is installed, what is available.
    function check(o) {
      return hbcState().then(function (h) {
        if (!h.ok) throw new Error("Homebrew Channel's service did not answer (" + h.error + "). Is Homebrew Channel installed and the TV rooted?");
        return listInstalled().then(function (inst) { return plan({ installed: inst, root: h.root, only: o && o.only }); });
      }).then(strip);
    }

    function launchLater(id, seconds) {
      return runScript("( sleep " + seconds + "; luna-send-pub -n 1 -f luna://com.webos.service.applicationManager/launch '{\"id\":\"" + id + "\"}' >/dev/null 2>&1 ) &\n").catch(function (e) { log("Could not schedule reopening " + id + ": " + e.message); });
    }

    function installOne(it) {
      var m = it.manifest;
      if (!m.ipkUrl || !m.ipkHash || !m.ipkHash.sha256) return Promise.reject(new Error("Manifest has no ipkUrl or sha256"));
      return call(HBC + "install", { ipkUrl: absolute(it.manifestUrl || "", m.ipkUrl), ipkHash: String(m.ipkHash.sha256).toLowerCase(), subscribe: true },
        { timeout: 300000, until: function (j) { return j.finished === true; }, onProgress: function (j) { if (env.onProgress) env.onProgress(it, j); } });
    }

    // Update what is out of date. This app goes last (installing it closes it, so it is reopened by a timer first).
    // o: { only: [ids], relaunch: id (open this app again after it was updated) }
    function run(o) {
      o = o || {};
      return hbcState().then(function (h) {
        if (!h.ok) throw new Error("Homebrew Channel's service did not answer (" + h.error + "). Is Homebrew Channel installed and the TV rooted?");
        return listInstalled().then(function (inst) { return plan({ installed: inst, root: h.root, only: o.only }); });
      }).then(function (items) {
        var todo = items.filter(function (i) { return i.state === "update"; });
        todo.sort(function (a, b) { return (a.id === SELF) - (b.id === SELF); });
        var chain = Promise.resolve();
        todo.forEach(function (it) {
          chain = chain.then(function () {
            log("Updating " + it.title + " " + it.installed + " -> " + it.available);
            var pre = it.id === SELF ? launchLater(SELF, 30) : Promise.resolve();
            return pre.then(function () { return installOne(it); }).then(function () { return listInstalled(); }).then(function (now) {
              if (compareVersions(now[it.id], it.available) < 0) throw new Error("Installer finished but the TV still reports " + (now[it.id] || "nothing"));
              it.state = "updated"; it.installed = now[it.id]; log("Updated " + it.title + " to " + it.installed);
              if (o.relaunch === it.id) return launchLater(it.id, 2);
            }).catch(function (e) { it.state = "failed"; it.error = e.message; log("Failed " + it.title + ": " + e.message); });
          });
        });
        return chain.then(function () { return strip(items); });
      });
    }

    function bootScript(hours) {
      return "#!/bin/sh\n# JoolzTV updater: written by the TV Updater app, removed by its switch\n" +
        "( sleep 120; while true; do\n" +
        "  luna-send-pub -n 1 -f luna://com.webos.service.applicationManager/launch '{\"id\":\"" + SELF + "\",\"params\":{\"auto\":true}}' >/dev/null 2>&1\n" +
        "  sleep " + (hours * 3600) + "\n" +
        "done ) &\n";
    }
    function setBoot(on, hours) {
      return on ? exec("mkdir -p /var/lib/webosbrew/init.d && echo " + b64(bootScript(hours || 24)) + " | base64 -d > " + BOOT_FILE + " && chmod 755 " + BOOT_FILE + " && echo done")
                : exec("rm -f " + BOOT_FILE + " && echo done");
    }
    function bootState() { return exec("test -f " + BOOT_FILE + " && echo yes || echo no").then(function (s) { return String(s).trim() === "yes"; }, function () { return false; }); }

    return { check: check, run: run, config: config, setConfig: setConfig, setBoot: setBoot, bootState: bootState, hbcState: hbcState, log: log, logs: function () { return logs.slice(); }, exec: exec };
  }

  var api = { create: create, compareVersions: compareVersions, FEED: FEED, SELF: SELF, HBC: HBC };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.HBUpdater = api;
})(typeof window !== "undefined" ? window : this);
