# vault-src — plaintext for locked posts

**Everything in this directory except this file is gitignored and must stay that
way.** `tools/pre-commit` blocks a commit that stages any of it. This repo is
public; a commit here cannot be taken back.

```
vault-src/
├── README.md              the only committed file
├── vault-secrets.json     the passwords          — NEVER COMMIT
├── images/                screenshots            — NEVER COMMIT
└── <slug>.md              the real writeups      — NEVER COMMIT
```

## The rule that governs the whole design

**Front matter is public. The body is secret.**

`tools/vault.js` copies a source's front matter *verbatim* into a committed stub
at `content/<section>/<slug>.md` and throws the body away. So the title, date,
tags, category and `summary` you write here are published — they appear in the
archives, in `/index.json`, in RSS and in the sitemap. Write them as if they were
public, because they are. Anything that must stay hidden goes in the **body**,
including vendor names, timelines and patch links.

Nothing in the public build is ever derived from the plaintext, so there is no
filter to remember and no way to half-forget one.

## Workflow

```bash
node tools/vault.js new my-slug --section writeups   # scaffold + generate a password
#   ...write the post...
node tools/vault.js build                            # encrypt, regenerate the stub
rm -rf public/ && hugo server                        # preview (public/ is stale and lies)
node tools/vault.js audit                            # prove nothing leaked
```

Images: drop them in `vault-src/images/` and reference them as
`![alt](/vault-img/file.png)` — that exact prefix, no other form. They are
encrypted individually into `static/vault/<slug>/`, so they are never served in
the clear. A relative path (`![](x.png)`) is *not* resolved by Hugo and the build
will abort rather than ship a broken or leaking reference.

## What this protects against, and what it does not

The ciphertext is AES-256-GCM under a key derived with PBKDF2-SHA256 at 600k
iterations. That stops search engines, scrapers, casual browsing and anyone
without the password.

**Passwords are generated, never chosen.** The ciphertext is committed to a
public repo and is therefore crackable offline at leisure — iterations only buy
time, entropy is the thing that actually holds. `build` refuses anything under
16 characters.

Three limits, stated plainly because they are properties of the design rather
than bugs in it:

1. **Anyone who had the password can keep a copy.** No design here changes that.
2. **There is no per-person revocation.** One password per post, so revoking one
   reader means reissuing to everyone. (The payload format is an envelope — a
   random content key wrapped by the password-derived key — so per-recipient
   keys can be added later without re-encrypting anything.)
3. **Rotation is not retroactive.** `rotate` stops the old password working on
   the *live site*, because the ciphertext it matched no longer exists there. But
   the previous ciphertext stays in this repo's **git history**, and the old
   password still opens an old checkout. Expiry means "no new access", not
   "access withdrawn".

Because of (3), this is for embargoed personal research, lab and CTF content, and
early drafts. **It is not for client or NDA material** — that needs an edge gate
that checks a token server-side before releasing any bytes, which is a different
project. See `CLAUDE.md` → *Locked posts*.
