/* Boot + global key handling. */
window.FLIX_VERSION = 'v1.3.0';
(function () {
  var KEYS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
  var BACK = { 8: 1, 27: 1, 461: 1, 10009: 1 };

  document.addEventListener('keydown', function (e) {
    var code = e.keyCode, ae = document.activeElement;
    var typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
    if (typing) {
      if (code === 13) { ae.blur(); if (ae.id === 'q') Views.runSearch(ae.value.trim()); else if (ae.id === 'pass') Views.act(document.querySelector('[data-act=dologin]')); e.preventDefault(); return; }
      if (BACK[code] && code !== 8) { ae.blur(); e.preventDefault(); return; }
      if (code === 38 || code === 40) { ae.blur(); } else { return; }   // normal typing
    }
    if (Player.key(code, e)) { e.preventDefault(); return; }
    if (KEYS[code]) {
      e.preventDefault();
      if (code === 39 && Views.sideOpen()) { Views.closeSide(); return; }
      if (!Nav.move(KEYS[code]) && code === 37) Views.openSide();
      return;
    }
    if (code === 13) {
      e.preventDefault();
      var c = Nav.cur();
      if (!c) return;
      if (c.tagName === 'INPUT') { c.focus(); return; }
      if (c.hasAttribute('data-act')) Views.act(c); else c.click();
      return;
    }
    if (BACK[code]) { e.preventDefault(); if (!Views.back()) { try { window.close(); } catch (x) {} } return; }
  }, true);

  document.addEventListener('click', function (e) {
    var c = e.target.closest ? e.target.closest('.f') : null;
    if (c && c.tagName === 'INPUT') c.focus();
  });

  function boot() {
    var q = location.search;
    var dbg = /[?&]debugstream=([^&]+)/.exec(q);
    Views.page('home');
    if (dbg) setTimeout(function () { Player.open({ type: 'movie', id: 'tt0111161', videoId: 'tt0111161', title: 'Debug stream', _direct: decodeURIComponent(dbg[1]) }); }, 1500);
  }
  boot();
})();
