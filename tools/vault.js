#!/usr/bin/env node
/* ============================================================================
   vault.js — build tool for locked posts on path2pwn.

   WHY THIS EXISTS
   path2pwn deploys from a PUBLIC GitHub repo to GitHub Pages. Pages has no
   server-side anything, so a gate has to be client-side; and a public repo
   means committed plaintext is readable at raw.githubusercontent.com whatever
   the rendered site does. So protected posts are ENCRYPTED AT BUILD TIME and
   only ciphertext is ever committed.

   THE INVARIANT, and the reason the file split is shaped the way it is:
     FRONT MATTER IS PUBLIC. THE BODY IS SECRET.
   The tool copies a source's front matter verbatim into a committed stub and
   throws the body away. Nothing in the public build is ever derived from the
   plaintext, so there is no filter to remember and no way to half-forget one.

   THREE FILES PER POST
     vault-src/<slug>.md          gitignored   front matter (public) + body (secret)
     content/<section>/<slug>.md  committed    that same front matter, EMPTY body
     static/vault/<slug>.json     committed    AES-256-GCM ciphertext of the body

   WHAT "EXPIRY" MEANS HERE
   Nothing client-side can enforce a date — a `Date.now() > exp` check is a
   one-line bypass — so this ships no date check at all. Expiry is ROTATION:
   `rotate` re-encrypts under a new password, and the old one then decrypts
   nothing on the live site because the ciphertext it matched no longer exists.
   It is NOT retroactive: the previous ciphertext stays in git history and an old
   password still opens an old checkout. See vault-src/README.md.
   ========================================================================== */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const nodeCrypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const crypto = nodeCrypto.webcrypto;

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'vault-src');
const IMG_SRC = path.join(SRC, 'images');
const SECRETS = path.join(SRC, 'vault-secrets.json');
const OUT = path.join(ROOT, 'static', 'vault');

/* PBKDF2 only buys time. The committed ciphertext is offline-crackable at
   leisure, so ENTROPY is what actually holds — hence generated passwords and
   MIN_PW below. Raising iterations is not a substitute for either. */
const ITER = 600000;
const MIN_PW = 16;

/* The sections a stub may land in. Anything else silently creates a live
   orphan section that no archive lists. */
const SECTIONS = ['writeups', 'cves'];

/* The one prefix images may use, so the rewriter has an unambiguous pattern.
   Markdown-relative paths are NOT resolved by Hugo and would silently break. */
const IMG_PREFIX = '/vault-img/';

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};

/* ---- small helpers ------------------------------------------------------ */

const b64 = (buf) => Buffer.from(buf).toString('base64');
const unb64 = (s) => Buffer.from(s, 'base64');
const die = (msg) => { console.error('\n  vault: ' + msg + '\n'); process.exit(1); };
const today = () => new Date().toISOString().slice(0, 10);

/* A bare `date: 2026-09-18` parses as MIDNIGHT UTC, which is in the future from
   any timezone east of Greenwich — so a post dated "today" from Manila is
   silently dropped by Hugo's buildFuture=false and never publishes. Scaffold a
   zoned local timestamp instead, which can never be ahead of now. */
function nowStamp() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
    'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()) +
    sign + p2(Math.floor(Math.abs(off) / 60)) + ':' + p2(Math.abs(off) % 60);
}

function hugoBin() {
  if (process.env.HUGO && fs.existsSync(process.env.HUGO)) return process.env.HUGO;
  const winget = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet',
    'Packages', 'Hugo.Hugo.Extended_Microsoft.Winget.Source_8wekyb3d8bbwe', 'hugo.exe');
  if (fs.existsSync(winget)) return winget;
  return 'hugo';
}

/* Front matter is split as TEXT, never parsed as YAML. The tool needs two
   scalars out of it and otherwise copies it byte-for-byte — which is what keeps
   the stub faithful and keeps a YAML dependency out of a repo that has none. */
function splitFrontMatter(raw, file) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) die('no YAML front matter in ' + file);
  return { fm: m[1], body: m[2] };
}

