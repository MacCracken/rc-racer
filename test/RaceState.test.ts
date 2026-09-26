import { describe, it, expect } from "vitest";
import {
  RaceState,
  currentLapTimeMs,
  formatLap,
} from "../src/race/RaceState.ts";
import { buildTrack, type TrackDef } from "../src/track/Track.ts";
import { overture, tracks } from "../src/track/tracks.ts";
import type { Vec2 } from "../src/core/vec.ts";
import { createCarWorld, stepCar } from "../src/physics/MatterCar.ts";
import { makeDriver } from "../src/race/AiDriver.ts";
import { FIXED_DT } from "../src/core/tuning.ts";
import { applyBuild, freshUpgrades } from "../src/game/upgrades.ts";
import { carClasses } from "../src/game/cars.ts";

/**
 * Drive a synthetic car around the centerline so it crosses every gate in
 * order, and assert the RaceState counts laps honestly.
 */
describe("RaceState lap detection", () => {
  function makeRace() {
    let clock = 0;
    const track = buildTrack(overture);
    const race = new RaceState(track, () => clock);
    return { track, race, advance: (ms: number) => (clock += ms) };
  }

  it("does not start a lap while the car is parked at the line", () => {
    const { track, race } = makeRace();
    const p: Vec2 = track.gates[0]!.center!;
    race.update(p, p); // no movement
    expect(race.lap).toBe(0);
    expect(race.finished).toBe(false);
  });

  it("completes all laps when every gate is crossed in order", () => {
    const { track, race, advance } = makeRace();
    const cl = track.centerLine;
    // Drive one full lap, step through the centerline so each gate is crossed
    // in sequence; advance the clock so lap times are positive.
    for (let pass = 0; pass <= track.laps + 1; pass++) {
      for (let i = 0; i < cl.length; i++) {
        const cur = cl[i]!;
        const prev = cl[(i - 1 + cl.length) % cl.length]!;
        advance(50);
        race.update(prev, cur);
      }
    }
    expect(race.lap).toBeGreaterThanOrEqual(track.laps);
    expect(race.finished).toBe(true);
    expect(race.lapTimesMs.length).toBeGreaterThan(0);
    expect(Number.isFinite(race.bestLapMs)).toBe(true);
  });

  it("holds the lap clock at zero until the car first moves off the grid", () => {
    const { track, race, advance } = makeRace();
    const p = track.start.pos;
    let now = 0;
    for (let i = 0; i < 100; i++) {
      now = advance(10); // a full second parked on the line
      race.update(p, p);
    }
    expect(currentLapTimeMs(race, now)).toBe(0);
    now = advance(10);
    race.update(p, { x: p.x + 1, y: p.y }); // first movement
    expect(currentLapTimeMs(race, now)).toBe(10); // timed from the last parked tick
  });

  it("stamps finishMs when the final lap completes", () => {
    const { track, race, advance } = makeRace();
    const cl = track.centerLine;
    expect(race.finishMs).toBe(Infinity);
    for (let pass = 0; pass <= track.laps + 1 && !race.finished; pass++) {
      for (let i = 1; i <= cl.length; i++) {
        advance(50);
        race.update(cl[i - 1]!, cl[i % cl.length]!);
      }
    }
    expect(race.finished).toBe(true);
    expect(Number.isFinite(race.finishMs)).toBe(true);
  });

  it("progress grows monotonically around the lap and across the line", () => {
    const { track, race, advance } = makeRace();
    const cl = track.centerLine;
    let last = race.progress(cl[0]!);
    expect(last).toBe(0);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i <= cl.length; i++) {
        const cur = cl[i % cl.length]!;
        advance(50);
        race.update(cl[i - 1]!, cur);
        const p = race.progress(cur);
        expect(p).toBeGreaterThan(last);
        last = p;
      }
    }
    expect(race.lap).toBe(2);
    // Two laps done = two lap lengths of centerline, not a lap count proxy.
    let lapLength = 0;
    for (let i = 0; i < cl.length; i++) {
      const a = cl[i]!;
      const b = cl[(i + 1) % cl.length]!;
      lapLength += Math.hypot(b.x - a.x, b.y - a.y);
    }
    expect(last).toBeCloseTo(2 * lapLength, 6);
  });

  it("does not bank a lap on a back-and-forth jiggle at a single gate", () => {
    const { track, race } = makeRace();
    const gate = track.gates[1]!;
    // Oscillate across gate 1 only; it's not the start/finish, so no lap.
    for (let i = 0; i < 20; i++) {
      const prev = { x: gate.center!.x, y: gate.center!.y };
      const cur = { x: gate.a!.x, y: gate.a!.y };
      race.update(prev, cur);
      race.update(cur, prev);
    }
    expect(race.lap).toBe(0);
  });
});

