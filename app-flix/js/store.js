/* Tiny localStorage wrapper (never throws). */
var Store = (function () {
  function get(k, d) { try { var v = localStorage.getItem('flix.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function set(k, v) { try { localStorage.setItem('flix.' + k, JSON.stringify(v)); } catch (e) {} }
  function del(k) { try { localStorage.removeItem('flix.' + k); } catch (e) {} }
  return { get: get, set: set, del: del };
})();
