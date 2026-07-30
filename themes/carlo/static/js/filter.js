/* ============================================================
   filter.js — the filter bar on /cves/, /writeups/ and /all/.

   THE ARCHIVES ARE PAGINATED, which is the whole reason this file is
   shaped the way it is. An earlier version filtered rows already in the
   DOM; with 10 posts per page that could only ever search the page you
   happened to be on. So:

     no filter active -> leave Hugo's server-rendered page alone,
                         paginator visible
     filter active    -> render matches from /index.json into a separate
                         container, hide the server rows and the
                         paginator, and say so in the status line

   That is why layouts/index.json has to carry every field
   partials/post-row.html renders (readingTime included) — a row rendered
   here must be indistinguishable from one rendered by Hugo.

   MATCHING is the union of two passes:
     1. literal substring over title / cve / category / tags / vendor
     2. Fuse.js, which adds fuzziness and reaches body text
   Both run against the index, not the DOM.

   IDENTIFIER QUERIES SKIP FUSE. Any query containing a digit
   ("CVE-2023-4876", "3.8.5") is matched by exact substring over the whole
   record instead. Fuzzy-matching an identifier is never what you want: at
   threshold 0.35 "CVE-2023-4876" returned all six CVE ids, and even at
   0.2 it still returned two, because they share a long prefix. Exact
   matching returns one — and still finds an id that appears only in
   another post's body.

   Matching decides WHICH posts show; the sort control decides the ORDER.
   ============================================================ */
