# /path/to/pwn

Technical writeups and CVE deep-dives by Carlo Jae Avila (**blackb3ard**) — mobile security research, CTF writeups, and vulnerability disclosures. Live at [path2pwn.carlojaeavila.dev](https://path2pwn.carlojaeavila.dev).

Sister site (main portfolio/landing page): [carlojaeavila.dev](https://carlojaeavila.dev) ([repo](https://github.com/blackbeard666/landing-site)).

## What this is

- **CVEs** (`/cves/`) — full technical deep-dives on disclosed vulnerabilities: background, root cause analysis with the actual vulnerable source (fetched from the real commit, never paraphrased from memory), a working proof of concept, impact, and patch analysis.
- **Writeups** (`/writeups/`) — CTF writeups and general technical write-ups spanning binary exploitation, Android reverse engineering, and web.
- **Tags** (`/tags/`) — a two-tier system: one `category` per post (e.g. `mobile`, `web`, `re`) plus free-form `tags`; the tag index is sorted by post count, most-used first.

## Architecture

Built with [Hugo](https://gohugo.io) and a fully custom theme — no third-party theme, no JS framework:

```
config.toml              Site config — baseURL, pagination size, markup options
content/
  cves/                   One .md file per CVE writeup
  writeups/               One .md file per general writeup
themes/carlo/
  layouts/
    _default/             baseof.html, list.html, single.html, taxonomy.html, terms.html
    partials/             header, footer, head, pagination, etc.
  static/
    css/main.css           All styling — same design-token approach as the landing site
    js/toc.js               Scroll-spy for the sticky table-of-contents sidebar
```

### Design

Shares its visual language with the landing site — same dark palette, JetBrains Mono, terminal-style `// section` labels — so the two sites read as one consistent brand despite being unrelated codebases under the hood (plain HTML vs. Hugo).

Notable implementation details:

- **Sticky footer** — `body` is a flex column with `min-height: 100vh`; `.site-main { flex: 1 }` pushes the footer to the bottom of the viewport on short pages instead of leaving a gap beneath it.
- **Pagination** — page size is set once in `config.toml`'s `[pagination]` table (`pagerSize`), not the legacy top-level `paginate` key, which current Hugo versions silently ignore. List and taxonomy pages share one `pagination.html` partial for prev/next navigation.
- **Homepage teasers** — the homepage can't paginate two independent collections (CVEs + writeups) on a single page — Hugo only supports one `.Paginate` call per page — so instead it shows the first 8 of each with a "view all →" link into the fully paginated `/cves/` or `/writeups/` list.

## Deployment

**GitHub Actions** builds and deploys on every push to `main` (`.github/workflows/deploy.yml`):

1. Installs Hugo (extended) via `peaceiris/actions-hugo`
2. Runs `hugo --minify`
3. Uploads `public/` (the build output) as the Pages artifact — **`public/` is never committed**, it's gitignored and rebuilt fresh in CI every time.

**DNS/domain** via **Cloudflare**:

- `path2pwn.carlojaeavila.dev` → `CNAME path2pwn → blackbeard666.github.io`, proxied.
- Custom domain registered under this repo's **Settings → Pages → Custom domain**, HTTPS enforced.
- The workflow's `configure-pages` step sets `enablement: true` — without it, the very first deploy on a brand-new repo can fail (`Error: Get Pages site failed`), since the Pages "site" object isn't reliably created just by selecting "GitHub Actions" in the Settings UI.

## Local development

```powershell
hugo server
```

Visit `http://localhost:1313` — Hugo live-reloads on save.

## Adding content

New writeups go in `content/writeups/slug.md`, new CVE deep-dives in `content/cves/cve-YYYY-NNNNN.md` — both are plain Markdown with YAML frontmatter (`title`, `date`, `category`, `tags`, `description`, `draft`). Set `draft: false` to publish.
