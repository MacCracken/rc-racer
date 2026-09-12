import { describe, it, expect } from "vitest";
import { buildTrack } from "../../src/track/Track.ts";
import { tracks } from "../../src/track/tracks.ts";
import { createCarWorld, stepCar } from "../../src/physics/MatterCar.ts";
import { RaceState } from "../../src/race/RaceState.ts";
import { makeDriver } from "../../src/race/AiDriver.ts";
import { FIXED_DT } from "../../src/core/tuning.ts";
import { applyBuild, freshUpgrades } from "../../src/game/upgrades.ts";
import { carClasses } from "../../src/game/cars.ts";
import { sampleGhost } from "../../src/race/Ghost.ts";

/**
 * Content QA. New tracks/cars are *data*, not code — so we protect that data:
 * every track is drivable end-to-end (a stock sedan closes a lap), each track
 * has sane economy + difficulty metadata, and the car classes are actually
 * distinct. This is what stops a future author from shipping an undrivable
 * centerline.
 */

// A fresh, un-upgraded street sedan is the baseline "can a stock car do this?"
const sedanStats = applyBuild(
  carClasses.find((c) => c.id === "street-sedan")!.base,
  freshUpgrades(),
);

/** Close races at the track's own pace until one lap is closed or time runs out. */
function lapsClosed(trackId: string): number {
  const def = tracks.find((t) => t.id === trackId)!;
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
  for (let s = 0, cap = Math.ceil(40 / dt); s < cap; s++) {
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
  return race.lap;
}

describe("Content catalog — tracks are drivable, cars are distinct", () => {
  it("ships a non-trivial set of tracks and cars", () => {
    expect(tracks.length).toBeGreaterThanOrEqual(5);
    expect(carClasses.length).toBeGreaterThanOrEqual(3);
  });

  it("every track is drivable end-to-end by the stock sedan", () => {
    for (const def of tracks) {
      // One lap must close: the circuit is coherent and the autopilot handles it.
      // We don't require the full race here, which keeps CI fast.
      expect(lapsClosed(def.id), `track ${def.name} should close a lap`).toBe(
        1,
      );
    }
  });

  it("every track carries sane economy + difficulty metadata", () => {
    for (const def of tracks) {
      expect(def.parLapMs, `${def.name} parLapMs`).toBeGreaterThan(0);
      expect(
        def.difficulty,
        `${def.name} difficulty low`,
      ).toBeGreaterThanOrEqual(1);
      expect(def.difficulty, `${def.name} difficulty high`).toBeLessThanOrEqual(
        5,
      );
    }
  });

  it("car classes are distinct: buggy faster, brawler grippier, all positive", () => {
    const s = carClasses.find((c) => c.id === "street-sedan")!;
    const b = carClasses.find((c) => c.id === "buggy")!;
    const bw = carClasses.find((c) => c.id === "brawler")!;
    expect(b.base.maxSpeed).toBeGreaterThan(s.base.maxSpeed);
    expect(bw.base.grip).toBeGreaterThanOrEqual(s.base.grip);
    expect(bw.base.braking).toBeGreaterThan(b.base.braking);
    // Every base stat must be positive & finite, else physics breaks.
    for (const c of carClasses) {
      for (const v of Object.values(c.base)) {
        expect(v, `${c.id} has a bad stat`).toBeGreaterThan(0);
        expect(isFinite(v), `${c.id} has a non-finite stat`).toBe(true);
      }
    }
  });
  it("a full race records a non-empty, time-ascending ghost", () => {
    const def = tracks[0];
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
    const cap = Math.ceil(40 / dt);
    for (let s = 0; s < cap && !race.finished; s++) {
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
    }
    const g = race.bestGhost;
    expect(g.length).toBeGreaterThan(1);
    for (let i = 1; i < g.length; i++)
      expect(g[i].t).toBeGreaterThanOrEqual(g[i - 1].t);
    const mid = sampleGhost(g, g[Math.floor(g.length / 2)].t);
    expect(mid).not.toBeNull();
  });
});