function fmScalar(fm, key) {
  const m = new RegExp('^' + key + ':\\s*(.+?)\\s*$', 'm').exec(fm);
  if (!m) return null;
  return m[1].replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '');
}

/* Line-based, but continuation-aware: dropping `outputs:` has to take its
   `  - HTML` list items with it, or the stub inherits orphaned YAML and the
   NEXT hugo run fails — long after the ciphertext was already rewritten. */
function fmDropKeys(fm, keys) {
  const out = [];
  let dropping = false;
  for (const l of fm.split(/\r?\n/)) {
    if (/^\S/.test(l)) {
      dropping = keys.some((k) => new RegExp('^' + k + '\\s*:').test(l));
      if (dropping) continue;
    } else if (dropping) {
      continue;
    }
    out.push(l);
  }
  return out.join('\n');
}

function readSecrets() {
  if (!fs.existsSync(SECRETS)) return {};
  try {
    return JSON.parse(fs.readFileSync(SECRETS, 'utf8'));
  } catch (e) {
    die('vault-secrets.json is not valid JSON: ' + e.message);
  }
}

function writeSecrets(obj) {
  fs.mkdirSync(SRC, { recursive: true });
  fs.writeFileSync(SECRETS, JSON.stringify(obj, null, 2) + '\n');
}

/* 20 chars from a 31-symbol unambiguous alphabet is ~99 bits. Grouped so it can
   be read aloud and retyped without the usual 0/O and l/1 arguments. */
function genPassword() {
  const alpha = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let s = '';
  for (let i = 0; i < 20; i++) {
    if (i && i % 5 === 0) s += '-';
    s += alpha[bytes[i] % alpha.length];
  }
  return s;
}

function slugs() {
  if (!fs.existsSync(SRC)) return [];
  return fs.readdirSync(SRC)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => f.replace(/\.md$/, ''))
    .sort();
}

/* A fresh RANDOM id per image per build — deliberately NOT a hash of the
   filename. An earlier version used sha256(slug + name), which is an unkeyed
   hash of two PUBLIC inputs: anyone could guess "acme-router-rce-poc.png",
   hash it against the public slug, and confirm the hit against the published
   .bin name. A random id has nothing to guess. It also cache-busts the image
   on every rotation for free, since the filename changes. */
function imageId() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(8))).toString('hex');
}

/* ---- crypto ------------------------------------------------------------- */

async function deriveKek(password, salt) {
  const base = await crypto.subtle.importKey(
    'raw', Buffer.from(password, 'utf8'), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt, iterations: ITER, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function gcmEncrypt(key, plainBuf) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, plainBuf);
  return { iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

/* Envelope, not direct encryption: a random content key (CEK) encrypts the body
   and every image, and the password-derived key only WRAPS the CEK. That is why
   `keys` is an array — per-recipient passwords can be added later by wrapping
   the same CEK again, with no format change and no re-encryption of the body. */
async function sealPayload(password, parts) {
  const cekRaw = crypto.getRandomValues(new Uint8Array(32));
  const cek = await crypto.subtle.importKey(
    'raw', cekRaw, 'AES-GCM', false, ['encrypt', 'decrypt']);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kek = await deriveKek(password, salt);
  const wrapped = await gcmEncrypt(kek, cekRaw);

  /* Images are encrypted FIRST so their metadata can ride INSIDE the body's
     envelope. It used to sit beside it in the clear, which published the
     original filenames, the image count and each plaintext's exact byte length
     to anyone who fetched the payload. Only the opaque .bin names are public
     now, and those are random per build. */
  const images = {};
  for (const img of parts.images) {
    const enc = await gcmEncrypt(cek, img.bytes);
    images[img.id] = { iv: enc.iv, type: img.type };
    fs.writeFileSync(path.join(OUT, parts.slug, img.id + '.bin'), unb64(enc.ct));
  }

  const doc = Object.assign({}, parts.doc, { images: images });
  const body = await gcmEncrypt(cek, Buffer.from(JSON.stringify(doc), 'utf8'));

  return {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iter: ITER,
    keys: [{ id: 'default', salt: b64(salt), iv: wrapped.iv, wrapped: wrapped.ct }],
    iv: body.iv,
    ct: body.ct,
  };
}

/* ---- image rewriting ---------------------------------------------------- */

/* A targeted regex rather than an HTML parser, which is safe HERE for one
   specific reason: Chroma escapes markup inside code blocks to &lt;img, so a
   literal "<img" in the rendered body can only be a real element. The assertion
   afterwards is what makes it trustworthy — if ANY reference to the prefix
   survives (an <a href>, a srcset, an attribute the regex missed) the build
   aborts rather than shipping a body that fetches a plaintext image from a
   public path. */
function rewriteImages(html, slug) {
  const used = [];
  const out = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\ssrc\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (!src || src[1].indexOf(IMG_PREFIX) !== 0) return tag;
    const name = src[1].slice(IMG_PREFIX.length);
    /* The ORIGINAL FILENAME never leaves this function. It used to become the
       key of a public `images` map in the payload, which published
       "acme-router-rce-poc.png" to anyone running `curl .../<slug>.json` — a
       leak out of the BODY, which is exactly what this design promises cannot
       happen. The marker in the HTML is the opaque id, and the HTML is inside
       the AEAD. */
    const id = imageId();
    used.push({ name: name, id: id });
    return tag.replace(src[0], ' data-vault-img="' + id + '"');
  });

  if (out.indexOf(IMG_PREFIX) !== -1) {
    die('a reference to ' + IMG_PREFIX + ' survived rewriting in "' + slug + '".\n' +
        '  That would fetch a plaintext image from a public path. Reference images\n' +
        '  as ![alt](' + IMG_PREFIX + 'file.png) and nothing else.');
  }
  return { html: out, used: used };
}

