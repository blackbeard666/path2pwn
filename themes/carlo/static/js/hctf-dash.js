// Tabs for the CTF stats dashboard (layouts/ctf/single.html).
//
// Progressive enhancement: without this file every panel renders stacked and
// the tab row is a list of in-page anchors. With it, one panel shows at a time,
// the URL hash names it (deep links and the back button keep working), and the
// row behaves as an ARIA tablist with arrow-key navigation.
(function () {
  var dash = document.querySelector('[data-hc-dash]');
  if (!dash) return;
  var tabs = Array.prototype.slice.call(dash.querySelectorAll('[data-tab]'));
  var panels = Array.prototype.slice.call(dash.querySelectorAll('[data-panel]'));
  if (!tabs.length || !panels.length) return;

  var list = tabs[0].parentNode;
  list.setAttribute('role', 'tablist');
  tabs.forEach(function (t) {
    t.setAttribute('role', 'tab');
    t.id = 'tab-' + t.dataset.tab;
    t.setAttribute('aria-controls', t.dataset.tab);
  });
  panels.forEach(function (p) {
    p.setAttribute('role', 'tabpanel');
    p.setAttribute('aria-labelledby', 'tab-' + p.dataset.panel);
  });
  dash.classList.add('hc-js');

  function show(id, focus) {
    var hit = panels.some(function (p) { return p.dataset.panel === id; });
    if (!hit) id = panels[0].dataset.panel;
    tabs.forEach(function (t) {
      var on = t.dataset.tab === id;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      t.classList.toggle('is-active', on);
      if (on && focus) t.focus();
    });
    panels.forEach(function (p) { p.hidden = p.dataset.panel !== id; });
  }

  tabs.forEach(function (t, i) {
    t.addEventListener('click', function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      history.replaceState(null, '', '#' + t.dataset.tab);
      show(t.dataset.tab, false);
    });
    t.addEventListener('keydown', function (e) {
      var j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 :
              e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
      if (j === null) return;
      e.preventDefault();
      var n = tabs[(j + tabs.length) % tabs.length];
      history.replaceState(null, '', '#' + n.dataset.tab);
      show(n.dataset.tab, true);
    });
  });
  window.addEventListener('hashchange', function () { show(location.hash.slice(1), false); });
  show(location.hash.slice(1), false);
})();
