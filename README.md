# RC Racer

A browser-based **top-down arcade radio-control car racing** game with a
progression loop — inspired by Yakuza's RC car mini-game and Pocket Circuit,
but with full-size RC cars (1/8, 1/10 buggies, brawlers, etc.) instead of a
pocket racer.

The core loop: **race → earn credits → upgrade / swap cars → take on harder
tracks.** Depth comes from two places: a car that *feels* good to drive
(traction, drift, weight, downforce), and a meaningful upgrade tree across many
stats and many tracks.

This repo currently holds the project plan. See **[roadmap.md](./roadmap.md)**
for the phase-by-phase build path.

- Concept: see `CONCEPT.md`
- Roadmap: see `roadmap.md`

## Status

Pre-scaffolding. No code yet. Stack decision and phase plan are finalized in
`roadmap.md`. Next action: scaffold the project and implement **Phase 1
(vertical slice of one drivable car on one track)**.

## Why this stack (short version)

| Layer        | Choice        | Why |
|--------------|---------------|-----|
| Language     | TypeScript    | Type safety across a large, data-driven game |
| Build/dev    | Vite          | Fast HMR, tiny config, first-class TS |
| Rendering    | Canvas 2D → (later) PixiJS/WebGL | Start simple & fast; clean seam to upgrade visuals |
| Physics      | Matter.js     | Rigid-body + constraint car sim = realistic top-down traction/drift |
| Save/data    | localStorage + JSON | No backend needed; upgrade catalog + save as data files |
| UI/HUD       | Plain DOM + TS (later Svelte/Vue) | HUD/menus separate from the render loop |

Rationale and the alternatives considered are documented in `roadmap.md`.
