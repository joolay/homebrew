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
  // Repos the TV Updater reads, in this order (an app listed in two repos belongs to the first). `all` repos also list apps that are not on the TV;
  // the others only show apps that are installed, so a big public repo does not flood the screen. Change them with setConfig({ repos: [...] }).
  // The webOS Homebrew address is not verified yet: if it is wrong that repo shows "Could not read this repo" and everything else still works.
  var ARCHIVE = "https://raw.githubusercontent.com/joolay/homebrew/main/webosbrew/archive.json";   // every released IPK of the JoolzTV repo, for roll-back
  var HIST_FILE = "/var/lib/webosbrew/joolay-updater-history.json";                               // a copy of the update history that survives reinstalling this app
  var REPOS = [
    { id: "joolay", name: "JoolzTV", url: FEED, all: true, archive: ARCHIVE },
    { id: "webosbrew", name: "webOS Homebrew", url: "https://repo.webosbrew.org/api/apps.json" }
  ];
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
    function parseJson(text, what) {                          // a clear message (what + the start of the text) instead of "Unexpected token in JSON"
      var t = String(text == null ? "" : text), i = t.search(/[\[{]/);
      try { if (i < 0) throw new Error("no JSON"); return JSON.parse(t.slice(i)); }
      catch (e) { throw new Error(what + " did not return JSON (" + (t.replace(/\s+/g, " ").slice(0, 50) || "empty") + ")"); }
    }
    function getJson(url) { return getText(url).then(function (t) { return parseJson(t, url.replace(/^https:\/\/[^\/]+\//, "")); }); }

    function config() {
      var c = store.get("jtv.updcfg") || {};
      var repos = (Array.isArray(c.repos) ? c.repos : REPOS).filter(function (r) { return r && typeof r.url === "string" && /^https:\/\//.test(r.url); })
        .map(function (r, i) { return { id: String(r.id || "r" + i), name: String(r.name || r.url.replace(/^https:\/\/([^\/]+).*$/, "$1")), url: r.url, all: !!r.all, archive: typeof r.archive === "string" && /^https:\/\//.test(r.archive) ? r.archive : null }; });
      if (!Array.isArray(c.repos) && typeof c.feedUrl === "string" && /^https:\/\//.test(c.feedUrl)) repos[0].url = c.feedUrl;   // older setting: the first repo's address
      return { repos: repos, ignore: Array.isArray(c.ignore) ? c.ignore : [], hold: c.hold && typeof c.hold === "object" ? c.hold : {} };
    }
    function setConfig(patch) {                                  // changes only what is passed, so the default repos keep following new releases
      var c = store.get("jtv.updcfg") || {}; for (var k in patch) c[k] = patch[k];
      store.set("jtv.updcfg", c); return config();
    }

    function parseApps(j) { var o = {}; (j.apps || []).forEach(function (a) { if (a && a.id) o[a.id] = a.version; }); return o; }
    function listInstalled() {
      return call(AM + "listApps", {}).then(parseApps).catch(function () {
        return exec("luna-send -n 1 " + AM + "listApps '{}'").then(function (s) { return parseApps(parseJson(s, "the TV's app list")); });
      });
    }
    // Is Homebrew Channel's service there, and are we root through it?
    function hbcState() {
      return exec("id -u").then(function (s) { return { ok: true, root: String(s).trim() === "0" }; }, function (e) { return { ok: false, root: false, error: e.message }; });
    }

    // Each repo's feed lists apps; each has a manifest with its version and IPK. Only apps already installed are ever touched.
    // A repo that cannot be read becomes one "error" row of its own and the other repos carry on.
    function plan(o) {
      o = o || {};
      var cfg = config();
      return Promise.all(cfg.repos.map(function (r) {
        return getJson(r.url).then(function (feed) {
          var pk = (feed.packages || []).filter(function (p) { return p && p.id && p.manifestUrl && (!o.only || o.only.indexOf(p.id) >= 0) && (r.all || o.installed[p.id]); });
          return Promise.all(pk.map(function (p) {
            return getJson(p.manifestUrl).then(function (m) { return { repo: r.name, id: p.id, title: p.title || m.title || p.id, manifest: m, manifestUrl: p.manifestUrl }; })
              .catch(function (e) { return { repo: r.name, id: p.id, title: p.title || p.id, error: e.message }; });
          }));
        }, function (e) { return [{ repo: r.name, id: "repo:" + r.id, title: "Could not read this repo", error: e.message, repoError: true }]; });
      })).then(function (lists) {
        var seen = {}, list = [];
        lists.forEach(function (l) { l.forEach(function (it) { if (it.repoError || !seen[it.id]) { seen[it.id] = true; list.push(it); } }); });   // an app in two repos belongs to the first
        return list.map(function (it) {
          var have = it.repoError ? null : (o.installed[it.id] || null);
          var out = { id: it.id, title: it.title, repo: it.repo, installed: have, available: it.manifest ? it.manifest.version : null, state: "" };
          if (it.error) { out.state = "error"; out.error = it.error; return out; }
          if (!have) out.state = "not-installed";
          else if (cfg.ignore.indexOf(it.id) >= 0) out.state = "ignored";
          else if (it.manifest.rootRequired && !o.root) out.state = "needs-root";
          else if (compareVersions(it.manifest.version, have) > 0) out.state = cfg.hold[it.id] && compareVersions(it.manifest.version, cfg.hold[it.id]) <= 0 ? "held" : "update";   // rolled back: no update until something newer than what was undone appears
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
              it.state = "updated"; log("Updated " + it.title + " to " + now[it.id]);
              var h1 = addHistory({ id: it.id, title: it.title, repo: it.repo, from: it.installed, to: now[it.id], ok: true, kind: "update" });
              it.installed = now[it.id];
              if (o.relaunch === it.id) return h1.then(function () { return launchLater(it.id, 2); });
              return h1;
            }).catch(function (e) { it.state = "failed"; it.error = e.message; log("Failed " + it.title + ": " + e.message); return addHistory({ id: it.id, title: it.title, repo: it.repo, from: it.installed, to: it.available, ok: false, error: e.message, kind: "update" }); });
          });
        });
        return chain.then(function () { return strip(items); });
      });
    }

    function clearHold(id) { var c = store.get("jtv.updcfg") || {}; if (c.hold && c.hold[id]) { delete c.hold[id]; store.set("jtv.updcfg", c); } }

    // ---- update history (newest last, at most 60), kept in the app's storage and copied to a file the app's reinstall does not touch
    function history() { var h = store.get("jtv.updhist"); return Array.isArray(h) ? h : []; }
    function saveHistory(h) {
      store.set("jtv.updhist", h);
      return exec("mkdir -p /var/lib/webosbrew && echo " + b64(JSON.stringify(h)) + " | base64 -d > " + HIST_FILE, 20000).catch(function () {});
    }
    function addHistory(e) { var h = history(); e.t = Date.now(); h.push(e); while (h.length > 60) h.shift(); return saveHistory(h); }
    function restoreHistory() {            // after a reinstall the app's own storage may be empty: read the file copy
      if (history().length) return Promise.resolve(history());
      return exec("cat " + HIST_FILE + " 2>/dev/null").then(function (t) { var h; try { h = JSON.parse(t); } catch (e) { h = null; } if (Array.isArray(h)) store.set("jtv.updhist", h); return history(); }, function () { return history(); });
    }

    // ---- roll-back: older IPKs come from a repo's archive (webosbrew/archive.json: { versions: { id: [ { version, ipkUrl, ipkHash: { sha256 }, ipkSize, date } ] } })
    function versions(id) {
      var repos = config().repos.filter(function (r) { return r.archive; });
      return Promise.all(repos.map(function (r) {
        return getJson(r.archive).then(function (a) {
          return ((a.versions && a.versions[id]) || []).map(function (v) { return { version: v.version, date: v.date || null, ipkUrl: absolute(r.archive, v.ipkUrl || ""), ipkHash: v.ipkHash, repo: r.name }; });
        }, function () { return []; });
      })).then(function (lists) {
        var seen = {}, out = [];
        lists.forEach(function (l) { l.forEach(function (v) { if (!seen[v.version]) { seen[v.version] = true; out.push(v); } }); });
        out.sort(function (a, b) { return compareVersions(b.version, a.version); });
        return out;
      });
    }
    // Install one archived version (older = roll back, newer = install). Holds automatic updates at the version that was undone.
    function installVersion(id, version) {
      var title = id, from = null, entry = null;
      return hbcState().then(function (h) {
        if (!h.ok) throw new Error("Homebrew Channel's service did not answer (" + h.error + ")");
        return listInstalled();
      }).then(function (inst) {
        from = inst[id] || null;
        if (!from) throw new Error("That app is not installed");
        return versions(id);
      }).then(function (list) {
        for (var i = 0; i < list.length; i++) if (list[i].version === version) entry = list[i];
        if (!entry) throw new Error("Version " + version + " is not in the archive");
        if (!entry.ipkHash || !entry.ipkHash.sha256) throw new Error("The archive has no sha256 for " + version);
        var down = compareVersions(version, from) < 0;
        log((down ? "Rolling back " : "Installing ") + id + " " + from + " -> " + version);
        var pre = id === SELF ? launchLater(SELF, 30) : Promise.resolve();
        return pre.then(function () { return installOne({ title: id, manifestUrl: "", manifest: { ipkUrl: entry.ipkUrl, ipkHash: entry.ipkHash } }); })
          .then(function () { return listInstalled(); })
          .then(function (now) {
            if (compareVersions(now[id], version) !== 0) throw new Error("Installer finished but the TV still reports " + (now[id] || "nothing"));
            var c = store.get("jtv.updcfg") || {}, hold = c.hold && typeof c.hold === "object" ? c.hold : {};
            if (down) hold[id] = from; else delete hold[id];
            setConfig({ hold: hold });
            log("Now on " + id + " " + version);
            return addHistory({ id: id, title: id, repo: entry.repo, from: from, to: version, ok: true, kind: down ? "rollback" : "update" }).then(function () { return { id: id, from: from, to: version, rolledBack: down }; });
          });
      }).catch(function (e) {
        return addHistory({ id: id, title: id, from: from, to: version, ok: false, error: e.message, kind: "rollback" }).then(function () { throw e; });
      });
    }

    // ---- app browser: every app each repo lists (not only the installed ones), and installing or updating one app you pick
    function catalog() {
      var cfg = config();
      return Promise.all([listInstalled().catch(function () { return {}; }), Promise.all(cfg.repos.map(function (r) {
        return getJson(r.url).then(function (feed) { return { repo: r, packages: feed.packages || [] }; }, function (e) { return { repo: r, error: e.message }; });
      }))]).then(function (res) {
        var inst = res[0], seen = {};
        return res[1].map(function (x) {
          if (x.error) return { id: x.repo.id, name: x.repo.name, error: x.error, apps: [] };
          var apps = x.packages.filter(function (p) { return p && p.id && p.manifestUrl && !seen[p.id] && (seen[p.id] = true); }).map(function (p) {
            return { id: p.id, title: p.title || p.id, desc: p.shortDescription || "", long: p.description || "", manifestUrl: absolute(x.repo.url, p.manifestUrl), installed: inst[p.id] || null, repo: x.repo.name };
          });
          apps.sort(function (a, b) { return a.title.toLowerCase() < b.title.toLowerCase() ? -1 : a.title.toLowerCase() > b.title.toLowerCase() ? 1 : 0; });
          return { id: x.repo.id, name: x.repo.name, apps: apps };
        });
      });
    }
    function appInfo(app) {
      return getJson(app.manifestUrl).then(function (m) { return { version: m.version || null, rootRequired: !!m.rootRequired, size: m.ipkSize || null, title: m.title || app.title }; });
    }
    // Install (not on the TV yet) or update (older) one app from a repo. Same checks as an automatic update: sha256 from the manifest, root, verified afterwards.
    function installApp(app) {
      var from = null, m = null;
      return hbcState().then(function (h) {
        if (!h.ok) throw new Error("Homebrew Channel's service did not answer (" + h.error + ")");
        return Promise.all([listInstalled(), getJson(app.manifestUrl)]).then(function (r) {
          m = r[1]; from = r[0][app.id] || null;
          if (m.rootRequired && !h.root) throw new Error("This app needs a rooted TV");
          if (from && compareVersions(m.version, from) <= 0) throw new Error("Already up to date");
          if (!m.ipkUrl || !m.ipkHash || !m.ipkHash.sha256) throw new Error("Manifest has no ipkUrl or sha256");
          log((from ? "Updating " : "Installing ") + app.title + (from ? " " + from + " -> " : " ") + m.version);
          var pre = app.id === SELF ? launchLater(SELF, 30) : Promise.resolve();
          return pre.then(function () { return installOne({ title: app.title, manifestUrl: app.manifestUrl, manifest: m }); });
        });
      }).then(function () { return listInstalled(); }).then(function (now) {
        if (compareVersions(now[app.id], m.version) < 0) throw new Error("Installer finished but the TV still reports " + (now[app.id] || "nothing"));
        return addHistory({ id: app.id, title: app.title, repo: app.repo, from: from, to: now[app.id], ok: true, kind: from ? "update" : "install" }).then(function () { return { id: app.id, from: from, to: now[app.id] }; });
      }).catch(function (e) {
        return addHistory({ id: app.id, title: app.title, repo: app.repo, from: from, to: m && m.version || null, ok: false, error: e.message, kind: from ? "update" : "install" }).then(function () { throw e; });
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

    return { check: check, run: run, catalog: catalog, appInfo: appInfo, installApp: installApp, clearHold: clearHold, history: history, restoreHistory: restoreHistory, versions: versions, installVersion: installVersion, config: config, setConfig: setConfig, setBoot: setBoot, bootState: bootState, hbcState: hbcState, log: log, logs: function () { return logs.slice(); }, exec: exec };
  }

  var api = { create: create, compareVersions: compareVersions, FEED: FEED, ARCHIVE: ARCHIVE, REPOS: REPOS, SELF: SELF, HBC: HBC };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.HBUpdater = api;
})(typeof window !== "undefined" ? window : this);
