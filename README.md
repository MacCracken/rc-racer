# RC Racer

A browser-based **top-down arcade radio-control car racing** game with a
progression loop — inspired by Yakuza's RC car mini-game and Pocket Circuit,
but with full-size RC cars (1/8, 1/10 buggies, brawlers, etc.) instead of a
pocket racer.

The core loop: **race → earn credits → upgrade / swap cars → take on harder
tracks.** Depth comes from two places: a car that _feels_ good to drive
(traction, drift, weight, downforce), and a meaningful upgrade tree across many
stats and many tracks.

**Play:** `npm install && npm run dev`. The build is a static site that runs
from any host or a zip — see [DEPLOY.md](./DEPLOY.md).

- [CONCEPT.md](./CONCEPT.md) — the design ·
  [CHANGELOG.md](./CHANGELOG.md) — what's in ·
  [roadmap.md](./roadmap.md) — what's next

## Controls

Keyboard, gamepad and touch all work, even at once. Keys are rebindable in
Settings.

|                   | Keyboard              | Gamepad                              | Touch (phones/tablets)          |
| ----------------- | --------------------- | ------------------------------------ | ------------------------------- |
| Drive             | WASD or arrows        | left stick / d-pad; RT gas, LT brake | ◀ ▶ (left), GAS / BRAKE (right) |
| Drift (handbrake) | Space                 | A or RB                              | DRIFT                           |
| Pause             | Esc or P              | Start                                | ⏸ Pause                         |
| Restart / menu    | R / Q (or pause menu) | pause menu                           | pause menu                      |
| Menus             | arrows, Enter, Esc    | d-pad or stick, A, B; Start = main   | tap                             |

Races start on a 3-2-1 countdown. Credits pay for finishing, more for a
podium, plus a bonus for a best lap under the track's par. After your first
finish on a track, a ghost car replays your best lap and the timer shows a
live split against it; after any race you can watch the whole thing back, and
Records keeps your five best laps on every track.

Tracks come with conditions: dirt and rain cost the whole field grip (rain
lengthens braking too), and at night you race by headlight.

## Development

```bash
npm run dev           # dev server with HMR
npm test              # unit + headless sim tests (Vitest)
npm run e2e           # build, then browser smoke tests (Playwright/Chromium)
npm run typecheck && npm run lint && npm run format:check
npm run build         # production build to dist/
npm run verify:tracks # autopilot every car on every track; times vs par
```

CI runs the typecheck, lint, format check, unit tests, build and browser
tests on every PR to `main`. There is no automated deploy.

Every change gets a line in [CHANGELOG.md](./CHANGELOG.md) under
`[Unreleased]`; finished roadmap items move there.

## Status

Working toward **0.1.0**, the first public demo. Phases 0–3 (scaffolding, the
drivable vertical slice, the progression loop, content and polish) are done.
Phase 4 (tune and release) is done except what needs a person: a feel-tuning
drive, a real low-end laptop, a listen to the sound mix, hosting, and the
first-run video. Phase 5 (stretch) is under way. See
[CHANGELOG.md](./CHANGELOG.md) for what's in and [roadmap.md](./roadmap.md)
for what's left.

## Why this stack (short version)

| Layer     | Choice                                       | Why                                                        |
| --------- | -------------------------------------------- | ---------------------------------------------------------- |
| Language  | TypeScript                                   | Type safety across a large, data-driven game               |
| Build/dev | Vite                                         | Fast HMR, tiny config, first-class TS                      |
| Rendering | Canvas 2D → (later) PixiJS/WebGL             | Start simple and fast; a clean seam to upgrade visuals     |
| Physics   | Own fixed-step integration, Matter.js bodies | Deterministic, tunable traction and drift; can't get stuck |
| Save/data | localStorage + JSON                          | No backend needed; cars, tracks and upgrades are data      |
| UI/HUD    | Plain DOM + TS (later Svelte/Solid)          | Menus separate from the render loop                        |

Rationale and the alternatives considered are in [roadmap.md](./roadmap.md).
