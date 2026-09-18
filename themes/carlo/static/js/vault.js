/* ============================================================================
   vault.js — unlocks a locked post in the browser.

   The committed page carries no body at all: static/vault/<slug>.json holds the
   article as AES-256-GCM ciphertext, and this decrypts it after a password.
   Sealed by tools/vault.js — the payload format is documented there.

   Envelope, not direct encryption. A random content key (CEK) encrypted the body
   and every image; the password only derives a key that UNWRAPS the CEK. So
   `keys` is an array, and per-recipient passwords can be added later without
   re-encrypting anything.

   No date check anywhere in this file, on purpose. A client-side expiry is a
   one-line bypass, and shipping one would claim an enforcement that does not
   exist. Expiry is rotation — see vault-src/README.md.

   Nothing is persisted. The password is not written to localStorage or
   sessionStorage: it would outlive the reading session for no real gain, on a
   site whose whole subject is what happens to data left lying around.
   ========================================================================== */

(function () {
  var host = document.querySelector('.post-body[data-vault]');
  if (!host) return;

  var form = host.querySelector('[data-vault-form]');
  var input = host.querySelector('[data-vault-input]');
  var submit = host.querySelector('[data-vault-submit]');
  var errorEl = host.querySelector('[data-vault-error]');
  if (!form || !input || !submit || !errorEl) return;

  var slug = host.getAttribute('data-vault');
  /* relURL'd by the partial rather than hardcoded, so the fetch still resolves
     if the site is ever served from a subpath. */
  var base = form.getAttribute('data-vault-base') || '/vault/';
  var payload = null;

  /* file:// FIRST, and note it is NOT the secure-context case — Chrome and
     Firefox both treat file:// as potentially trustworthy, so crypto.subtle is
     present and the check below passes. What fails is the fetch, on an opaque
     origin, which then reported "could not load the encrypted post" and sent
     the reader hunting for a network problem. (An earlier comment here claimed
     file:// was not a secure context. It was wrong; measured secure=true.) */
  if (location.protocol === 'file:') {
    fail('Open this over http(s), not as a local file. The browser blocks the ' +
         'encrypted payload fetch on a file:// page.');
    submit.disabled = true;
    return;
  }

  /* crypto.subtle is only exposed in a SECURE CONTEXT — https or localhost. On a
     bare http:// origin the failure is an undefined property rather than an
     exception, so say so plainly instead of letting the first click throw.
     This is an affordance, not a control: anyone serving modified JS deletes it. */
  if (!window.isSecureContext || !window.crypto || !window.crypto.subtle) {
    fail('This page needs a secure connection (https) to decrypt. ' +
         'Over plain http the browser withholds the crypto API entirely.');
    submit.disabled = true;
    return;
  }

  function fail(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  function clearError() {
    errorEl.hidden = true;
    errorEl.textContent = '';
  }

  function b64buf(s) {
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function loadPayload() {
    if (payload) return Promise.resolve(payload);
    /* ?v=<content hash> — GitHub Pages and Cloudflare both cache this normally,
       so after a rotation a warm cache kept serving the OLD ciphertext: the new
       password reported "did not work" and the old one still opened the post.
       That is the only expiry mechanism there is, silently not applying. */
    var ver = form.getAttribute('data-vault-ver');
    return fetch(base + slug + '.json' + (ver ? '?v=' + encodeURIComponent(ver) : ''),
                 { credentials: 'omit' })
      .then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      })
      .then(function (p) { payload = p; return p; });
  }

  /* Warm the fetch while the reader is still typing, so "unlock" is only ever
     waiting on key derivation. Same idle-prefetch habit as filter.js. */
  var idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 400); };
  idle(function () { loadPayload().catch(function () { /* reported on submit */ }); });

  async function unwrapCek(p, password) {
    var slot = p.keys[0];
    var salt = b64buf(slot.salt);
    var material = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    var kek = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: p.iter, hash: 'SHA-256' },
      material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);

    /* GCM's auth tag IS the password check — a wrong password throws here
       rather than yielding plausible-looking garbage. */
    var cekRaw = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64buf(slot.iv) }, kek, b64buf(slot.wrapped));
    return crypto.subtle.importKey('raw', cekRaw, 'AES-GCM', false, ['decrypt']);
  }

  /* Image metadata comes from the DECRYPTED doc, never from the public payload.
     It used to live beside the ciphertext, which published the original
     filenames — a leak out of the body. The id is also the .bin filename, and
     ids are random per build, so nothing here is guessable and every rotation
     cache-busts its own images. */
  async function decryptImages(cek, doc) {
    var imgs = host.querySelectorAll('img[data-vault-img]');
    for (var i = 0; i < imgs.length; i++) {
      var el = imgs[i];
      var id = el.getAttribute('data-vault-img');
      var meta = doc.images && doc.images[id];
      /* Reject anything that is not a plain id before it reaches a URL. */
      if (!meta || !/^[0-9a-f]{8,64}$/.test(id)) continue;
      try {
        var res = await fetch(base + slug + '/' + id + '.bin', { credentials: 'omit' });
        if (!res.ok) throw new Error(res.status);
        var plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: b64buf(meta.iv) }, cek, await res.arrayBuffer());
        var url = URL.createObjectURL(new Blob([plain], { type: meta.type }));
        el.addEventListener('load', function () { URL.revokeObjectURL(this.src); });
        el.removeAttribute('data-vault-img');
        el.src = url;
      } catch (e) {
        /* One unreadable screenshot must not take the article down with it. */
        el.replaceWith(Object.assign(document.createElement('p'), {
          className: 'vault-img-fail',
          textContent: '[image could not be decrypted: ' + (el.alt || 'untitled') + ']',
        }));
      }
    }
  }

  function reveal(doc) {
    host.innerHTML = doc.body;

    var slot = document.querySelector('[data-toc-slot]');
    var toc = slot && slot.querySelector('[data-toc]');
    if (slot && toc && doc.toc) {
      toc.innerHTML = doc.toc;
      /* Only unhide if the outline actually has entries. Hugo emits a bare
         <nav id="TableOfContents"></nav> for a post with no headings, which is
         truthy but empty — the same trap single.html's guard had to avoid. */
      if (toc.querySelector('a')) slot.hidden = false;
    }

    host.removeAttribute('data-vault');
    /* toc.js and ui.js both listen: a locked page had no headings to observe and
       no code blocks to decorate at parse time. */
    document.dispatchEvent(new Event('vault:unlocked'));
  }

  form.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    clearError();

    var password = input.value.trim();
    if (!password) return;

    var label = submit.textContent;
    submit.disabled = true;
    submit.textContent = 'decrypting';

    try {
      var p = await loadPayload();
      var cek = await unwrapCek(p, password);
      var buf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: b64buf(p.iv) }, cek, b64buf(p.ct));
      var doc = JSON.parse(new TextDecoder().decode(buf));

      reveal(doc);
      await decryptImages(cek, doc);
    } catch (e) {
      submit.disabled = false;
      submit.textContent = label;
      /* A fetch/parse failure and a bad password are genuinely different
         problems and deserve different messages — "wrong password" on a 404
         sends the reader hunting for a password that was never the issue. */
      if (!payload) {
        fail('Could not load the encrypted post. Check your connection and reload.');
      } else {
        fail('That password did not work.');
        input.select();
      }
    }
  });

  input.addEventListener('input', clearError);

  /* Harness hook. scratchpad/vault-gate.js waits on this before it types:
     submitting before the listener is bound looks exactly like a wrong
     password (nothing happens), which cost a debugging round. */
  window.__vaultReady = true;
})();
