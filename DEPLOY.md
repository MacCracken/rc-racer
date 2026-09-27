# Deploy

The game is a static site: `npm run build` writes everything to `dist/`.
Asset URLs are relative (`base: "./"` in `vite.config.ts`), so the same
`dist/` works at a domain root, under a sub-path, or opened from a zip. No
server code, redirects or environment variables are needed.

There is no automated deploy; CI only checks. Where the demo lives is the
owner's call.

## Hosting options

- **itch.io:** zip the _contents_ of `dist/` (so `index.html` is at the top
  of the zip) and upload it as an HTML game with "This file will be played in
  the browser".
- **Netlify / Vercel / Cloudflare Pages:** build command `npm run build`,
  publish directory `dist`.
- **Anywhere else** (S3, a VPS, any static file server): upload the contents
  of `dist/`.

## Checking a build locally

```bash
npm run build
npm run preview    # serves dist/ at http://localhost:4173
npm run e2e        # builds, then the browser smoke tests (Playwright)
```

## First-run video

- 60 seconds max, recorded at 1080p60 from a real browser (not headless).
- Show: How to Play → menu → countdown → a lap chasing the ghost → results
  (itemised credits) → garage upgrade → a faster lap.
