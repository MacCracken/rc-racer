# RC Racer

A browser-based **top-down arcade radio-control car racing** game with a
progression loop — inspired by Yakuza's RC car mini-game and Pocket Circuit,
but with full-size RC cars (1/8, 1/10 buggies, brawlers, etc.) instead of a
pocket racer.

The core loop: **race → earn credits → upgrade / swap cars → take on harder
tracks.** Depth comes from two places: a car that _feels_ good to drive
(traction, drift, weight, downforce), and a meaningful upgrade tree across many
stats and many tracks.

**Play:** <https://maccracken.github.io/rc-racer/> once GitHub Pages is
enabled for the repo (one setting — see [DEPLOY.md](./DEPLOY.md)). Locally:
`npm install && npm run dev`.

- Concept: [CONCEPT.md](./CONCEPT.md) · Roadmap: [roadmap.md](./roadmap.md) ·
  Task list: [TASKS.md](./TASKS.md)

## Controls

Keyboard, gamepad and touch all work, even at once. Keys are rebindable in
Settings.

|                   | Keyboard              | Gamepad                              | Touch (phones/tablets)          |
| ----------------- | --------------------- | ------------------------------------ | ------------------------------- |
| Drive             | WASD or arrows        | left stick / d-pad; RT gas, LT brake | ◀ ▶ (left), GAS / BRAKE (right) |
| Drift (handbrake) | Space                 | A or RB                              | DRIFT                           |
| Pause             | Esc or P              | Start                                | ⏸ Pause                         |
| Restart / menu    | R / Q (or pause menu) | pause menu                           | pause menu                      |

Races start on a 3-2-1 countdown. Credits pay for finishing, more for a
podium, plus a bonus for a best lap under the track's par. After your first
finish on a track, a ghost car replays your best lap and the timer shows a
live split against it.

## Development

```bash
npm run dev           # dev server with HMR
npm test              # unit + headless sim tests (Vitest)
npm run e2e           # build, then browser smoke tests (Playwright/Chromium)
npm run typecheck && npm run lint && npm run format:check
npm run build         # production build to dist/
```

CI runs all of the above on every PR to `main`; pushes to `main` deploy to
GitHub Pages.

## Status

Phase 0 ✅ Scaffolding & loop — Vite + TypeScript + Vitest + ESLint + Prettier, fixed-timestep loop, `IInput` / `IRenderer` seams.

Phase 1 ✅ Vertical slice — Matter.js top-down car with traction/drift, data-authored tracks, look-ahead camera, HUD, lap timer.

Phase 2 ✅ Progression loop — data-driven stats/upgrades, credits economy, versioned save, AI rivals, menu/garage/results. Headless proof that upgrades make you faster.

Phase 3 ✅ Content + polish — 6 tracks, 3 car classes, skid marks + tyre smoke, curbs, minimap, confetti, ghost line, engine voice + tyre squeal, first-launch How to Play, save migration. All browser-verified. (The track editor moved to Phase 5.)

Phase 4 🚧 Tune + release — nearly there. Done: settings (key remap, colorblind mode, HUD size, mute), touch + gamepad input and a phone layout, start countdown, pause (auto on focus loss), podium bonus with itemised results, 2–3× faster rendering at high resolutions, a GitHub Pages deploy workflow, and Playwright smoke tests in CI. **Left, needing a person:** enable Pages and merge to `main` (→ public URL), a feel-tuning pass driving every car on every track, a 60fps check on a real low-end laptop, a listen to the new engine mix, and the 60-second first-run video.

Phase 5 🚧 Started — ghost-car racing with a live split, and mobile/touch input are in. See [roadmap.md](./roadmap.md) for the rest.

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
