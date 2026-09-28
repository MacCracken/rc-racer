# Roadmap — RC Racer

**Goal:** a browser-based, top-down arcade RC racer whose selling point is
_feel + progression_: race → earn credits → upgrade or swap cars → take on
harder tracks. Every phase leaves the game playable.

This file tracks **open work only**. What has shipped is in
[CHANGELOG.md](./CHANGELOG.md); when an item here lands, it moves there.

**Where we are:** Phases 0–3 (scaffolding, the drivable vertical slice, the
progression loop, content and polish) are done. Phase 4 (tune and release) is
done except the checks that need a person. Phase 5 is under way.

---

## 0.1.0 — the public demo

What's left before tagging 0.1.0. Everything a machine can check is done; each
of these needs a person, a real device, or a decision.

- [ ] **Feel-tuning pass.** Drive every car on every track; fix the corner that
      feels wrong, the upgrade that feels like nothing, the track that feels
      unfair — and whether dirt, rain and night each feel right. The balance
      has been set with the autopilot racing every field (it wins the warm-up
      in a stock sedan, needs about 1300 cr of cars and parts to reach the
      finale, and about 4000 to win it); a human drives differently. Knobs:
      `core/tuning.ts` (`GRIP_ACCEL`, the cornering limit, is the big one;
      `CAR_BOUNCE` / `CAR_FRICTION` for contact), each car's stats in
      `game/cars.ts`, the upgrade tiers in `game/upgrades.ts`, each track's
      `parLapMs` / `rivals` in `track/tracks.ts`, `FIELD_SPREAD` in
      `game/rivals.ts`, the payouts in `game/economy.ts`, and the condition
      multipliers in `track/conditions.ts`. `npm run verify:tracks` runs the
      autopilot everywhere, alone and against each field.
- [ ] **60fps on a real low-end laptop.** Headless software-raster numbers are
      only a proxy (1080p holds 60, a 2× laptop panel ~35).
- [ ] **A listen to the sound mix** — engine, squeal, chimes — and levels
      adjusted in `core/Audio.ts`.
- [ ] **Hosting.** Pick a static host and publish `dist/` (see
      [DEPLOY.md](./DEPLOY.md)); link it from the README.
- [ ] **The 60-second first-run video** (shot list in DEPLOY.md), linked from
      the README.
- [ ] **Cut the release:** `version` in `package.json` → `0.1.0`, date the
      changelog section, tag `v0.1.0`.

**Exit criteria:** a stable 60fps, a public URL, and the first-run video.

---

## Phase 5 — Stretch

Additive, never blocking the demo. Roughly in priority order:

- [ ] **More tracks**, including combined conditions (a wet night, dirt in
      the rain): the physics and the renderer already compose them.
- [ ] **Track editor / JSON import.** A read-only visualizer plus JSON import
      beats a from-scratch authoring UI.
- [ ] **Share a lap to race:** a code or URL that loads someone's best lap
      as a ghost to chase (the Records screen shares a line of text today).
- [ ] **Isometric camera tilt** (the camera and renderer seams allow it).
- [ ] **Solid or Svelte for the menus**, once the set of views settles.
- [ ] **Optional cosmetic packs** — never a paywall on skill.
- [ ] **Open Graph preview image** (needs the final public URL).

---

## Phase 6 — Backed features (only if productizing)

Real-time multiplayer / netcode, accounts, cloud saves, real leaderboards,
monetization. **Out of scope for the demo**, and re-scoped as its own project
if RC Racer crosses from "cool demo" to "product".

---

## Risks

| Risk                                              | Impact | Mitigation                                                                                                                       |
| ------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Car feel is wrong                                 | High   | Feel is numbers (`tuning.ts`, car stats), tuned by driving; "good enough by feel", not by formula. The feel-tuning pass is open. |
| Low-end machines drop frames                      | Med    | Static art is pre-painted; per-frame fills are cut. Still needs a real-device check.                                             |
| AI unfair or boring                               | Med    | Rivals brake for the grip they have, race side by side and pass; ladder tests race the real field. Ship legible, not perfect.    |
| Scope creep on content                            | Med    | Content is data; Phase 5 is additive and never blocks the release.                                                               |
| Renderer migration cost (Canvas2D → PixiJS/WebGL) | Low    | Renderer, input and save sit behind interfaces; a swap stays local to one module.                                                |

---

## Decisions (reference)

The stack, and why. These still hold; revisit only with a reason.

| Concern     | Choice                                                        | Why / alternatives                                                                                                                    |
| ----------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Language    | TypeScript, strict                                            | A data-driven game is lots of structured objects; types catch wiring bugs. (JS + JSDoc: weak at scale.)                               |
| Build / dev | Vite                                                          | Instant HMR, tiny config, first-class TS. (webpack: heavier; esbuild alone: no dev server.)                                           |
| Rendering   | Canvas 2D behind an `IRenderer` seam; PixiJS/WebGL later      | Top-down 2D with a few cars holds 60fps in Canvas2D; the seam avoids a rewrite if we outgrow it.                                      |
| Physics     | Own integration on a fixed step; Matter.js bodies as seam     | Deterministic and easy to tune; an analytic stay-in-the-band collision can't stall a car. Full SAT/wheel constraints remain possible. |
| Game loop   | Fixed-timestep accumulator (120 Hz), decoupled from rAF       | The same physics at any frame rate.                                                                                                   |
| Input       | `IInput` seam; keyboard, gamepad and touch merged             | The loop never knows the device.                                                                                                      |
| Save        | `localStorage`, one versioned JSON blob + `migrate()`         | No backend. IndexedDB if saves outgrow it.                                                                                            |
| Content     | Cars, tracks and upgrades as typed data                       | Adding "level 10" is authoring data, not writing logic.                                                                               |
| UI          | Plain DOM + TS, rebuilt per screen                            | Don't pay a framework's cost before the views are known (see Phase 5).                                                                |
| Tests       | Vitest (logic + headless sims), Playwright (the real build)   | Physics and upgrade math are where bugs hide; the browser suite catches what only a browser shows.                                    |
| CI          | GitHub Actions on PRs: types, lint, format, tests, build, e2e | Checks only; deploys are a separate decision.                                                                                         |

**Guiding principles**

1. **Playable at every step.** Each change leaves something a person can run
   and _do something with_.
2. **Data over code for content.** Cars, tracks and upgrades are data.
3. **Feel is a tunable knob, not magic.** Stats map to forces; tuning is
   editing a table.
4. **Thin seams.** Renderer, input, audio and save are interfaces, so an
   implementation can change without touching the simulation.

**Explicitly deferred:** real multiplayer, 3D, full-size mobile app packaging,
a leaderboard backend, in-app content packs (see Phases 5–6).
