/* Minimal polyfills for Chromium 53 (webOS 4.0). Loaded before the Stremio 4.4 bundle. */
(function () {
  var d = Object.defineProperty;
  function def(o, n, f) { if (!o[n]) d(o, n, { value: f, writable: true, configurable: true }); }
  def(Object, 'values', function (o) { return Object.keys(o).map(function (k) { return o[k]; }); });
  def(Object, 'entries', function (o) { return Object.keys(o).map(function (k) { return [k, o[k]]; }); });
  def(Object, 'fromEntries', function (it) { var r = {}; Array.prototype.forEach.call(it, function (e) { r[e[0]] = e[1]; }); return r; });
  def(Object, 'getOwnPropertyDescriptors', function (o) { var r = {}; Object.getOwnPropertyNames(o).forEach(function (k) { r[k] = Object.getOwnPropertyDescriptor(o, k); }); return r; });
  def(String.prototype, 'padStart', function (n, s) { var t = String(this); s = s === undefined ? ' ' : String(s); if (t.length >= n || !s) return t; var p = ''; while (p.length < n - t.length) p += s; return p.slice(0, n - t.length) + t; });
  def(String.prototype, 'padEnd', function (n, s) { var t = String(this); s = s === undefined ? ' ' : String(s); if (t.length >= n || !s) return t; var p = ''; while (p.length < n - t.length) p += s; return t + p.slice(0, n - t.length); });
  def(String.prototype, 'trimStart', function () { return this.replace(/^\s+/, ''); });
  def(String.prototype, 'trimEnd', function () { return this.replace(/\s+$/, ''); });
  def(String.prototype, 'replaceAll', function (a, b) { return a instanceof RegExp ? this.replace(a, b) : this.split(a).join(b); });
  def(Array.prototype, 'flat', function (dep) { dep = dep === undefined ? 1 : dep; var f = function (a, n) { return a.reduce(function (r, x) { return r.concat(Array.isArray(x) && n > 0 ? f(x, n - 1) : [x]); }, []); }; return f(this, dep); });
  def(Array.prototype, 'flatMap', function (fn, t) { return this.map(fn, t).flat(1); });
  def(Array.prototype, 'includes', function (x, i) { return this.indexOf(x, i) !== -1; });
  if (window.Promise && !Promise.prototype.finally) {
    d(Promise.prototype, 'finally', { configurable: true, writable: true, value: function (f) {
      var C = this.constructor;
      return this.then(function (v) { return C.resolve(f()).then(function () { return v; }); },
                       function (e) { return C.resolve(f()).then(function () { throw e; }); });
    } });
  }
  if (!window.AbortController) {
    window.AbortController = function () { this.signal = { aborted: false, addEventListener: function () {}, removeEventListener: function () {} }; };
    window.AbortController.prototype.abort = function () { this.signal.aborted = true; };
  }
})();

/* Resilient fetch for the streaming server: retries so a slow first connection (mDNS lookup,
   server waking up) doesn't show "server offline". urlFn is re-evaluated each try so a changed server URL is honoured. */
window.__retryFetch = function (urlFn, opts, tries, delay) {
  tries = tries || 5; delay = delay || 1200;
  return new Promise(function (resolve, reject) {
    (function attempt(n) {
      fetch(urlFn(), opts).then(function (r) {
        if (r.status >= 500 && n < tries) return setTimeout(function () { attempt(n + 1); }, delay);
        resolve(r);
      }, function (e) {
        if (n < tries) setTimeout(function () { attempt(n + 1); }, delay); else reject(e);
      });
    })(1);
  });
};
/* Warm up the connection to the server at launch. */
if (window.fetch && window.STREMIO_SERVER_URL) { try { fetch(window.STREMIO_SERVER_URL + '/settings').catch(function () {}); } catch (e) {} }
