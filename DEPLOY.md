# Deploy

The game is a static site: `npm run build` writes everything to `dist/`.
Asset URLs are relative (`base: "./"` in `vite.config.ts`), so the same
`dist/` works at a domain root, under a sub-path, or opened from a zip.

## GitHub Pages (automated)

`.github/workflows/deploy.yml` builds, tests and publishes `dist/` on every
push to `main` (or on demand: Actions → Deploy → Run workflow).

One-time setup, by a repo admin:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. Push to (or merge into) `main`. The site appears at
   `https://<owner>.github.io/rc-racer/` — for this repo,
   <https://maccracken.github.io/rc-racer/>.

Until step 1 is done the workflow's deploy job fails with "Pages not
enabled"; CI and the game are unaffected.

## Other static hosts

- **Netlify / Vercel / Cloudflare Pages:** build command `npm run build`,
  publish directory `dist`. No redirects or server config needed.
- **Anywhere else:** upload the contents of `dist/`.

## Checking a build locally

```bash
npm run build
npm run preview    # serves dist/ at http://localhost:4173
```

## First-run video

- 60 seconds max, recorded at 1080p60 from a real browser (not headless).
- Show: How to Play → menu → countdown → a lap chasing the ghost → results
  (itemised credits) → garage upgrade → a faster lap.

## Checklist

- [x] Production build passes (CI: typecheck, lint, format, tests, build)
- [x] Deploy workflow in place (`.github/workflows/deploy.yml`)
- [ ] Pages enabled in repo settings (Source: GitHub Actions)
- [ ] Public URL live and linked from the README
- [ ] Video recorded and linked
