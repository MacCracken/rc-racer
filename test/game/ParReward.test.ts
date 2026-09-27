import { describe, it, expect } from "vitest";
import { buildTrack, type TrackDef } from "../../src/track/Track.ts";
import { tracks } from "../../src/track/tracks.ts";
import { createCarWorld, stepCar } from "../../src/physics/MatterCar.ts";
import { RaceState } from "../../src/race/RaceState.ts";
import { makeDriver } from "../../src/race/AiDriver.ts";
import { FIXED_DT } from "../../src/core/tuning.ts";
import { applyBuild, freshUpgrades } from "../../src/game/upgrades.ts";
import { carClasses } from "../../src/game/cars.ts";
import { computeReward } from "../../src/game/economy.ts";

/**
 * The Phase 4 tuning check for the economy: a *faster* best lap must actually
 * earn *more* (the par bonus fires and is silent above par), and every shipped
 * par time must be *realistic* — an autopilot should be able to lap each track
 * within a plausible band of its par, so a good player has a lap that can beat
 * par and pocket the bonus. A par set too fast would make the bonus unearnable.
 */

const sedanStats = applyBuild(
  carClasses.find((c) => c.id === "street-sedan")!.base,
  freshUpgrades(),
);

/** Drive one autopilot lap on `def` and return its single-lap time (ms). */
function autopilotLapMs(def: TrackDef): number {
  const track = buildTrack(def);
  const world = createCarWorld(track);
  const car = world.car;
  let clockMs = 0;
  const race = new RaceState(track, () => clockMs);
  const driver = makeDriver(track, {
    pace: def.aiPace ?? 0.8,
    lookahead: 0.05,
  });
  const dt = FIXED_DT;
  let prev = { x: car.position.x, y: car.position.y };
  const cap = Math.ceil(45 / dt);
  for (let s = 0; s < cap; s++) {
    const input = driver({
      position: car.position,
      velocity: car.velocity,
      angle: car.angle,
    });
    stepCar(car, world.walls, track, input, sedanStats, dt);
    const cur = { x: car.position.x, y: car.position.y };
    race.update(prev, cur);
    prev = cur;
    clockMs += dt * 1000;
    if (race.lap >= 1) break;
  }
  return race.bestLapMs;
}

describe("economy: the par bonus", () => {
  it("a sub-par best lap earns a bonus above the base payout", () => {
    const par = 4000;
    const laps = 3;
    const base = 60 + laps * 8; // base payout, no performance bonus
    const atPar = computeReward({
      parLapMs: par,
      bestLapMs: par,
      lapsCompleted: laps,
    });
    const faster = computeReward({
      parLapMs: par,
      bestLapMs: par * 0.85,
      lapsCompleted: laps,
    });
    const slower = computeReward({
      parLapMs: par,
      bestLapMs: par * 1.2,
      lapsCompleted: laps,
    });

    // At par you get exactly the base; a faster lap earns strictly more;
    // a slower lap earns *no* bonus (diminishing, never negative).
    expect(atPar).toBe(base);
    expect(faster).toBeGreaterThan(base);
    expect(slower).toBe(base);
  });
});

describe("economy: par times are realistic", () => {
  it("an autopilot closes a lap on every track, and par is within a plausible band", () => {
    for (const def of tracks) {
      const par = def.parLapMs;
      expect(par, `${def.name}: parLapMs is set`).toBeTypeOf("number");
      expect(par, `${def.name}: parLapMs positive`).toBeGreaterThan(0);
      // Run a lap and make sure par isn't so aggressive it's unreachable.
      const t = autopilotLapMs(def);
      expect(t, `${def.name}: autopilot closed a lap`).toBeGreaterThan(0);
      expect(Number.isFinite(t), `${def.name}: finite lap time`).toBe(true);
      const ratio = t / par!;
      // The autopilot should be *around* par (within [0.7x, 1.6x]); tighter than
      // this would mean par is set to an impossible or trivially-slow number.
      expect(
        ratio,
        `${def.name}: autopilot ${Math.round(t)}ms vs par ${par}ms`,
      ).toBeGreaterThanOrEqual(0.7);
      expect(
        ratio,
        `${def.name}: autopilot far slower than par`,
      ).toBeLessThanOrEqual(1.6);
    }
  });
});
