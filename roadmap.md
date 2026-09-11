# Roadmap — RC Racer

**Goal:** Ship a browser-based, top-down arcade RC car racing demo whose selling
point is _feel + progression_ (earn credits → upgrade/swap cars → harder
tracks). Phases are ordered so that **each phase leaves a playable, demoable
state**, and the project is "good enough to show" by the end of **Phase 4**.

> Note: web research was unavailable while writing this (local search tool
> auth'd out), so the stack below is chosen from prior knowledge of browser
> game tooling, not from a live survey. Each non-obvious choice is annotated
> with the alternatives it beat and why.

---

## Stack (locked)

| Concern                       | Choice                                                                                            | Rationale / alternatives considered                                                                                                                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Language                      | **TypeScript** (strict, `noImplicitAny`)                                                          | Data-driven game = lots of structured objects; types catch wiring bugs. Alt: JS+JSDoc (rejected: weak at scale).                                                                                                                                                                                             |
| Build/dev                     | **Vite**                                                                                          | Instant HMR, tiny config, first-class TS, production bundling. Alt: webpack (heavier), esbuild-only (no dev server).                                                                                                                                                                                         |
| Rendering                     | **Canvas 2D** for v1, with a **renderer interface** we later swap to **PixiJS/WebGL**             | Top-down racing is 2D and light enough for Canvas2D to 60fps with a few cars + track. Renderer interface avoids a rewrite. Alt: PixiJS-on-day-1 (richer but adds dependency + complexity too early).                                                                                                         |
| Physics                       | **Matter.js** (rigid-body + constraints)                                                          | The proven pattern for top-down _car_ physics: one body, engine torque, per-axle steering/wheel constraints → realistic traction, drift, under/oversteer. A kinematic "rotate-the-sprite" arcade model (alt) cannot produce the drifting feel that sells this genre. Matter is mature, well-documented, MIT. |
| Game loop                     | Fixed-timestep accumulator decoupled from `requestAnimationFrame`                                 | Deterministic physics step regardless of framerate. Standard best practice.                                                                                                                                                                                                                                  |
| Input                         | Keyboard (WASD/arrows) + pointer; **input abstraction layer** now so touch/gamepad drop in later  | Keeps the loop input-agnostic.                                                                                                                                                                                                                                                                               |
| Save                          | **localStorage** (single JSON blob, versioned)                                                    | No backend. v1 only. Alt: IndexedDB for large data later.                                                                                                                                                                                                                                                    |
| Data (cars, tracks, upgrades) | **External JSON/TS data files** with typed schemas                                                | Contenteditable without touching logic — key to scaling tracks/upgrades.                                                                                                                                                                                                                                     |
| UI/HUD/menus                  | Plain DOM + TS in v1, behind a view layer; graduate to **Svelte** or **Solid** later              | Don't pay a framework's learning/tax cost before we know what the views need.                                                                                                                                                                                                                                |
| Tests                         | **Vitest** (unit: physics tuning, math, data integrity); lightweight golden-frame/loop smoke test | Physics + upgrade math are where bugs hide; cheap to test, high value.                                                                                                                                                                                                                                       |
| Lint/format                   | ESLint + Prettier                                                                                 | Standard.                                                                                                                                                                                                                                                                                                    |
| CI                            | GitHub Actions: lint + typecheck + test on PR                                                     | Optional, Phase 3.                                                                                                                                                                                                                                                                                           |

**Explicitly deferred (not v1):** real multiplayer/netcode, 3D, isometric
camera, full mobile, leaderboards backend, in-app content packs. See Phase 6+.

---

## Guiding principles

1. **Playable at every phase end.** Every phase's exit criteria = something a
   person can run in a browser and _do something with_.
2. **Data over code for content.** Cars, tracks, upgrades are data so adding
   "level 10" doesn't mean writing logic.
3. **Feel is a tunable knob, not magic.** Car stats → a single "Vehicle
   Model" that maps stats to physics forces. Tuning = editing a numbers table,
   not rewriting physics.
4. **Thin seams.** Renderer, Input, and Save are interfaces so we can swap
   implementations (Canvas→Pixi, localStorage→IndexedDB) without touching the
   simulation.

---

## Phase 0 — Scaffolding & loop _(~0.5 day)_

Set up the machine so that future phases are pure feature work.

- `npm init`, install Vite + TypeScript + Vitest + ESLint + Prettier.
- Vite app with an `index.html` + `src/`.
- Minimal **fixed-timestep game loop** that logs frames and runs a rAF render
  tick, drawing a moving box on a canvas.
- `IInput`, `IRenderer` interfaces + a Canvas2D implementation + keyboard input.
- Repo hygiene: `.gitignore`, git init, first commit. CI stub (lint+typecheck).

**Exit criteria:** A box moves on screen driven by the keyboard; dev server
hott reloads; `npm run test/build/lint` all pass on a trivial test.

**Deliverable demo:** "the engine ticks and I can move a thing."

---

## Phase 1 — Vertical slice: one car, one track _(~1–2 days)_

The single most important phase. Proves feel + camera + loop end-to-end.

- **Matter.js** integration: world, ground, the car body.
- **Vehicle Model v1:** front-wheel steering + rear drive torque. Car
  accelerates, brakes, steers. Add a simple **drift/handbrake** (rear lock or
  reduced rear grip) so it can slide.
- **Track** authored as data: a closed **spline/rail** with an inside/outside
  boundary (walls or a "grass" slow zone), a start/finish line, and 1–2
  lap-checkpoint gates.
- **Track rendering:** asphalt ribbon, curbs, start/finish, grid.
- **Cameras:** camera follow with a slight look-ahead; clamp to track.
- **HUD:** speed, lap, current/lap/best time.
- **Win condition:** cross start line N times → lap timer → "You finished,
  lap X:Y.Z".
- **VehicleModel is a pure function of a stat vector** (topSpeed, accel, grip,
  braking, ...) so Phase 2 just feeds it different numbers.

**Exit criteria:** On one track, accelerate/brake/steer/drift, complete 3 laps
on a timer, with a readable camera and HUD. Feels "drivey."

**Deliverable demo:** "**The game's soul** — a car you can actually drive."
This alone is 40% of the sellable demo.

**Risk:** car physics feel is the make-or-break. Mitigation: expose steering
torque, engine force, drag coefficient, and grip as named constants/curve knobs
and tune them _during_ this phase; commit a `tuning.ts` you keep editing.
Accept "good enough" by feel, not by formula.

---

## Phase 2 — Progression loop: upgrades + credits _(~2–3 days)_

Turn "driving an arc" into "reasoning about a build."

- **Stats model** finalized & centralized (see CONCEPT.md stat table): top
  speed, accel, grip/handling, drift capacity, braking, weight, downforce.
  Each maps to a concrete physics knob in the Vehicle Model.
- **Upgrade system (data-driven):** car _slots_ (Engine, Tires, Suspension,
  Brakes, Aero, Chassis/Weight, Drift Kit) × _tiers_ with {cost, statDelta,
  prereq, description}.
- **Economy:** earn **credits** on finishing a race (base + time performance
  bonus, diminishing so "fast" is rewarded but not infinite).
- **Save/load:** versioned localStorage snapshot — credits, owned cars/equipment,
  best lap times.
- **Upgrade UI:** menu to view a car's build, see each slot's tiers + costs,
  buy/apply, and see stat bars change _live_.
- **Car classes:** at least **Street Sedan** + **Buggy**, differing stats,
  selectable at the grid.
- **Tracks:** 3 tracks of escalating difficulty (radius/length/rival-speed).
- **Time-trial vs AI:** spawn **AI cars** driven by a simple
  race-line/speed-control autopilot (follow a racing line, throttle to corner
  speed). Player competes for position; **best-lap** records per track.

**Exit criteria:** You can earn credits, afford and install an upgrade that
_visibly_ changes lap time, save it, reload, and progress through 3 tracks
across 2 car classes with a meaningful "what do I fund first" decision.

**Deliverable demo:** "The **loop** — I raced, got money, upgraded, and went
faster." This is the "good enough demo" milestone (≈end of Phase 4 polish).

**Risk:** tuning AI to be "fair and fun" is fiddly. Mitigation: AI autopilot
as its own tunable module with per-track "pace" factor; ship it _imperfect but
legible_ — an AI that sometimes takes the wrong line is fine for a demo.

---

## Phase 3 — Content scale + polish _(~3–4 days)_

Make it feel designed, not wired.

- **Track editor (in-game or offline JSON tool):** so adding a track is
  authoring data, not code. Even a read-only visualizer + JSON import beats a
  from-scratch authoring UI.
- **5th–8th tracks**, **3rd car class (1/8 brawler)** for heavy/power feel.
- **Visual polish:** curved curbs, skid marks / tire smoke on drift, finish
  confetti, better HUD (lap, position, ghost line from your best lap),
  minimap.
- **Audio:** engine pitch ~ RPM (procedural, from a sample or oscillator),
  UI clicks, finish chime. Engine pitch is high-perceived-value for cheap cost.
- **Onboarding:** a 30s how-to (controls + "earn → upgrade → go faster").
- **Save migration** path tested (load old save after a schema change).
- **CI** runs tests + build on PR; **Vitest** suites for upgrade math, lap
  timer, save load/migrate, and a physics determinism smoke test.

**Exit criteria:** A first-time user can load the demo, be onboarded, race a
track, understand they should upgrade, upgrade, and feel progress — with juice
(skid marks, engine sound, minimap) and no obvious bugs or dead ends.

**Deliverable demo:** "The **product** — a small but complete, juicy arcade
racer." Publicize-able.

---

## Phase 4 — Feel tuning pass & release demo _(~1–2 days)_

Not new features — extract, tune, stabilize.

- **Tuning review:** drive every car on every track; fix the one corner that
  feels wrong, the one upgrade that's a no-op, the one track that's unfair.
- **Perf:** hold 60fps on a low-end laptop; cap particles; ensure GC-friendly
  object reuse.
- **Input:** key remap + optional on-screen controls (pointer) if device-agnostic
  demo matters.
- **Accessibility/readability:** colorblind-aware HUD, readable at small sizes.
- **Packaging:** production build, deploy to a static host (Vercel/Netlify/CNAME)
  as the shareable demo URL.

**Exit criteria:** Stable 60fps, a deployed URL, a 60-second "first-run" video.
This is the **public demo**.

---

## Phase 5 — Stretch / post-v1 (only after demo is live)

Track the vision, gated, none blocking the demo:

- **Weather/track variants:** rain (lower grip), night, dirt vs. asphalt
  surfaces, each with a different stat tradeoff.
- **More tracks / content packs** and an **unlock map**.
- **Ghost racing** vs. your own best time, replay capture.
- **Isometric camera tilt** (seam already exists in camera code).
- **Mobile/touch** input via the input abstraction; responsive layout.
- **Solid/Svelte UI** for complex menus once the view set is known.
- **Local leaderboards / shareable best-time codes** (IndexedDB + share URL).
- **Optional cosmetic content packs** (never a paywall on skill).

---

## Phase 6 — (only if productizing) Backed features

- Real-time multiplayer / netcode, account system, cloud saves, real
  leaderboards, monetization. **Explicitly out of scope for the demo** and
  re-scoped as its own project when/if we cross from "cool demo" to "product."

---

## Effort estimate

| Phase              | Est.  | Cumulative | Demoable?          |
| ------------------ | ----- | ---------- | ------------------ |
| 0 Scaffolding      | 0.5 d | 0.5 d      | trivial            |
| 1 Vertical slice   | 1.5 d | 2 d        | core feel ✅       |
| 2 Progression loop | 2.5 d | 4.5 d      | loop ✅            |
| 3 Content + polish | 3.5 d | 8 d        | product ✅         |
| 4 Tune + release   | 1.5 d | 9.5 d      | **public demo ✅** |
| 5+ Stretch         | open  | —          | additive           |

Realistic to a "good enough public demo" in **~1–1.5 weeks focused effort**.

---

## Risks & how we de-risk

| Risk                                                                    | Impact | Mitigation                                                                                                                                             |
| ----------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Car feel is wrong**                                                   | High   | Tune as constants in Phase 1; `tuning.ts` you iterate on live; "good enough" by feel not formula; don't perfect it pre-Phase 2.                        |
| **Matter.js top-down car is finicky** (tunneling through walls, jitter) | Med    | Use a continuous/dynamic-sensor approach; cap velocities; test the smoke test in Phase 3; keep body counts low.                                        |
| **AI unfair/boring**                                                    | Med    | Autopilot with per-track pace; ship legible-not-perfect.                                                                                               |
| **Scope creep on content**                                              | Med    | Data-driven content = cheap; cap v1 at 3 tracks / 2 cars; stretch moves to Phase 5.                                                                    |
| **Renderer migration cost**                                             | Low    | Renderer + Input + Save are interfaces from Phase 0; swaps are localized.                                                                              |
| **No web research available now**                                       | Low    | Stack is from prior knowledge; revisit the stack decision at Phase 0 start if a better engine is found, but the _interface_ decision holds regardless. |

---

## Definition of done (for the demo / end of Phase 4)

- [ ] Drivable car with real traction/drift on a top-down track.
- [ ] 2 car classes, 3 tracks, working upgrade tree + credits + save.
- [ ] AI rivals + best-lap records.
- [ ] Juicy (skid marks, engine pitch, minimap), onboarded, 60fps.
- [ ] Deployed at a public URL; 60-sec first-run video exists.
