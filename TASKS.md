# RC Racer — Immediate Task List

Generated from `roadmap.md` Phase 3 → Phase 4.

## Phase 3 — Content scale + polish 🚧 IN PROGRESS

### Visual / Juice — needs browser run

- [x] Curved curbs rendering on track edges
- [x] Tire smoke decals on hard drift
- [x] Finish-line confetti burst
- [x] Minimap overlay with car/track position
- [x] Ghost-line visual render via `IRenderer.drawGhost` — confirm visibility in dev build
- [x] Audio playback: WebAudio UI clicks/finish/lap chimes working
- [ ] Engine pitch ~ RPM hum — NOT implemented: only the optional `IAudio.setEngineSpeed` seam exists (nothing implements or calls it)
- [x] Onboarding panel — 30s how-to: controls + earn → upgrade → go faster
- [~] Track visualizer / JSON import tool for authoring tracks without code — stub in place, full authoring UI deferred to Phase 5

### Headless-verified items already shipped

- [x] 6 tracks in `tracks.ts` + 3rd car class 1/8 Brawler
- [x] Content QA guard `test/game/Content.test.ts`
- [x] Skid marks model `core/SkidMarks.ts` + unit tests
- [x] Audio seam `core/Audio.ts` + `NullAudio` tests
- [x] Ghost replay `race/Ghost.ts` + save v3 migration `SaveMigrate.test.ts`
      (v3 folds in `settings`)
- [x] Camera follow fix + regression test `test/Camera.test.ts`

## Phase 4 — Feel tuning pass & release demo

### Tuning & Balance

- [ ] Drive every car on every track; tune `tuning.ts` knobs _(needs a human)_
- [ ] Fix one bad corner per track _(needs a human)_
- [x] No no-op upgrade — guard test asserts every tier changes a resolved stat
      (`Economy.test.ts`)
- [x] No unfair par — autopilot laps every track within [0.7x, 1.6x] par (`ParReward.test.ts`)
- [x] Validate `parLapMs` economy bonus fires on fast laps (sub-par pays more; super-par pays base)

### Perf & Stability

- [ ] Hold 60fps on low-end laptop — profile _(needs a device)_
- [x] Skid-mark object pool — a sustained drift recycles marks, no per-frame alloc
      (`SkidMarks.test.ts`)
- [ ] GC-friendly object reuse for ghost/particle samples (confetti + ghost are
      cheap & bounded; revisit only if profiling shows pressure)

### Input & Accessibility

- [x] Key remap menu — click a binding, press a key to rebind; persisted to the
      versioned save (v3) and applied live to `KeyboardInput`. Tested in
      `Settings.test.ts`.
- [x] Colorblind-aware car palette — a `std`↔`cb` toggle (amber/blue → deuteranopia-
      safe orange/blue) driven through the renderer theme.
- [x] Readable HUD size — sm/md/lg scaling of the canvas HUD + minimap, persisted.
- [ ] Optional on-screen pointer/touch controls for a mobile demo — NOT done;
      keyboard-only for now (the `IInput` seam exists). Deferred.

### Release

- [ ] Production build `npm run build` passes typecheck/lint/tests
- [ ] Deploy static host Vercel/Netlify — public URL
- [ ] Record 60-second first-run video
- [ ] Update Definition of Done checklist in `roadmap.md`

## Stretch / Post-v1

- Weather/track variants, more content packs, unlock map, ghost racing replay, isometric camera tilt, mobile/touch input, Solid/Svelte UI, local leaderboards/share codes.

## How to run checks

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```