(function () {
  var bar = document.querySelector('[data-filter-bar]');
  var server = document.querySelector('[data-index]');
  var out = document.querySelector('[data-filter-results]');
  if (!bar || !server || !out) return;

  var input = bar.querySelector('[data-filter-input]');
  var sortSel = bar.querySelector('[data-filter-sort]');
  var chips = Array.prototype.slice.call(bar.querySelectorAll('[data-cat-chip]'));
  var statusEl = document.querySelector('[data-filter-status]');
  var emptyEl = document.querySelector('[data-empty]');
  var clearBtn = emptyEl && emptyEl.querySelector('[data-filter-clear]');

  var SCOPE = bar.dataset.filterScope || '';        // '', 'cves' or 'writeups'
  var TOTAL = Number(bar.dataset.filterCount || 0);
  var TAGS_BASE = (function () {
    var a = document.querySelector('[data-tag-link]');
    return a ? a.getAttribute('href').replace(/[^/]+\/$/, '') : '/tags/';
  })();

  var state = { q: '', cat: '', sort: 'newest' };
  var fuse = null;
  var records = null;
  var indexPromise = null;

  /* ---- index ---- */

  function loadIndex() {
    if (indexPromise) return indexPromise;
    indexPromise = fetch(bar.dataset.indexUrl || '/index.json')
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) {
        records = SCOPE ? data.filter(function (r) { return r.type === SCOPE; }) : data;
        if (typeof Fuse !== 'undefined') {
          fuse = new Fuse(records, {
            threshold: 0.2,
            ignoreLocation: true,
            keys: [
              { name: 'title', weight: 0.4 },
              { name: 'cve', weight: 0.25 },
              { name: 'tags', weight: 0.15 },
              { name: 'vendor', weight: 0.08 },
              { name: 'category', weight: 0.07 },
              { name: 'summary', weight: 0.04 },
              { name: 'body', weight: 0.01 }
            ]
          });
        }
        return records;
      })
      .catch(function () { records = null; fuse = null; return null; });
    return indexPromise;
  }

  /* ---- rendering ---- */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sevClass(sev) {
    var s = String(sev || '').toLowerCase();
    return s === 'critical' || s === 'high' || s === 'low' ? 'is-' + s : 'is-medium';
  }

  /* Mirrors partials/post-row.html. If you change that file, change this. */
  function rowHtml(r) {
    var meta = ['<time datetime="' + esc(r.date) + '">' + esc(r.date) + '</time>'];
    if (r.cve) meta.push('<span class="badge-cve">CVE</span>');
    /* Mirrors the severity badge in partials/post-row.html. /index.json already
       carried `severity` before this rendered it. */
    if (r.severity) {
      meta.push('<span class="badge-sev is-' + esc(r.severity.toLowerCase()) + '">' +
                esc(r.severity) + '</span>');
    }
    if (r.category) meta.push('<span class="badge-cat">' + esc(r.category) + '</span>');
    if (r.readingTime) meta.push('<span>' + esc(r.readingTime) + ' min</span>');
    if (r.cve && r.status) meta.push('<span class="row-status">' + esc(r.status) + '</span>');
    else if (!r.cve && r.source) meta.push('<span class="row-source">' + esc(r.source) + '</span>');

    var tags = (r.tags || []).map(function (t) {
      return '<a data-tag-link="' + esc(t) + '" href="' + esc(TAGS_BASE + slug(t)) + '/">#' + esc(t) + '</a>';
    }).join('');

    return '<article class="row" data-row' +
      ' data-url="' + esc(r.url) + '"' +
      ' data-title="' + esc(r.title) + '"' +
      ' data-cve="' + esc(r.cve) + '"' +
      ' data-cat="' + esc(r.category) + '"' +
      ' data-type="' + esc(r.type) + '"' +
      ' data-tags="' + esc((r.tags || []).join(' ')) + '">' +
      '<div class="row-meta">' + meta.join('') + '</div>' +
      '<h2 class="row-title"><a href="' + esc(r.url) + '">' + esc(r.title) + '</a></h2>' +
      (r.summary ? '<p class="row-summary">' + esc(r.summary) + '</p>' : '') +
      (tags ? '<div class="row-tags">' + tags + '</div>' : '') +
      '</article>';
  }

  /* Hugo's urlize, near enough for tag slugs. */
  function slug(s) {
    return String(s).toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  /* ---- matching ---- */

  function inCat(r) {
    if (!state.cat) return true;
    if (state.cat === 'cve') return !!r.cve;
    return String(r.category || '') === state.cat;
  }

  /* `url` is in here so a slug-shaped query works: "htb-pandora" matches
     /writeups/htb-pandora-linux/ even though the title is
     "HackTheBox — Pandora (Linux, Easy)" and contains no such substring. */
  function literalHits(q) {
    var n = q.toLowerCase();
    return records.filter(function (r) {
      return [r.title, r.cve, r.category, r.vendor, r.url, (r.tags || []).join(' ')]
        .join(' ').toLowerCase().indexOf(n) >= 0;
    });
  }

  function exactHits(q) {
    var n = q.toLowerCase();
    return records.filter(function (r) {
      return [r.title, r.cve, r.vendor, r.affected, r.category, r.summary,
              r.url, r.body, (r.tags || []).join(' ')]
              .join(' ').toLowerCase().indexOf(n) >= 0;
    });
  }

  function isIdentifier(q) { return /\d/.test(q); }

  function sortRows(rows) {
    return rows.slice().sort(function (a, b) {
      if (state.sort === 'title') {
        return String(a.title).toLowerCase() < String(b.title).toLowerCase() ? -1 : 1;
      }
      var ka = a.date || '', kb = b.date || '';
      if (ka === kb) return 0;
      return state.sort === 'oldest' ? (ka < kb ? -1 : 1) : (ka > kb ? -1 : 1);
    });
  }

  /* ---- display ---- */

  var active = function () { return !!(state.q || state.cat); };

  function showServer() {
    server.hidden = false;
    out.hidden = true;
    out.innerHTML = '';
    if (emptyEl) emptyEl.hidden = true;
    setStatus(TOTAL + (TOTAL === 1 ? ' post' : ' posts'));
  }

  function showResults(rows) {
    server.hidden = true;
    out.hidden = false;
    out.innerHTML = sortRows(rows).map(rowHtml).join('');
    if (emptyEl) emptyEl.hidden = rows.length !== 0;

    var bits = [rows.length + (rows.length === 1 ? ' result' : ' results')];
    if (state.q) bits.push('for “' + state.q + '”');
    if (state.cat) bits.push('in ' + (state.cat === 'cve' ? 'cves' : state.cat));
    bits.push('· across all pages');
    setStatus(bits.join(' '));
  }

  function setStatus(text) { if (statusEl) statusEl.textContent = text; }

  function apply() {
    if (!active()) { showServer(); return; }

    var q = state.q;
    loadIndex().then(function (recs) {
      if (state.q !== q) return;                 // query moved on mid-fetch
      if (!recs) { fallbackToServer(); return; }

      var rows;
      if (!q) {
        rows = recs.filter(inCat);
      } else if (isIdentifier(q)) {
        rows = exactHits(q).filter(inCat);
      } else {
        var seen = {}, merged = [];
        literalHits(q).forEach(function (r) { seen[r.url] = true; merged.push(r); });
        if (fuse) {
          fuse.search(q).forEach(function (hit) {
            if (!seen[hit.item.url]) { seen[hit.item.url] = true; merged.push(hit.item); }
          });
        }
        rows = merged.filter(inCat);
      }
      showResults(rows);
    });
  }

  /* If /index.json can't be fetched we cannot filter across pages at all.
     Showing the untouched paginated page is the honest failure mode —
     better than rendering an empty list that implies "no matches". */
  function fallbackToServer() {
    showServer();
    setStatus('filter unavailable — showing all ' + TOTAL + ' posts');
  }

  /* ---- URL sync ---- */

  function syncUrl() {
    if (!window.history || !history.replaceState) return;
    var qs = [];
    if (state.q) qs.push('q=' + encodeURIComponent(state.q));
    if (state.cat) qs.push('cat=' + encodeURIComponent(state.cat));
    history.replaceState(null, '', location.pathname + (qs.length ? '?' + qs.join('&') : ''));
  }

  function setCat(cat) {
    state.cat = cat;
    chips.forEach(function (c) {
      var on = (c.dataset.catChip || '') === cat;
      c.classList.toggle('is-on', on);
      c.setAttribute('aria-pressed', String(on));
    });
  }

  /* ---- wiring ---- */

  var timer;
  input.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () {
      state.q = input.value.trim();
      apply();
      syncUrl();
    }, 120);
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { input.value = ''; state.q = ''; apply(); syncUrl(); }
  });

  chips.forEach(function (c) {
    c.addEventListener('click', function () {
      setCat(c.dataset.catChip || '');
      apply();
      syncUrl();
    });
  });

  sortSel && sortSel.addEventListener('change', function () {
    state.sort = sortSel.value;
    apply();
  });

  clearBtn && clearBtn.addEventListener('click', function () {
    input.value = '';
    state.q = '';
    setCat('');
    apply();
    syncUrl();
    input.focus();
  });

  /* A row's own tags filter in place — you're already looking at a list. The
     sidebar's tag list still navigates to /tags/<tag>/ for a real archive page.
     Delegated to the wrapper so it works for rendered rows too. Modified and
     middle clicks are left alone so "open in new tab" keeps working. */
  var wrap = server.parentNode;
  wrap.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-tag-link]');
    if (!a) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    input.value = a.dataset.tagLink;
    state.q = a.dataset.tagLink;
    apply();
    syncUrl();
    bar.scrollIntoView({ block: 'center' });
  });

  /* ---- deep links: ?q=, ?tag=, ?cat= ---- */
  var params = new URLSearchParams(location.search);
  var q0 = params.get('q') || params.get('tag') || '';
  var cat0 = params.get('cat') || '';
  if (q0) { input.value = q0; state.q = q0.trim(); }
  if (cat0) setCat(cat0);
  if (active()) apply();

  /* Warm the index during idle so the first keystroke doesn't wait on a
     round-trip. */
  var idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 400); };
  idle(function () { loadIndex(); });
})();
