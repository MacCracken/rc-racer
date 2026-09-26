# Phase 4 — Feel tuning pass & release demo

## Tuning review

- [ ] Drive every car on every track; note feel issues _(needs a human driving)_
- [ ] Fix one bad corner per track in `tuning.ts` _(needs a human driving)_
- [x] No no-op upgrade — `Economy.test.ts` now asserts every tier of every slot
      changes at least one resolved stat, so a future no-op upgrade is caught.
- [x] No unfair par — `ParReward.test.ts` asserts the par bonus fires for a sub-par
      lap (and is silent above par) and that an autopilot laps every track within a
      realistic [0.7x, 1.6x] band of par, so par is reachable but not trivial.

## Performance

- [x] Add FPS counter to HUD for perf monitoring
- [x] Cap skid marks to 400 — now also object-pooled (a sustained drift recycles
      each mark instead of allocating; verified by `SkidMarks.test.ts`). Confetti is
      recomputed per frame and is cheap, so it needs no pool.
- [ ] Profile on low-end laptop; ensure 60fps _(needs a device)_

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
