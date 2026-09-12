# RC Racer — Immediate Task List

Generated from `roadmap.md` Phase 3 → Phase 4.

## Phase 3 — Content scale + polish  🚧 IN PROGRESS

### Visual / Juice — needs browser run
- [x] Curved curbs rendering on track edges
- [ ] Tire smoke decals on hard drift
- [x] Finish-line confetti burst
- [x] Minimap overlay with car/track position
- [ ] Ghost-line visual render via `IRenderer.drawGhost` — confirm visibility in dev build
- [ ] Audio playback: WebAudio engine pitch ~ RPM, UI clicks, finish chime via `core/Audio.ts`
- [x] Onboarding panel — 30s how-to: controls + earn → upgrade → go faster
- [ ] Track visualizer / JSON import tool for authoring tracks without code

### Headless-verified items already shipped
- [x] 6 tracks in `tracks.ts` + 3rd car class 1/8 Brawler
- [x] Content QA guard `test/game/Content.test.ts`
- [x] Skid marks model `core/SkidMarks.ts` + unit tests
- [x] Audio seam `core/Audio.ts` + `NullAudio` tests
- [x] Ghost replay `race/Ghost.ts` + save v2 migration `SaveMigrate.test.ts`
- [x] Camera follow fix + regression test `test/Camera.test.ts`

## Phase 4 — Feel tuning pass & release demo

### Tuning & Balance
- [ ] Drive every car on every track; tune `tuning.ts` knobs
- [ ] Fix one bad corner per track, one no-op upgrade, one unfair track
- [ ] Validate `parLapMs` economy bonus fires on fast laps

### Perf & Stability
- [ ] Hold 60fps on low-end laptop — profile and cap particles
- [ ] GC-friendly object reuse for marks, particles, ghost samples

### Input & Accessibility
- [ ] Key remap menu
- [ ] Optional on-screen pointer controls for demo
- [ ] Colorblind-aware HUD colors, readable at small sizes

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
