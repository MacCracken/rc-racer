# RC Racer

A browser-based **top-down arcade radio-control car racing** game with a
progression loop — inspired by Yakuza's RC car mini-game and Pocket Circuit,
but with full-size RC cars (1/8, 1/10 buggies, brawlers, etc.) instead of a
pocket racer.

The core loop: **race → earn credits → upgrade / swap cars → take on harder
tracks.** Depth comes from two places: a car that _feels_ good to drive
(traction, drift, weight, downforce), and a meaningful upgrade tree across many
stats and many tracks.

This repo currently holds the project plan. See **[roadmap.md](./roadmap.md)**
for the phase-by-phase build path.

- Concept: see `CONCEPT.md`
- Roadmap: see `roadmap.md`

## Status

Phase 0 ✅ Scaffolding & loop — Vite + TypeScript + Vitest + ESLint + Prettier, fixed-timestep loop, `IInput` / `IRenderer` seams.

Phase 1 ✅ Vertical slice — Matter.js top-down car with traction/drift, data-authored tracks, look-ahead camera, HUD, lap timer. 3 tracks, `tuning.ts` Vehicle Model, 17 unit tests.

Phase 2 ✅ Progression loop — stats/upgrades data-driven, credits economy, versioned localStorage save, `Progression` orchestrator, AI autopilot, multi-car arena, menu/garage/results UI. Headless proof shows upgrades make you faster.

Phase 3 🚧 IN PROGRESS — Content scale + polish. Shipped & headless-verified: 6 tracks, 3 car classes incl. 1/8 Brawler, content QA guard, skid marks model, audio event seam, ghost replay + save v2 migration, fixed camera follow. Remaining for browser confirmation: curved curbs, tire smoke, finish confetti, minimap, ghost-line visual render, WebAudio playback, onboarding how-to, track visualizer/JSON import.

Phase 4 🚧 Feel tuning + release demo. Done & headless-verified so far: FPS HUD, 400-mark skid cap, **a real Settings screen** — key remap (click a binding, press a key; captured live, persisted to the versioned save v3, applied to the `KeyboardInput` KeyMap), a **colorblind mode** toggle (amber/blue ↔ deuteranopia-safe orange/blue, driven through the renderer), and **sm/md/lg HUD sizing** — with `game/settings.ts` + 13 tests in `test/game/Settings.test.ts`. Still pending browser confirmation: 60fps on a low-end machine, the visuals above, key-remap UX in the DOM, and **deploy + first-run video**.

Next action: **Confirm the settings visuals in a browser, then Phase 4 release — tuning pass, 60fps profiling + pooling, deploy to a static host, and a 60-sec video.**

## Why this stack (short version)

| Layer     | Choice                            | Why                                                                 |
| --------- | --------------------------------- | ------------------------------------------------------------------- |
| Language  | TypeScript                        | Type safety across a large, data-driven game                        |
| Build/dev | Vite                              | Fast HMR, tiny config, first-class TS                               |
| Rendering | Canvas 2D → (later) PixiJS/WebGL  | Start simple & fast; clean seam to upgrade visuals                  |
| Physics   | Matter.js                         | Rigid-body + constraint car sim = realistic top-down traction/drift |
| Save/data | localStorage + JSON               | No backend needed; upgrade catalog + save as data files             |
| UI/HUD    | Plain DOM + TS (later Svelte/Vue) | HUD/menus separate from the render loop                             |

Rationale and the alternatives considered are documented in `roadmap.md`.
