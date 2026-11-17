/* webOS remote integration: Back key (461) -> history back / Escape. */
document.addEventListener('keydown', function (e) {
  if (e.keyCode === 461) {
    e.preventDefault();
    if (history.length > 1) history.back();
    else if (window.webOS && webOS.platformBack) webOS.platformBack();
  }
}, true);