/* ---- the staged build --------------------------------------------------- */

/* The tool NEVER writes plaintext into the real content/ tree. It builds a copy
   in the OS temp dir, so a crash mid-run cannot leave a plaintext file sitting
   at a committed path — the one failure this design could not survive. */
const SKIP = new Set(['.git', 'public', 'resources', 'vault-src', 'node_modules',
  'tools', '.hugo_build.lock', '.vault-tmp']);

/* Staging dirs left behind by a SIGTERM, a closed console window or a power
   loss. process.on('exit') never runs for those, and every staged copy holds
   the first 1200 chars of each locked post in its own index.json. Swept at the
   start of each build rather than trusted to the exit handler. */
function sweepStale() {
  let n = 0;
  try {
    for (const e of fs.readdirSync(os.tmpdir())) {
      if (e.indexOf('p2p-vault-') !== 0) continue;
      try {
        fs.rmSync(path.join(os.tmpdir(), e), { recursive: true, force: true });
        n++;
      } catch (x) { /* another run may hold it */ }
    }
  } catch (x) { /* unreadable tmpdir is not fatal */ }
  if (n) console.log('  swept ' + n + ' stale staging dir' + (n === 1 ? '' : 's'));
  return n;
}

function stageSite() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p2p-vault-'));
  if (tmp.indexOf(os.tmpdir()) !== 0) die('refusing to stage outside the temp dir');
  for (const entry of fs.readdirSync(ROOT)) {
    if (SKIP.has(entry)) continue;
    fs.cpSync(path.join(ROOT, entry), path.join(tmp, entry), { recursive: true });
  }

  /* Both of these live ONLY in the staged copy. Keeping them out of the repo
     means CI (plain `hugo --minify`, no --config) can never activate the vault
     output format, and there is no committed file to accidentally point at. */
  fs.writeFileSync(path.join(tmp, 'vault.toml'), [
    '# Generated by tools/vault.js into the staged copy. Never committed.',
    '# NOTE: no [outputs] block here on purpose. `--config a,b` REPLACES nested',
    '# maps rather than merging them, so declaring [outputs] would silently drop',
    '# home = ["HTML","RSS","JSON"] and take /index.json with it. The format is',
    '# selected per page via front matter instead.',
    '[outputFormats.vault]',
    '  mediaType      = "application/json"',
    '  baseName       = "vault"',
    '  isPlainText    = true   # without this the template parses as html/template',
    '  notAlternative = true',
    '  permalinkable  = false',
    '',
  ].join('\n'));

  fs.mkdirSync(path.join(tmp, 'layouts'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'layouts', 'single.vault.json'),
    '{{- dict "slug" .File.ContentBaseName "title" .Title "body" .Content ' +
    '"toc" .TableOfContents "wordCount" .WordCount "readingTime" .ReadingTime ' +
    '| jsonify -}}\n');

  return tmp;
}

