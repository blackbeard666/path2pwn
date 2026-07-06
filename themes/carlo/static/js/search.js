(function () {
  var input = document.getElementById('search-input');
  var dropdown = document.getElementById('search-dropdown');
  var results = document.getElementById('search-results');
  var status = document.getElementById('search-status');
  if (!input || !dropdown || !results || typeof Fuse === 'undefined') return;

  var fuse = null;
  var loading = null; // promise, so the index is fetched at most once
  var items = [];     // rendered <a> nodes, for keyboard nav
  var active = -1;

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : s;
    return d.innerHTML;
  }

  // Mirror Hugo's urlize for tag slugs (lowercase, spaces/underscores → hyphens).
  function slug(t) {
    return String(t).toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '');
  }

  function open() { dropdown.classList.add('open'); }
  function close() { dropdown.classList.remove('open'); active = -1; }

  function loadIndex() {
    if (loading) return loading;
    status.textContent = 'loading index…';
    open();
    loading = fetch('/index.json')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        fuse = new Fuse(data, {
          keys: [
            { name: 'title', weight: 0.5 },
            { name: 'tags', weight: 0.3 },
            { name: 'category', weight: 0.15 },
            { name: 'body', weight: 0.05 }
          ],
          threshold: 0.35,
          ignoreLocation: true,
          minMatchCharLength: 2
        });
      })
      .catch(function () {
        status.textContent = 'failed to load search index.';
        loading = null; // allow a retry on next focus
      });
    return loading;
  }

  function setActive(i) {
    if (!items.length) return;
    if (active >= 0 && items[active]) items[active].classList.remove('active');
    active = (i + items.length) % items.length;
    items[active].classList.add('active');
    items[active].scrollIntoView({ block: 'nearest' });
  }

  function render(matches, q) {
    results.innerHTML = '';
    items = [];
    active = -1;
    if (!matches.length) { status.textContent = 'no matches for "' + q + '"'; return; }
    status.textContent = matches.length + ' result' + (matches.length === 1 ? '' : 's');

    matches.forEach(function (m) {
      var p = m.item;
      var meta = [p.date, p.type];
      if (p.category) meta.push(p.category);
      (p.tags || []).slice(0, 4).forEach(function (t) { meta.push(t); });

      var a = document.createElement('a');
      a.className = 'search-result';
      a.href = p.url;
      a.innerHTML =
        '<span class="search-result-title">' + esc(p.title) + '</span>' +
        '<span class="search-result-meta">' + esc(meta.join(' · ')) + '</span>';
      results.appendChild(a);
      items.push(a);
    });
  }

  function run() {
    var q = input.value.trim();
    if (!q) { close(); return; }
    open();
    if (!fuse) {
      loadIndex().then(function () { if (fuse && input.value.trim()) run(); });
      return;
    }
    render(fuse.search(q).slice(0, 20), q);
  }

  input.addEventListener('focus', function () {
    loadIndex();
    if (input.value.trim()) run();
  });

  input.addEventListener('input', run);

  input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Enter') {
      var target = active >= 0 ? items[active] : items[0];
      if (target) { e.preventDefault(); window.location.href = target.href; }
    } else if (e.key === 'Escape') {
      input.value = '';
      close();
      input.blur();
    }
  });

  // Close when clicking outside the search widget.
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.nav-search')) close();
  });

  // Deep-link support: /?q=android (or any page) pre-fills and opens the box.
  var q0 = new URLSearchParams(window.location.search).get('q');
  if (q0) {
    input.value = q0;
    loadIndex().then(function () { run(); input.focus(); });
  }
})();
