# Phase 4 — Feel tuning pass & release demo

## Tuning review
- [ ] Drive every car on every track; note feel issues
- [ ] Fix one bad corner per track in `tuning.ts`
- [ ] Identify and nerf/buff one no-op upgrade
- [ ] Re-balance one unfair track

## Performance
- [x] Add FPS counter to HUD for perf monitoring
- [x] Cap skid marks to 400 (a bounded, GC-light buffer — not a pool)
- [ ] Object pool for skid marks / confetti — NOT done; the bounded caps limit churn
  but marks/particles still allocate. Fold into the 60fps pass when profiling.
- [ ] Profile on low-end laptop; ensure 60fps

## Input
- [x] Settings screen with key bindings
- [x] Key remap menu — functional: click a binding, press a key to rebind, captured
  live and persisted to the versioned save (v3). One code per action, applied to the
  `KeyboardInput` KeyMap immediately. Verified by 13 tests in `Settings.test.ts`.
- [ ] Optional on-screen touch controls for a mobile demo — NOT implemented. The
  IInput seam exists and keyboard works, but no pointer/gamepad overlay is wired.
  Deferred to Phase 5 unless a touch demo is required.

## Accessibility / Readability
- [x] Colorblind mode — a Settings toggle: `std` (amber vs blue) ↔ `cb` (orange vs
  blue, deuteranopia-safe). The renderer pulls its car palette from the theme, so it
  takes effect live and persists across sessions.
- [x] HUD size option — sm/md/lg scaling of the canvas HUD + minimap, driven by the
  same persisted settings. A dedicated high-contrast toggle is a future refinement.

## Packaging / Release
- [x] `npm run build` passes
- [ ] Deploy to static host (Vercel/Netlify)
- [ ] Record 60-sec first-run video
- [ ] Update README with public URL

## Definition of Done
- Stable 60fps, deployed URL, 60-sec video.
