# Forus Intelligence Labs — website

Marketing site for **Forus Intelligence Labs**, the parent studio behind
[FreightCompare](https://freightcompare.ai) and [ForusBiz](https://forusbiz.ai).

Live at **https://forusintelligencelabs.com**

---

## What this is

A single self-contained static page. No build step, no dependencies, no framework.
`index.html` holds the markup, the styles and ~30 lines of vanilla JS (sticky-nav state,
`IntersectionObserver` scroll reveal, current year). Open the file in a browser and it works.

```
.
├── index.html        # the entire site
├── assets/
│   ├── favicon.svg   # browser tab mark
│   └── og.svg        # social preview card
├── CNAME             # custom domain for GitHub Pages
├── .nojekyll         # skip Jekyll processing on Pages
└── README.md
```

## Local preview

```bash
python -m http.server 8000
# then open http://localhost:8000
```

Or just double-click `index.html` — there is nothing to compile.

## Deploying

### GitHub Pages
1. Push this repo to GitHub.
2. **Settings → Pages → Source:** `Deploy from a branch`, branch `main`, folder `/ (root)`.
3. **Settings → Pages → Custom domain:** `forusintelligencelabs.com` (the `CNAME` file already declares it).
4. At your DNS provider, point the apex `A` records at GitHub Pages:
   `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   and a `CNAME` for `www` → `<account>.github.io`.
5. Enable **Enforce HTTPS** once the certificate is issued.

> As of the last check, `forusintelligencelabs.com` had no DNS records resolving.
> Step 4 is what makes the site reachable.

### Anywhere else
Netlify, Vercel, Cloudflare Pages or S3 all work with zero configuration —
publish directory is the repo root.

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

- **Colours** live in the `:root` block at the top of `<style>`. The parent identity is
  intentionally neutral graphite; each venture carries its own accent
  (`--fc` blue + amber, `--fb` violet + pink), sampled from the live products.
- **Adding a third venture:** copy an `<article class="vcard">` block, give it a new
  modifier class, and define `--glow` plus `.rule` gradient stops for it.
- **Animation** respects `prefers-reduced-motion`, and hover effects are disabled
  under `@media (hover: none)` so nothing sticks on a touchscreen.
- **Phone layout** lives in the `PHONE` block at the end of `<style>`. Breakpoints are
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
- [ ] `og:image` is an SVG. Most social platforms (X, LinkedIn, WhatsApp) will not render
      SVG previews — export `assets/og.svg` to a 1200×630 PNG and update the two
      `og:image` / `twitter:image` tags.
- [ ] Optional: self-host the two Google Fonts to drop the third-party request.
- [ ] Optional: add real customer proof once there is some to publish.

## Contact

tech@foruselectric.com