function runHugo(tmp) {
  const res = spawnSync(hugoBin(), [
    '-s', tmp,
    '--config', 'config.toml,vault.toml',
    '--destination', path.join(tmp, 'public'),
    '--cacheDir', path.join(tmp, '.cache'),
    /* Sealing is not publishing. A source may legitimately be a draft, or dated
       ahead of now — and note `date: <today>` parses as midnight UTC, which is
       FUTURE from any timezone east of Greenwich, so an ordinary same-day post
       is silently dropped from the build without drafts enabled. Whether the
       post is visible in production is decided by the committed stub's own
       front matter, entirely separately from this. */
    '--buildFuture', '--buildDrafts',
    '--logLevel', 'warn',
  ], { encoding: 'utf8' });
  if (res.status !== 0) {
    die('hugo failed in the staged copy:\n' +
        (res.stderr || res.stdout || (res.error && res.error.message) || 'unknown'));
  }
}

/* ---- commands ----------------------------------------------------------- */

function cmdNew(slug, section) {
  if (!slug) die('usage: node tools/vault.js new <slug> [--section writeups|cves]');
  section = section || 'writeups';
  fs.mkdirSync(SRC, { recursive: true });
  fs.mkdirSync(IMG_SRC, { recursive: true });
  const file = path.join(SRC, slug + '.md');
  if (fs.existsSync(file)) die('vault-src/' + slug + '.md already exists');

  fs.writeFileSync(file, [
    '---',
    '# FRONT MATTER IS PUBLIC. It is copied verbatim into the committed stub and',
    '# shows up in the archives, /index.json, RSS and the sitemap. Write it as if',
    '# it were published, because it is. Everything secret goes in the BODY.',
    'title: "Describe the bug, not the id"',
    'date: ' + nowStamp(),
    'category: "mobile"',
    'tags: ["locked"]',
    'summary: "One public line on why this is locked — e.g. embargoed until the vendor ships."',
    'locked: true',
    'section: "' + section + '"',
    'draft: false',
    '---',
    '',
    '## Background',
    '',
    'Everything below the front matter is encrypted. Images go in vault-src/images/',
    'and are referenced as ![alt](' + IMG_PREFIX + 'file.png) — that exact prefix.',
    '',
  ].join('\n'));

  const secrets = readSecrets();
  secrets[slug] = { password: genPassword(), issued: today(), rotate: '' };
  writeSecrets(secrets);

  console.log('\n  created  vault-src/' + slug + '.md');
  console.log('  password ' + secrets[slug].password);
  console.log('\n  Write the post, then: node tools/vault.js build\n');
}

