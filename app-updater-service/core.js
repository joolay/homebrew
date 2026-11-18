"use strict";
// Core logic of the JoolzTV updater. No webOS APIs in here, so it runs (and is tested) anywhere.
// Written for the old Node on webOS 4 (Node 8): no optional chaining, no async iterators, no dependencies.
var https = require("https");
var http = require("http");
var crypto = require("crypto");
var fs = require("fs");
var urlmod = require("url");

var MAX_IPK = 60 * 1024 * 1024;
var DEFAULT_FEED = "https://raw.githubusercontent.com/joolay/homebrew/main/webosbrew/apps.json";

// "2.0.10" > "2.0.9". Non-numeric parts count as 0. Returns -1, 0, 1.
function compareVersions(a, b) {
  var pa = String(a || "0").split(/[.\-+]/), pb = String(b || "0").split(/[.\-+]/);
  var n = Math.max(pa.length, pb.length);
  for (var i = 0; i < n; i++) {
    var x = parseInt(pa[i], 10) || 0, y = parseInt(pb[i], 10) || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function request(url, opts, hops) {
  opts = opts || {};
  hops = hops || 0;
  return new Promise(function (resolve, reject) {
    var u = urlmod.parse(url);
    if (u.protocol !== "https:" && !opts.allowHttp) return reject(new Error("Only https addresses are allowed: " + url));
    var lib = u.protocol === "http:" ? http : https;
    var req = lib.get({ hostname: u.hostname, port: u.port, path: u.path, headers: { "User-Agent": "joolay-tv-updater" } }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (hops >= 5) return reject(new Error("Too many redirects"));
        return resolve(request(urlmod.resolve(url, res.headers.location), opts, hops + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error("HTTP " + res.statusCode + " for " + url)); }
      var chunks = [], size = 0, max = opts.max || 2 * 1024 * 1024;
      res.on("data", function (c) {
        size += c.length;
        if (size > max) { req.abort(); return reject(new Error("Download too large: " + url)); }
        chunks.push(c);
      });
      res.on("end", function () { resolve(Buffer.concat(chunks)); });
      res.on("error", reject);
    });
    req.setTimeout(30000, function () { req.abort(); reject(new Error("Timed out: " + url)); });
    req.on("error", reject);
  });
}

function getJson(url, opts) {
  return request(url, opts).then(function (b) { return JSON.parse(b.toString("utf8")); });
}

// Which apps does the feed offer, and which of them have a newer version than the one installed?
// deps: { feedUrl, installed: {id: version}, allowHttp, ignore: [ids], only: [ids] (look at just these apps) }
function plan(deps) {
  var o = { allowHttp: deps.allowHttp };
  return getJson(deps.feedUrl, o).then(function (feed) {
    var pk = (feed.packages || []).filter(function (p) { return p && p.id && p.manifestUrl && (!deps.only || deps.only.indexOf(p.id) >= 0); });
    return Promise.all(pk.map(function (p) {
      return getJson(p.manifestUrl, o).then(function (m) {
        return { id: p.id, title: p.title || m.title || p.id, manifest: m, manifestUrl: p.manifestUrl };
      }).catch(function (e) { return { id: p.id, title: p.title || p.id, error: e.message }; });
    }));
  }).then(function (list) {
    var ignore = deps.ignore || [];
    return list.map(function (it) {
      var have = deps.installed[it.id] || null;
      var out = { id: it.id, title: it.title, installed: have, available: it.manifest ? it.manifest.version : null, state: "" };
      if (it.error) { out.state = "error"; out.error = it.error; return out; }
      if (!have) out.state = "not-installed"; // we only update apps that are already on this TV
      else if (ignore.indexOf(it.id) >= 0) out.state = "ignored";
      else if (it.manifest.rootRequired && !deps.isRoot) out.state = "needs-root";
      else if (compareVersions(it.manifest.version, have) > 0) out.state = "update";
      else out.state = "current";
      out.manifest = it.manifest; out.manifestUrl = it.manifestUrl;
      return out;
    });
  });
}

// Download, check sha256 + size, hand to the installer. Never installs a file that fails the check.
// deps: { tmpDir, installIpk(path, id) -> Promise, allowHttp }
function applyOne(item, deps) {
  var m = item.manifest;
  if (!m.ipkUrl || !m.ipkHash || !m.ipkHash.sha256) return Promise.reject(new Error("Manifest has no ipkUrl or sha256"));
  var url = urlmod.resolve(item.manifestUrl || "", m.ipkUrl);
  var max = Math.min(MAX_IPK, (m.ipkSize || 0) > 0 ? m.ipkSize * 2 : MAX_IPK);
  return request(url, { allowHttp: deps.allowHttp, max: max }).then(function (buf) {
    var sum = crypto.createHash("sha256").update(buf).digest("hex");
    if (sum !== String(m.ipkHash.sha256).toLowerCase()) throw new Error("Checksum does not match, not installing");
    if (m.ipkSize && buf.length !== m.ipkSize) throw new Error("Size does not match, not installing");
    var file = deps.tmpDir + "/" + item.id + "_" + m.version + ".ipk";
    fs.writeFileSync(file, buf);
    return deps.installIpk(file, item.id).then(function () { try { fs.unlinkSync(file); } catch (e) {} });
  });
}

// Full run. Our own id goes last because installing it restarts this service.
// deps adds: listInstalled() -> Promise({id: version}), log(msg), selfId
function run(deps) {
  var results = [];
  return deps.listInstalled().then(function (installed) {
    deps.installed = installed;
    return plan(deps);
  }).then(function (items) {
    var todo = items.filter(function (i) { return i.state === "update"; });
    todo.sort(function (a, b) { return (a.id === deps.selfId) - (b.id === deps.selfId); });
    var chain = Promise.resolve();
    todo.forEach(function (it) {
      chain = chain.then(function () {
        deps.log("Updating " + it.title + " " + it.installed + " -> " + it.available);
        return applyOne(it, deps).then(function () { return deps.listInstalled(); }).then(function (now) {
          if (compareVersions(now[it.id], it.available) < 0) throw new Error("Installer finished but the TV still reports " + (now[it.id] || "nothing"));
          it.state = "updated"; it.installed = now[it.id];
        }).catch(function (e) { it.state = "failed"; it.error = e.message; deps.log("Failed " + it.title + ": " + e.message); });
      });
    });
    return chain.then(function () {
      return items.map(function (i) { delete i.manifest; delete i.manifestUrl; return i; });
    });
  });
}

module.exports = { compareVersions: compareVersions, plan: plan, applyOne: applyOne, run: run, DEFAULT_FEED: DEFAULT_FEED, getJson: getJson };
