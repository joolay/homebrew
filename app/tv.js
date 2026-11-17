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

/* Playback speed: webOS TVs often reset playbackRate on play/seek/buffering. Re-apply the chosen rate and
   report on screen if the TV's player refuses it. */
(function () {
  var desired = null, fixes = 0, t0 = 0, note;
  function say(msg) {
    if (!note) {
      note = document.createElement('div');
      note.style.cssText = 'position:fixed;left:50%;top:6%;transform:translateX(-50%);z-index:99999;padding:8px 18px;background:rgba(0,0,0,.85);color:#fff;font:18px sans-serif;border-radius:6px;pointer-events:none;';
      document.body.appendChild(note);
    }
    note.textContent = msg; note.style.display = 'block';
    clearTimeout(say.t); say.t = setTimeout(function () { note.style.display = 'none'; }, 3500);
  }
  window.__tvSetRate = function (video, rate) {
    desired = rate; fixes = 0;
    try { video.defaultPlaybackRate = rate; } catch (e) {}
    video.playbackRate = rate;
    setTimeout(function () {
      if (desired !== null && Math.abs(video.playbackRate - desired) > 0.01) {
        video.playbackRate = desired;
        setTimeout(function () {
          if (desired !== null && Math.abs(video.playbackRate - desired) > 0.01) say('This TV\'s player does not support ' + desired + 'x speed');
          else say('Speed ' + desired + 'x');
        }, 700);
      } else say('Speed ' + desired + 'x');
    }, 500);
  };
  function reapply(e) {
    var v = e.target;
    if (desired === null || !v || v.tagName !== 'VIDEO') return;
    if (Math.abs(v.playbackRate - desired) > 0.01) {
      var now = Date.now(); if (now - t0 > 3000) { fixes = 0; t0 = now; }
      if (fixes++ < 5) v.playbackRate = desired;   // bounded, avoids ratechange loops
    }
  }
  ['playing', 'seeked', 'ratechange', 'loadedmetadata', 'canplay'].forEach(function (n) {
    document.addEventListener(n, reapply, true);
  });
})();