/**
 * Drive a real Matter.js car around a track with the autopilot, feeding the
 * RaceState the per-tick (prev -> cur) segment each step — the same way
 * `Game.onStep` does. `RaceState` counts a lap only when the start/finish gate
 * is crossed after the other gates, and stamps the finished lap with a time.
 */
describe("RaceState lap timing over a real per-tick physics feed", () => {
  // Regression guard for a real bug: `Game.onStep` once fed every tick with
  // (storedPrev, current) where `storedPrev` never advanced, so the gate test
  // saw a long chord from the grid. That still banked the right lap COUNT, but
  // each "lap" was stamped at a spurious early chord-crossing, so the recorded
  // best time was wrong. The per-tick feed is fixed now; these golden best-lap
  // times pin the fix. MatterCar is deterministic (see MatterCar.test), so the
  // values reproduce; the +/-0.8s band absorbs float drift yet dwarfs the
  // 1-3s error the frozen-prev bug produced.
  const TOL_MS = 800;
  const GOLDEN_BEST_MS: Record<string, number> = {
    overture: 17725,
    hairpin: 12000,
    riverbend: 17467,
    clover: 17333,
    "dust-bowl": 13667,
    slalom: 14450,
  };

  const sedanStats = applyBuild(
    carClasses.find((c) => c.id === "street-sedan")!.base,
    freshUpgrades(),
  );

  function driveToFinish(def: TrackDef): RaceState {
    const track = buildTrack(def);
    const world = createCarWorld(track);
    let clockMs = 0;
    const race = new RaceState(track, () => clockMs);
    const driver = makeDriver(track, {
      pace: def.aiPace ?? 1,
      lookahead: 0.05,
    });
    let prev: Vec2 = { x: world.car.position.x, y: world.car.position.y };
    const cap = Math.ceil(90 / FIXED_DT);
    for (let s = 0; s < cap && !race.finished; s++) {
      const inp = driver({
        position: world.car.position,
        velocity: world.car.velocity,
        angle: world.car.angle,
      });
      stepCar(world.car, world.walls, track, inp, sedanStats, FIXED_DT);
      const cur: Vec2 = { x: world.car.position.x, y: world.car.position.y };
      // Per-tick (prev -> cur): the feed that respects the real path.
      race.update(prev, cur);
      prev = cur;
      clockMs += FIXED_DT * 1000;
    }
    return race;
  }

  it.each(tracks)("banks every lap and captures times on $name", (def) => {
    const race = driveToFinish(def);
    const track = buildTrack(def);
    expect(race.finished).toBe(true);
    expect(race.lap).toBe(track.laps);
    expect(race.lapTimesMs.length).toBe(track.laps);
    for (const t of race.lapTimesMs) expect(t).toBeGreaterThan(0);
    // Last + best laps were captured and are display-ready.
    expect(race.lastLapMs).toBeGreaterThan(0);
    expect(race.bestLapMs).toBeGreaterThanOrEqual(0);
    expect(race.bestLapMs).toBe(Math.min(...race.lapTimesMs));
  });

  it.each(tracks)(
    "records a real best lap on $name (not a chord-banked one)",
    (def) => {
      const race = driveToFinish(def);
      const golden = GOLDEN_BEST_MS[def.id];
      expect(golden).toBeDefined();
      expect(race.bestLapMs).toBeGreaterThanOrEqual(golden - TOL_MS);
      expect(race.bestLapMs).toBeLessThanOrEqual(golden + TOL_MS);
    },
  );
});

describe("formatLap", () => {
  it("renders mm:ss.mmm and handles zero", () => {
    expect(formatLap(64320)).toBe("1:04.320");
    expect(formatLap(0)).toBe("--:--.---");
    expect(formatLap(-5)).toBe("--:--.---");
  });
});