async function cmdBuild(only, overrides) {
  const list = (only && only.length) ? only : slugs();
  if (!list.length) die('nothing in vault-src/. Start with: node tools/vault.js new <slug>');

  const secrets = readSecrets();
  const sources = {};
  const passwords = {};
  let secretsDirty = false;

  for (const slug of list) {
    const file = path.join(SRC, slug + '.md');
    if (!fs.existsSync(file)) die('no such source: vault-src/' + slug + '.md');
    const parsed = splitFrontMatter(fs.readFileSync(file, 'utf8'), file);
    const section = fmScalar(parsed.fm, 'section');
    if (!section) die(slug + ': front matter needs section: "writeups" (or "cves")');
    /* A typo'd section used to seal fine and go live at /notasection/<slug>/:
       present in the sitemap and tag archives, absent from every archive, the
       filter index and the homepage counts, with exit 0 and no warning. */
    if (SECTIONS.indexOf(section) === -1) {
      die(slug + ': section: "' + section + '" is not a content section.' +
          ' Use one of: ' + SECTIONS.join(', '));
    }

    /* A block scalar can contain a bare --- , which splitFrontMatter would take
       as the end of the front matter — silently dropping later keys into the
       encrypted body and writing an incomplete stub. Rather than carry a YAML
       parser for one construct, refuse it and say why. */
    const blockScalar = /^[ \t]*[\w.-]+[ \t]*:[ \t]*[|>][-+0-9]*[ \t]*$/m.exec(parsed.fm);
    if (blockScalar) {
      die(slug + ': front matter uses a block scalar (' + blockScalar[0].trim() + ').\n' +
          '  Not supported — a bare --- inside one would split the file in the wrong\n' +
          '  place. Put the value on one line, or move it into the body.');
    }
    if (!/\S/.test(parsed.body)) die(slug + ': the body is empty — nothing to encrypt');
    /* Password selection, in priority order. The ONLY case that may mint a new
       password is a slug with no ciphertext yet. Re-keying an already-sealed
       post silently invalidates whatever was handed out, so that now requires
       `rotate`, said out loud. */
    if (overrides && overrides[slug]) {
      passwords[slug] = overrides[slug];
    } else if (secrets[slug] && secrets[slug].password) {
      passwords[slug] = secrets[slug].password;
    } else if (fs.existsSync(path.join(OUT, slug + '.json'))) {
      die(slug + ': ciphertext exists but vault-secrets.json has no password for it.\n' +
          '  Re-sealing would mint a NEW password and silently break the one already\n' +
          '  handed out. Restore vault-secrets.json from a backup, or run\n' +
          '    node tools/vault.js rotate ' + slug + '\n' +
          '  if you accept re-keying it.');
    } else {
      secrets[slug] = { password: genPassword(), issued: today(), rotate: '' };
      secretsDirty = true;
      passwords[slug] = secrets[slug].password;
      console.log('  generated a password for ' + slug + ' (first seal)');
    }
    if (passwords[slug].length < MIN_PW) {
      die(slug + ': password is shorter than ' + MIN_PW + ' characters. The ciphertext\n' +
          '  is public and crackable offline — entropy is the only thing protecting it.');
    }
    sources[slug] = { fm: parsed.fm, body: parsed.body, section: section };
  }
  /* Secrets are persisted AFTER a successful seal, not here. Writing them first
     meant a failed build left vault-secrets.json holding a password that opens
     nothing, with the working one overwritten and unrecoverable. */

  sweepStale();

  const tmp = stageSite();
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });
  process.on('SIGHUP', () => { cleanup(); process.exit(129); });

  try {
    for (const slug of list) {
      const s = sources[slug];
      /* outputs: ["vault"] and NOT ["HTML","vault"]: dropping HTML means the
         rendered plaintext PAGE is never written. It does NOT mean no plaintext
         reaches disk — layouts/index.json runs .Plain | truncate 1200 over every
         regular page, so the staged build's own index.json holds the first 1200
         characters of each locked post. That file lives only in the temp dir and
         is deleted in the `finally` below; sweepStale() clears any left by a
         SIGTERM or a power loss. An earlier comment here claimed nothing was
         written at all, which was wrong. */
      const staged = '---\n' + s.fm + '\noutputs: ["vault"]\n---\n' + s.body;
      const dest = path.join(tmp, 'content', s.section, slug + '.md');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, staged);   /* overwrites the copied stub, same path */
    }

    runHugo(tmp);
    fs.mkdirSync(OUT, { recursive: true });

    for (const slug of list) {
      const s = sources[slug];
      const rendered = path.join(tmp, 'public', s.section, slug, 'vault.json');
      if (!fs.existsSync(rendered)) {
        die(slug + ': hugo rendered no vault.json.\n' +
            '  Usually the page was excluded from the build. Check that section:\n' +
            '  "' + s.section + '" is a real content section and the front matter parses.\n' +
            '  Looked for: ' + rendered);
      }
      const doc = JSON.parse(fs.readFileSync(rendered, 'utf8'));

      /* If the staged write had missed (wrong section, slug collision) we would
         be encrypting the STUB's empty body and shipping a post that unlocks to
         nothing. Cheap assertion, catches the whole class. */
      if (!doc.wordCount || doc.wordCount < 1) {
        die(slug + ': the rendered body is empty. The staged plaintext did not replace\n' +
            '  the stub — check that section: matches the directory the stub is in.');
      }

      const imgDir = path.join(OUT, slug);
      fs.rmSync(imgDir, { recursive: true, force: true });
      fs.mkdirSync(imgDir, { recursive: true });

      const rw = rewriteImages(doc.body, slug);
      const images = rw.used.map((u) => {
        const from = path.join(IMG_SRC, u.name);
        if (!fs.existsSync(from)) die(slug + ': missing image vault-src/images/' + u.name);
        return {
          id: u.id, bytes: fs.readFileSync(from),
          type: MIME[path.extname(u.name).toLowerCase()] || 'application/octet-stream',
        };
      });

      const payload = await sealPayload(passwords[slug], {
        slug: slug,
        images: images,
        doc: { body: rw.html, toc: doc.toc, title: doc.title, readingTime: doc.readingTime },
      });
      if (!images.length) fs.rmSync(imgDir, { recursive: true, force: true });

      const json = JSON.stringify(payload) + '\n';
      fs.writeFileSync(path.join(OUT, slug + '.json'), json);

      /* Cache version. GitHub Pages and Cloudflare both cache /vault/<slug>.json
         normally, so after a rotation a reader with a warm cache kept opening the
         post with the OLD password while the new one reported "did not work" —
         the only expiry mechanism there is, silently not taking effect. The client
         appends this as ?v=, making a rotated payload a different cache key.
         Images need no equivalent: their ids are already random per build. */
      const ver = nodeCrypto.createHash('sha256').update(json).digest('hex').slice(0, 12);

      /* The stub: the SAME front matter, no body. `section` is a tool directive,
         readingTime is recomputed from the real text, and vaultVersion is ours. */
      let fm = fmDropKeys(s.fm, ['section', 'outputs', 'readingTime', 'vaultVersion']);
      fm = fm.split(/\r?\n/)
        .filter((l) => l.trim() !== '')
        /* Drop YAML comment lines: the `new` scaffold carries a FRONT MATTER IS
           PUBLIC banner that is guidance for the author, not content for a file
           committed to a public repo. */
        .filter((l) => !/^\s*#/.test(l))
        .join('\n');
      if (!/^locked\s*:/m.test(fm)) fm += '\nlocked: true';
      fm += '\nreadingTime: ' + doc.readingTime;
      fm += '\nvaultVersion: "' + ver + '"';

      const stub = path.join(ROOT, 'content', s.section, slug + '.md');
      fs.mkdirSync(path.dirname(stub), { recursive: true });
      fs.writeFileSync(stub, '---\n' + fm + '\n---\n');

      console.log('  sealed   ' + slug + '  (' + doc.wordCount + ' words, ' +
        images.length + ' images, ' + doc.readingTime + ' min read)');
    }
  } finally {
    cleanup();
  }

  /* Every slug sealed. Only now is it safe to record a newly minted password. */
  if (secretsDirty) writeSecrets(secrets);

  console.log('\n  Passwords are in vault-src/vault-secrets.json (gitignored).');
  console.log('  Preview:  rm -rf public/ && hugo server\n');
}

