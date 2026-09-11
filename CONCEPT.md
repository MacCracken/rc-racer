# Concept

## One-liner

Top-down arcade RC car racing with a deep upgrade/progression loop. You race
radio-control cars, beat rivals and lap times, bank credits, and build the
perfect machine for each track's demands.

## Genre positioning

| Ref              | What we borrow                                                                           | What we do differently                                                            |
| ---------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Yakuza "RC Cars" | Top-down drifting on tight streets, short punchy races, skill expression in a single run | Real progression between races (not one arcade cabinet); data-driven upgrades     |
| Pocket Circuit   | Many hand-built tracks of escalating difficulty; track shape _is_ the challenge          | Full RC cars w/ physics feel instead of a toy pocket racer; upgrade depth per car |

Tone: **arcade, not simulation.** Tunable, forgiving, readable. A new player
gets _most_ of the way through a track by reflex; mastery is closing the gap,
carrying speed, and reading braking points.

## Core verbs

1. **Drive** — steer, accelerate, brake, initiate and hold a drift.
2. **Upgrade** — spend credits to raise a car's stats and fit components.
3. **Select** — choose the right car + setup for a track's demands.
4. **Progress** — clear a track to unlock the next, and new cars.

## The progression loop

```
race (time trial vs AI rivals)
   -> place well / set a good time
   -> earn credits + XP (faster lap = more)
   -> buy/upgrade parts  OR  unlock a new car class
   -> take on a harder or longer track
   -> repeat
```

Progression is **dual-axis**:

- **Car depth** — a few cars (classes), each tunable across the upgrade tree.
- **Track depth** — a ladder of tracks, each tuned to test a specific skill.

## Car model (stats → feel)

Every car exposes these stats; upgrades modify them. The feel is the
translation of stats into physics behavior.

| Stat                    | Effect                                    | Upgrade families that move it        |
| ----------------------- | ----------------------------------------- | ------------------------------------ |
| Top speed               | Max velocity on a straight                | Engine, Aerodynamics (drag)          |
| Acceleration            | 0→60 / out of a corner                    | Engine (power), Weight, Tires (grip) |
| Handling / grip         | How quickly it turns, how wide the corner | Tires, Suspension, Weight            |
| Drift slide             | How much it can over-ride and hold slide  | Tires, Weight, Handbrake/Drift kit   |
| Braking                 | Corner entry speed                        | Brakes                               |
| Weight                  | Inertia, acceleration, braking, cornering | Chassis (weight reduction)           |
| Downforce               | High-speed grip stability                 | Aerodynamics                         |
| Traction line / balance | Front/rear balance → under/oversteer      | Suspension, Weight distribution      |

Car classes (initial set):

- **Street sedan** — balanced, forgiving, cheap. Early game.
- **Buggy (1/10)** — light, quick, high top end, twitchy.
- **Brawler / 1/8** — heavy, huge power, momentum, hard to stop. Late game.
- **(later) R/C truck, monster truck, formula** — flavor + niche tracks.

## Tracks

Hand-authored as **data** (a track object: a sequence of waypoints/rails,
start line, checkpoints, surface, props). Difficulty escalates by:

- tighter radii (needs better grip / lower speed),
- elevation-of-speed variation (accelerating then hard braking),
- length, then rival strength.

Track archetypes: Street Circuit, Dirt Oval, Off-road Buggy, Hairpin
Temple, Rain (low grip, later phase).

## Upgrades (data-driven)

Each car has **slots**: Engine, Tires, Suspension, Brakes, Aero, Chassis/Weight,
Drift Kit. Each slot has **tiers** (e.g. 5 levels) with a cost, a stat delta,
and a prerequisite. Costs scale, creating a "what do I fund first?" decision —
the heart of the depth.

## Monetization / progression gates

No real money. Currency is **credits**, earned in-race. Optional later:

- unlock-gated content packs (cosmetic + new tracks) — _not_ required.
- leaderboards / shareable best times.

## Scope guardrails (what "good enough demo" means)

A _great_ demo needs only ~40% of the full vision:

- 2 drivable car classes, 3 tracks, a 2-tier upgrade tree, working save.
  That alone demonstrates the full loop. Everything else is additive.

## Open questions

- 2D top-down vs. isometric tilt? **Decision: flat top-down now; isometric
  camera is a polish-phase option, not a v1 requirement.**
- Single-track-time vs. multi-lap? **Decision: multi-lap time trial (2–3 laps)
  vs. AI field; best-lap scores.**
- Mobile later? **Decision: desktop-first with keyboard/mouse; touch is a
  post-v1 phase.**
