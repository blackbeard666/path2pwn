/* ============================================================
   ui.js — theme toggle and code-block copy buttons.
   Mirrors the same two blocks in carlo-dev/script.js; the two repos
   are separate, so a 40-line duplicate beats a shared-module setup.
   ============================================================ */

/* ---- Theme toggle ----------------------------------------------------
   The saved preference is applied by the inline guard in partials/head.html
   before first paint; this only handles the click and keeps the label
   truthful. Dark is the default, so only 'light' is ever stored.
   -------------------------------------------------------------------- */
(function themeToggle() {
  var btn = document.querySelector('[data-theme-toggle]');
  if (!btn) return;
  var root = document.documentElement;

  function paint() {
    var light = root.dataset.theme === 'light';
    btn.setAttribute('aria-pressed', String(light));
    btn.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
  }

  btn.addEventListener('click', function () {
    if (root.dataset.theme === 'light') {
      delete root.dataset.theme;
      localStorage.removeItem('theme');
    } else {
      root.dataset.theme = 'light';
      localStorage.setItem('theme', 'light');
    }
    paint();
  });

  paint();
})();

/* ---- Copy buttons ---------------------------------------------------
   Injected rather than authored into every code fence, because Hugo's
   Chroma output is generated markdown — there is no template hook to put
   a button inside each <pre>.
   -------------------------------------------------------------------- */
(function copyButtons() {
  if (!navigator.clipboard) return;
  var blocks = document.querySelectorAll('.post-body .highlight, .post-body pre:not(.highlight pre)');
  Array.prototype.forEach.call(blocks, function (block) {
    var pre = block.matches('pre') ? block : block.querySelector('pre');
    if (!pre || block.querySelector('[data-copy]')) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-btn';
    btn.setAttribute('data-copy', '');
    btn.textContent = 'copy';

    var reset;
    btn.addEventListener('click', function () {
      navigator.clipboard.writeText(pre.innerText).then(
        function () { btn.textContent = 'copied'; },
        function () { btn.textContent = 'press ctrl+c'; }
      );
      clearTimeout(reset);
      reset = setTimeout(function () { btn.textContent = 'copy'; }, 1600);
    });

    block.classList.add('has-copy');
    block.appendChild(btn);
  });
})();