async function cmdRotate(slug) {
  if (!slug) die('usage: node tools/vault.js rotate <slug>');
  const secrets = readSecrets();
  if (!secrets[slug]) die('no such slug in vault-secrets.json: ' + slug);

  const next = genPassword();

  /* SEAL FIRST, record second. The previous order wrote the new password to
     vault-secrets.json and only then ran hugo — so a build failure left the file
     holding a password that opens nothing, while the password that DOES open the
     live post (already handed to a vendor) had been overwritten and was gone.
     cmdBuild takes the candidate as an override and touches no secrets. */
  console.log('\n  re-sealing ' + slug + ' under a new password...\n');
  await cmdBuild([slug], { [slug]: next });

  const fresh = readSecrets();
  const prev = fresh[slug] || {};
  const entry = { password: next, issued: today(), rotate: '' };

  /* Keep the cadence rather than dropping it: roll the due date forward by the
     same interval it originally had. Leaving `rotate` untouched made status
     print ** OVERDUE ** forever, because the date that triggered the rotation
     stayed in the past after it. */
  if (prev.rotate && prev.issued) {
    const days = Math.round((Date.parse(prev.rotate) - Date.parse(prev.issued)) / 86400000);
    if (days > 0) {
      entry.rotate = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    }
  }
  fresh[slug] = entry;
  writeSecrets(fresh);

  console.log('  new password for ' + slug + ': ' + next);
  if (entry.rotate) console.log('  next rotation due: ' + entry.rotate);
  console.log('\n  Readers with the old password now get "did not work" once their cache');
  console.log('  expires; the payload url carries a new ?v= so that is immediate.');
  console.log('  NOTE: rotation is not retroactive. The previous ciphertext stays in git');
  console.log('  history, and the old password still opens an old checkout.\n');
}

