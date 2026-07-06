(function () {
  if (typeof Fuse === 'undefined') return;

  var fuse = null;
  var loading = null; // promise, so the index is fetched at most once

  function loadIndex() {
    if (loading) return loading;
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
        return fuse;
      })
      .catch(function (e) { loading = null; throw e; });
    return loading;
  }

  // Preload the index during idle time so the first search is instant instead
  // of paying a focus→fetch round-trip. Browser HTTP-caches /index.json, so
  // this is at most one background fetch across the whole visit.
  var idle = window.requestIdleCallback || function (cb) { return setTimeout(cb, 1200); };
  idle(function () { loadIndex().catch(function () {}); });

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : s;
    return d.innerHTML;
  }

  // Mirror Hugo's urlize for tag slugs (lowercase, spaces/underscores → hyphens).
  function slug(t) {
    return String(t).toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '');
  }

  function query(q) { return fuse ? fuse.search(q) : []; }

  // ---------- Header dropdown (every page) ----------
  (function initHeader() {
    var input = document.getElementById('search-input');
    var dropdown = document.getElementById('search-dropdown');
    var results = document.getElementById('search-results');
    var status = document.getElementById('search-status');
    if (!input || !dropdown || !results) return;

    var items = [];
    var active = -1;

    function open() { dropdown.classList.add('open'); }
    function close() { dropdown.classList.remove('open'); active = -1; }

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
      if (!matches.length) {
        status.textContent = 'no matches — press Enter to search';
        return;
      }
      status.textContent = matches.length + ' result' + (matches.length === 1 ? '' : 's') + ' · Enter to see all';

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
        status.textContent = 'loading…';
        loadIndex().then(function () { if (input.value.trim()) run(); })
          .catch(function () { status.textContent = 'failed to load index.'; });
        return;
      }
      render(query(q).slice(0, 20), q);
    }

    function goToResultsPage() {
      var q = input.value.trim();
      if (q) window.location.href = '/search/?q=' + encodeURIComponent(q);
    }

    input.addEventListener('focus', function () {
      loadIndex().catch(function () {});
      if (input.value.trim()) run();
    });
    input.addEventListener('input', run);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (active >= 0 && items[active]) window.location.href = items[active].href; // a result is highlighted
        else goToResultsPage();                                                       // nothing selected → full page
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

    // Deep-link ?q on a non-search page pre-fills the box and opens the
    // dropdown. (The /search page has its own input that owns the query there.)
    if (!document.getElementById('search-page-input')) {
      var q0 = new URLSearchParams(window.location.search).get('q');
      if (q0) { input.value = q0; run(); }
    }
  })();

  // ---------- Dedicated /search results page ----------
  (function initPage() {
    var input = document.getElementById('search-page-input');
    var results = document.getElementById('search-page-results');
    var status = document.getElementById('search-page-status');
    if (!input || !results) return;

    function render(matches, q) {
      results.innerHTML = '';
      if (!q) { status.textContent = ''; return; }
      if (!matches.length) { status.textContent = 'no matches for "' + q + '"'; return; }
      status.textContent = matches.length + ' result' + (matches.length === 1 ? '' : 's') + ' for "' + q + '"';

      matches.forEach(function (m) {
        var p = m.item;
        var tags = '';
        if (p.category) tags += '<span class="tag tag-main">' + esc(p.category) + '</span>';
        (p.tags || []).forEach(function (t) {
          tags += '<a href="/tags/' + slug(t) + '/" class="tag">' + esc(t) + '</a>';
        });

        var li = document.createElement('li');
        li.className = 'post-list-row';
        li.innerHTML =
          '<time class="post-date">' + esc(p.date) + '</time>' +
          '<a href="' + esc(p.url) + '" class="post-title">' + esc(p.title) + '</a>' +
          (tags ? '<div class="post-tags">' + tags + '</div>' : '');
        results.appendChild(li);
      });
    }

    function run() {
      var q = input.value.trim();
      if (!fuse) {
        status.textContent = 'loading index…';
        loadIndex().then(run).catch(function () { status.textContent = 'failed to load index.'; });
        return;
      }
      render(query(q).slice(0, 100), q);
      // Keep the URL shareable/refreshable without adding history entries.
      var url = q ? '?q=' + encodeURIComponent(q) : window.location.pathname;
      window.history.replaceState(null, '', url);
    }

    input.addEventListener('input', run);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') e.preventDefault(); });

    var q0 = new URLSearchParams(window.location.search).get('q');
    if (q0) input.value = q0;
    input.focus();
    run();
  })();
})();
