# ST Tracker — landing page

Static, zero-dependency, no build step. Three files plus icons. Deploy the folder as-is.

Intended host: **https://gsrtc.shivrajsinh.in** — that hostname is baked into `canonical`,
`hreflang`, the Open Graph tags, `robots.txt` and `sitemap.xml`. **If you host it anywhere else,
change it in those five places or the SEO works against you**: a canonical pointing at a domain
you do not serve tells Google to index the wrong URL.

## It shares the app's design tokens

`:root` in `styles.css` is a copy of the app's palette from `web/styles.css` — same navy
(`#1b3c77`), same surfaces, same ink, same radii, same font stack, same background wash, and the
same dark palette. Verified token-for-token: 29 shared light tokens and 23 dark, none differing.
There are no hard-coded colours anywhere below the token block.

**If the app's palette changes, copy it here too.** A marketing page in different colours from
the product it is selling reads as a different product.

## Why it is built the way it is

- **The Gujarati edition has its own URL** (`?lang=gu`). Language held only in `localStorage` is
  invisible to a crawler, so half the content would never be indexed and a link could not be
  shared in the language it was read in. `<html lang>`, `<title>` and the meta description all
  follow the switch.
- **Structured data**: `WebApplication`, `FAQPage` and `WebSite` blocks. The FAQ block is what
  Google lifts into rich results, which is most of the ranking value on the page.
- **The app screens are real captures of the live app**, taken by `node scripts/shoot.mjs`.
  Each is shot twice, light and dark, and the page serves whichever matches the reader — the
  `<source media>` handles the system preference with no JavaScript, and `applyTheme` rewrites
  the `srcset` when the toggle is used. Inside a `<picture>` a matching `<source>` always beats
  the `<img src>`, so rewriting the img alone does nothing; that is the bug this note exists to
  stop being reintroduced.
  WebP only, at 560x1204 — the PNGs were 1.5MB for the set and WebP is 216KB, of which one
  theme's ~108KB is ever fetched. **Re-run the script whenever the app's look changes**; that is
  the standing cost of using photographs of software rather than drawings of it.
- **Reveal animations only hide content once JavaScript has run** (`.js .reveal`). A page that
  hides its own text when a script fails is worse than a page with no animation.
- **Theme has three states**, not two: auto, light, dark. Someone who has never chosen should
  follow their phone at dusk; someone who has chosen should be obeyed.

## Releasing a change

`styles.css` and `app.js` carry a `?v=` stamp in `index.html`. **Bump it when you change
either**, or a visitor with the old file cached gets new markup against an old stylesheet —
which is exactly how the theme-swap looked broken while it was in fact fixed.

## Deploy

Any static host. Vercel, Netlify and Cloudflare Pages all serve this directory unchanged;
`_headers` is read by Netlify and Cloudflare Pages.

    npx vercel deploy --prod        # or drag the folder into Netlify

After the DNS is live, submit `https://gsrtc.shivrajsinh.in/sitemap.xml` in Google Search
Console — the sitemap declares both language URLs and pairs them with hreflang.

## Checked

No console errors, no horizontal overflow, all reveals fire, counters animate, both themes,
both languages, and the language switch round-trips losslessly back to English.