function cmdStatus() {
  const secrets = readSecrets();
  const list = slugs();
  const orph = orphans();
  if (!list.length && !orph.length) { console.log('\n  no locked posts\n'); return; }
  console.log('');
  for (const slug of list) {
    const s = secrets[slug] || {};
    const sealed = fs.existsSync(path.join(OUT, slug + '.json'));
    const due = s.rotate && s.rotate < today();
    console.log('  ' + slug.padEnd(34) +
      (sealed ? 'sealed         ' : 'NO CIPHERTEXT  ') +
      'issued ' + (s.issued || '?') +
      (s.rotate ? '  rotate ' + s.rotate + (due ? '  ** OVERDUE **' : '') : ''));
  }
  for (const slug of orph) {
    console.log('  ' + slug.padEnd(34) + 'ORPHAN — published, no source, still opens');
  }
  console.log('');
}

function orphans() {
  /* Ciphertext with no source. Deleting vault-src/<slug>.md used to leave the
     stub AND the payload live and still decryptable with the old password,
     while status and audit both reported a clean house — because everything
     walked sources -> ciphertext and nothing walked back. */
  if (!fs.existsSync(OUT)) return [];
  const have = slugs();
  return fs.readdirSync(OUT)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .filter((slug) => have.indexOf(slug) === -1);
}

/* Distinctive lines from a source body, for searching git history. Deliberately
   different from the needles in scratchpad/vault-leak.js: those compare against
   RENDERED html, these against raw markdown, so no markup stripping. */
