# RC Racer — Immediate Task List

Generated from `roadmap.md`. Phase 3 is done; Phase 4 is down to the items
that need a person; Phase 5 has started.

## Phase 3 — Content scale + polish ✅ DONE

- [x] Curved curbs, tyre smoke, finish confetti, minimap, ghost line — all
      confirmed in Chromium (screenshots + the Playwright suite)
- [x] WebAudio UI clicks, lap/finish chimes, countdown beeps
- [x] Engine pitch ~ RPM — continuous engine voice (pitch from speed, revs on
      the grid, per-class pitch) + tyre squeal from lateral slip
      (`core/Audio.ts`, `slipAmount` in `core/SkidMarks.ts`)
- [x] Onboarding — How to Play opens on first launch; covers podium/par/ghost
- [x] 6 tracks + 3 car classes, content QA guard, save migration, CI
- [→] Track visualizer / JSON import — moved to Phase 5

## Phase 4 — Feel tuning pass & release demo 🚧

### Tuning & Balance

- [ ] Drive every car on every track; tune `tuning.ts` knobs _(needs a human)_
- [ ] Fix one bad corner per track _(needs a human)_
- [x] No no-op upgrade (`Economy.test.ts`)
- [x] No unfair par — autopilot laps every track within [0.7x, 1.6x] par
- [x] Par bonus fires on fast laps; podium bonus (P1 +40 / P2 +20 / P3 +10)
      so beating the field pays; results itemise the payout

### Perf & Stability

- [x] Profiled: frames are fill-rate bound under software rasterization.
      Ground baked into the track art, cached vignette, opaque canvas → 2–3×
      faster at high resolutions, same pixels
- [x] Skid-mark object pool
- [x] Playwright smoke tests in CI (`e2e/`, `npm run e2e`)
- [ ] Hold 60fps on a real low-end laptop _(needs a device)_

### Input & Accessibility

- [x] Key remap, colorblind palette, HUD size, mute
- [x] On-screen touch controls (multi-touch; touch screens only)
- [x] Gamepad: analog stick/triggers, Start pauses
- [x] Phone layout: stacked panels, HUD fits narrow screens, camera pulls out
- [x] Pause (Esc / P / Start / button) + auto-pause on focus loss
- [x] 3-2-1 start countdown; the field waits for GO

### Release

- [x] Production build passes typecheck/lint/format/tests (CI)
- [x] Deploy workflow: GitHub Pages on push to `main`
      (`.github/workflows/deploy.yml`)
- [ ] Enable Pages (Settings → Pages → Source: GitHub Actions) → public URL
      _(repo admin)_
- [ ] Listen to the engine/squeal mix; tune levels _(needs a human ear)_
- [ ] Record 60-second first-run video _(needs a human)_

## Phase 5 — Stretch / post-v1 🚧 started

- [x] Ghost racing vs your best lap, with a live split
- [x] Mobile/touch input + responsive layout
- [ ] Track visualizer / JSON import (from Phase 3)
- [ ] Weather/surface variants (rain = lower grip, dirt vs asphalt)
- [ ] More tracks / unlock map
- [ ] Replay capture
- [ ] Local leaderboards / shareable best-time codes
- [ ] Isometric camera tilt
- [ ] Gamepad menu navigation (today the pad drives and pauses; menus need
      mouse, keyboard or touch)
- [ ] Open Graph preview image (needs the final public URL)

## How to run checks

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run e2e      # builds, then browser smoke tests
npm run build
```
