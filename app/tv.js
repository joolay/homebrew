/* webOS remote integration: Back key (461) and TV zoom control. */
(function () {
  var cfg = window.STREMIO_TV_ZOOM || 1.5, KEY = 'stremioTvZoom', zoom = cfg, toast;
  try { var s = parseFloat(localStorage.getItem(KEY)); if (s >= 0.8 && s <= 3) zoom = s; } catch (e) {}

  function apply() {
    var h = document.documentElement;
    h.style.zoom = zoom;                       // Chromium 53 supports CSS zoom
    try { localStorage.setItem(KEY, zoom); } catch (e) {}
  }
  function show() {
    if (!toast) {
      toast = document.createElement('div');
      toast.style.cssText = 'position:fixed;left:50%;bottom:5%;transform:translateX(-50%);z-index:99999;padding:8px 18px;background:rgba(0,0,0,.8);color:#fff;font:18px sans-serif;border-radius:6px;pointer-events:none;zoom:' + (1 / zoom);
      document.body.appendChild(toast);
    }
    toast.style.zoom = 1 / zoom;
    toast.textContent = 'Zoom ' + Math.round(zoom * 100) + '%  (Red = smaller, Green = larger, Yellow = reset)';
    toast.style.display = 'block';
    clearTimeout(show.t); show.t = setTimeout(function () { toast.style.display = 'none'; }, 2500);
  }
  function set(z) { zoom = Math.max(0.8, Math.min(3, Math.round(z * 20) / 20)); apply(); show(); }

  apply();
  document.addEventListener('keydown', function (e) {
    if (e.keyCode === 461) {                   // Back
      e.preventDefault();
      if (history.length > 1) history.back();
    } else if (e.keyCode === 403) { e.preventDefault(); set(zoom - 0.1); }   // Red
    else if (e.keyCode === 404) { e.preventDefault(); set(zoom + 0.1); }     // Green
    else if (e.keyCode === 405) { e.preventDefault(); set(cfg); }            // Yellow
  }, true);
})();
