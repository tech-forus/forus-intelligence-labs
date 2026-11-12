# Forus Intelligence Labs — website

Marketing site for **Forus Intelligence Labs**, the parent studio behind
[FreightCompare](https://freightcompare.ai) and [ForusBiz](https://forusbiz.ai).

Live at **https://forusintelligencelabs.com**

---

## What this is

A static site (no build step, no framework) plus one small API for careers.

```
.
├── index.html                 # home page
├── careers/index.html         # /careers: openings + application form
├── admin/index.html           # /admin: applications dashboard (noindex, password)
├── assets/
│   ├── site.css / site.js     # shared styles and nav/drawer/reveal script
│   ├── favicon.svg, og.svg, og.png
├── netlify/
│   ├── functions/careers.mjs  # /api/careers/* (Netlify Function)
│   └── lib/                   # handlers, scoring, file checks, auth (unit tested)
├── tests/careers.test.mjs     # npm test
├── scripts/dev-server.mjs     # local preview with a working API (in-memory)
├── scripts/hash-password.mjs  # make a new admin password hash
├── netlify.toml, robots.txt, sitemap.xml, CNAME
```

## Careers system

- **Apply** (`/careers`): role, contact, education, experience, skills, domains, links,
  "what you have built", resume (PDF/DOC/DOCX, max 4 MB). The file type is checked from
  its bytes, not its name. Honeypot field + 5 applications/hour per IP.
- **Storage**: Netlify Blobs, store `careers` (`app/<id>` JSON, `resume/<id>` file).
  Nothing goes to the FreightCompare backend or its MongoDB.
- **Scoring** (`netlify/lib/scoring.mjs`): every application gets three 0-100 fit scores,
  each with the signals that produced it, from the form answers plus resume text:
  - *FreightCompare*: MERN + logistics/freight/supply chain (top priority)
  - *ForusBiz*: MERN + ERP/accounting/inventory/GST
  - *Hardware*: PCB, embedded, power/BMS, CAD/fab, plus proof of real builds
  Branch criteria: software = CSE/IT/EEE, hardware = EEE/ECE. Other branches can still
  apply and are flagged, not blocked.
- **Admin** (`/admin`, user `tech`): tabs per track ranked by score, filters (branch,
  experience, min score, status, tags, starred, full-text incl. resume), detail panel,
  status + notes, resume viewer, CSV export, delete. Sessions are random tokens in the
  blob store (12 h). The repo is public, so only an scrypt hash of the password is here.
  **Rotate:** `node scripts/hash-password.mjs "<new>"` and set the output as
  `ADMIN_PASSWORD_HASH` in Netlify → Site configuration → Environment variables.

## Local preview

```bash
npm install
npm test                       # API + scoring tests
node scripts/dev-server.mjs    # http://localhost:8787 (site + careers API, in-memory)
```

## Deploying

Hosted on **Netlify** (the domain's A record points at Netlify). Netlify must build from
this GitHub repo so the function in `netlify/functions` is deployed with the site;
a drag-and-drop deploy ships the static pages only and the careers form will not work.
Publish directory is the repo root; `netlify.toml` has the rest.

## Content sourcing

Copy for both ventures was derived from the **live production applications**
(`freightcompare.ai` and `forusbiz.ai`) — their route maps, feature surfaces and
in-product strings — not from marketing material.

Deliberate choices worth knowing about:

- **No invented metrics.** There are no fabricated customer counts, shipment volumes,
  testimonials or logo walls anywhere on the page. The four hero figures are all
  verifiable: 2 live platforms, 5 ForusBiz business modules, 8 FreightCompare
  verticals, pan-India pincode routing.
- **FreightCompare is labelled `Public beta`**, matching the beta notice the product
  itself displays in production.
- **ForusBiz is presented as a full ERP suite** (sales → purchase → inventory →
  manufacturing → accounting). Its own site is currently titled *"Inventory Management
  System"*, which materially undersells the shipped application; the route map and
  module set were treated as the primary source.

## Editing notes

- **Colours** live in the `:root` block at the top of `assets/site.css`. The parent identity is
  intentionally neutral graphite; each venture carries its own accent
  (`--fc` blue + amber, `--fb` violet + pink), sampled from the live products.
- **Adding a third venture:** copy an `<article class="vcard">` block, give it a new
  modifier class, and define `--glow` plus `.rule` gradient stops for it.
- **Animation** respects `prefers-reduced-motion`, and hover effects are disabled
  under `@media (hover: none)` so nothing sticks on a touchscreen.
- **Phone layout** lives in the `PHONE` block of `assets/site.css`. Breakpoints are
  900px (nav drawer takes over), 760px (single column, full-width buttons), 520px and
  400px. Safe-area insets are handled for notched devices via `env(safe-area-inset-*)`.

### Verified on device

Checked under real mobile viewport emulation (Chrome DevTools Protocol, touch enabled)
at iPhone SE 375, iPhone 14 Pro 393, Pixel 7 412, Galaxy S8 360 and a 320px Android:

- no horizontal scroll and no element crossing the viewport edge at any width
- burger is a 44x44 target; drawer links are 54px tall; footer links are 44px
- drawer opens flush under the sticky header, dims the page behind it, locks body
  scroll, and closes on link tap, scrim tap, `Escape`, or resize past 900px
- every `auto-fit` grid divides its item count evenly, so no orphan cells appear

## Known follow-ups

- [ ] Point DNS at the host (see *Deploying*).
- [ ] Optional: self-host the two Google Fonts to drop the third-party request.
- [ ] Optional: add real customer proof once there is some to publish.

## Social preview

`og:image` points at `assets/og.png` (1200x630). Social platforms do not render SVG
previews, so the PNG is the one that matters. To regenerate it after editing
`assets/og.svg`:

```bash
chrome --headless=new --window-size=1200,630 --force-device-scale-factor=1        --screenshot=assets/og.png og-wrapper.html
```

where `og-wrapper.html` is a minimal page that loads the Inter webfont and inlines the
SVG — otherwise the text falls back to a system font and the render drifts from the site.

## Contact

tech@foruselectric.com
