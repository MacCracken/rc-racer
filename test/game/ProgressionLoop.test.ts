import { describe, it, expect } from "vitest";
import { buildTrack } from "../../src/track/Track.ts";
import { hairpin } from "../../src/track/tracks.ts";
import { createCarWorld, stepCar } from "../../src/physics/MatterCar.ts";
import { RaceState } from "../../src/race/RaceState.ts";
import { makeDriver } from "../../src/race/AiDriver.ts";
import {
  defaultCarStats,
  FIXED_DT,
  type CarStats,
} from "../../src/core/tuning.ts";
import { applyBuild, freshUpgrades } from "../../src/game/upgrades.ts";
import { carClasses } from "../../src/game/cars.ts";

/**
 * Drive a single autopiloted car on a track up to capSec of sim time. This is the
 * same loop the game runs, minus input (the AI supplies it). Returns whether it
 * finished, its best single lap, and the lap count.
 */
function runRace(
  stats: CarStats,
  pace: number,
  capSec = 30,
  track = buildTrack(hairpin),
): { finished: boolean; bestLapMs: number; laps: number } {
  const world = createCarWorld(track);
  const car = world.car;
  let clockMs = 0;
  const race = new RaceState(track, () => clockMs);
  const driver = makeDriver(track, { pace, lookahead: 0.05 });
  const dt = FIXED_DT;
  const cap = Math.ceil(capSec / dt);
  let prev = { x: car.position.x, y: car.position.y };
  for (let s = 0; s < cap; s++) {
    const input = driver({
      position: car.position,
      velocity: car.velocity,
      angle: car.angle,
    });
    stepCar(car, world.walls, track, input, stats, dt);
    const cur = { x: car.position.x, y: car.position.y };
    race.update(prev, cur);
    prev = cur;
    clockMs += dt * 1000;
    if (race.finished) break;
  }
  return { finished: race.finished, bestLapMs: race.bestLapMs, laps: race.lap };
}

describe("Progression loop — earn -> upgrade -> go faster (the core test)", () => {
  it("the autopilot finishes a real race", async () => {
    const r = runRace({ ...defaultCarStats }, 0.6, 40);
    expect(r.finished).toBe(true);
    expect(r.bestLapMs).toBeGreaterThan(0);
    expect(isFinite(r.bestLapMs)).toBe(true);
  });

  it("a faster autopilot target pace beats a slower one", async () => {
    const slow = runRace({ ...defaultCarStats }, 0.45, 40);
    const fast = runRace({ ...defaultCarStats }, 0.85, 40);
    expect(slow.finished && fast.finished).toBe(true);
    expect(fast.bestLapMs).toBeLessThan(slow.bestLapMs);
  });

  it("buying an engine upgrade makes the car visibly faster — Phase 2's proof", async () => {
    const before = runRace({ ...defaultCarStats }, 0.85, 45);
    const owned = freshUpgrades();
    owned.engine = 3;
    const afterStats = applyBuild(carClasses[0].base, owned);
    const after = runRace(afterStats, 0.85, 45);

    // Both finishes are real, and the upgraded car is meaningfully quicker.
    expect(before.finished && after.finished).toBe(true);
    expect(after.bestLapMs).toBeLessThan(before.bestLapMs * 0.92); // >8% off the track
  });
});