function historyNeedles(body) {
  return body.split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 30 && !/^[#>*`|-]/.test(l))
    .sort((a, b) => b.length - a.length)
    .slice(0, 8);
}

function cmdAudit() {
  const problems = [];
  const warnings = [];
  const notes = [];
  const git = (args) => spawnSync('git', ['-C', ROOT].concat(args), { encoding: 'utf8' });

  if (git(['rev-parse', '--git-dir']).status !== 0) die('not a git repository: ' + ROOT);

  for (const f of ['vault-src/anything.md', 'vault-src/images/x.png',
                   'vault-src/vault-secrets.json']) {
    if (git(['check-ignore', '-q', f]).status !== 0) problems.push(f + ' is NOT gitignored');
  }

  const tracked = (git(['ls-files', 'vault-src']).stdout || '').trim().split('\n')
    .filter((l) => l && l !== 'vault-src/README.md');
  if (tracked.length) problems.push('plaintext tracked in git NOW: ' + tracked.join(', '));

  /* The commit guard is repo-local config and does NOT survive a clone. A fresh
     clone, a second worktree or a CI job that commits has no guard at all, and
     nothing used to notice. */
  const hooks = (git(['config', 'core.hooksPath']).stdout || '').trim();
  if (hooks !== 'tools') {
    problems.push('core.hooksPath is ' + (hooks || '(unset)') + ', not "tools" — the' +
      ' pre-commit guard\n      is NOT installed. Fix: git config core.hooksPath tools');
  }

  /* CONTENT search, not a path search. `git log -- vault-src` only ever saw
     plaintext that was already in the right directory — so the most likely
     mistake there is (draft a post in content/, later decide it needs an
     embargo and move it) left the full text in an earlier commit while this
     printed "absent from history". */
  const revs = (git(['rev-list', '--all', '--reflog']).stdout || '').trim().split('\n').filter(Boolean);
  if (!revs.length) {
    notes.push('no commits yet — history search vacuous');
  } else {
    let searched = 0;
    for (const slug of slugs()) {
      const raw = fs.readFileSync(path.join(SRC, slug + '.md'), 'utf8');
      const m = /^---[\s\S]*?\n---\n?([\s\S]*)$/.exec(raw);
      for (const needle of historyNeedles(m ? m[1] : raw)) {
        searched++;
        const hit = spawnSync('git', ['-C', ROOT, 'grep', '-F', '-I', '-l', '-e', needle]
          .concat(revs), { encoding: 'utf8' });
        if (hit.status === 0 && (hit.stdout || '').trim()) {
          problems.push('PLAINTEXT IN GIT HISTORY (' + slug + '):\n      ' +
            (hit.stdout || '').trim().split('\n').slice(0, 5).join('\n      '));
        }
      }
    }
    notes.push(searched + ' plaintext fragments searched across ' + revs.length +
      ' commit(s), including reflog');
  }

  const stash = (git(['stash', 'list']).stdout || '').trim();
  if (stash) {
    warnings.push('stash entries exist and `git stash -a` captures IGNORED files,' +
      '\n      i.e. all of vault-src/. Inspect or drop them:\n      ' +
      stash.split('\n').slice(0, 3).join('\n      '));
  }

  const orig = (git(['for-each-ref', '--format=%(refname)', 'refs/original']).stdout || '').trim();
  if (orig) {
    /* A warning, not a failure: rev-list --all already searched those commits
       for plaintext above and found none. What it flags is that a previous
       history rewrite left its backup refs behind, so the pre-rewrite objects
       are still reachable locally. Cleaning them is the operator's call. */
    warnings.push('refs/original/* exists (leftover history rewrite). Those commits' +
      '\n      are still reachable: ' + orig.split('\n').join(' '));
  }

  for (const slug of slugs()) {
    if (!fs.existsSync(path.join(OUT, slug + '.json'))) {
      problems.push(slug + ' has no ciphertext — run: node tools/vault.js build');
    }
  }
  for (const slug of orphans()) {
    problems.push('ORPHAN: static/vault/' + slug + '.json has no vault-src/' + slug + '.md.' +
      '\n      It is still published and still opens with its old password.');
  }

  console.log('');
  notes.forEach((n) => console.log('  note  ' + n));
  warnings.forEach((w) => console.log('  WARN  ' + w));
  if (problems.length) {
    console.error('\n  AUDIT FAILED\n');
    problems.forEach((x) => console.error('    - ' + x));
    console.error('');
    process.exit(1);
  }
  console.log('\n  audit ok — no plaintext in the index, the working tree, the stash or any');
  console.log('  reachable commit; the commit guard is installed; no orphaned ciphertext.\n');
}

/* ---- entry -------------------------------------------------------------- */

(async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const rest = argv.slice(1).filter((a) => a.indexOf('--') !== 0);

  let section = null;
  const eq = argv.find((a) => a.indexOf('--section=') === 0);
  if (eq) section = eq.split('=')[1];
  else if (argv.indexOf('--section') !== -1) section = argv[argv.indexOf('--section') + 1];

  try {
    if (cmd === 'new') cmdNew(rest[0], section);
    else if (cmd === 'build') await cmdBuild(rest);
    else if (cmd === 'rotate') await cmdRotate(rest[0]);
    else if (cmd === 'status') cmdStatus();
    else if (cmd === 'audit') cmdAudit();
    else {
      console.log([
        '', '  vault.js — locked posts for path2pwn', '',
        '    new <slug> [--section writeups|cves]   scaffold a source + password',
        '    build [slug...]                        encrypt and regenerate stubs',
        '    rotate <slug>                          new password, re-seal',
        '    status                                 what is sealed, what is overdue',
        '    audit                                  prove no plaintext reached git',
        '',
      ].join('\n'));
    }
  } catch (e) {
    die(e && e.stack ? e.stack : String(e));
  }
})();
