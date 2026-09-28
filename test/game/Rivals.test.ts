import { describe, it, expect } from "vitest";
import { tracks } from "../../src/track/tracks.ts";
import type { CarStats } from "../../src/core/tuning.ts";
import { carById } from "../../src/game/cars.ts";
import { applyBuild, fullBuild } from "../../src/game/upgrades.ts";
import {
  FIELD_SPREAD,
  rivalCarFor,
  rivalField,
  rivalLabel,
  rivalStatsFor,
} from "../../src/game/rivals.ts";
import { simulateRace } from "../../src/race/simulate.ts";

/**
 * Rival strength belongs to the track. These pin the data (every track names a
 * real rival car), the field's shape, and the ladder itself, racing the real
 * field (grid, contact, autopilots) with the player's car on an autopilot at
 * a spread of skill: the warm-up is won in the starter car, the fields get
 * stronger as the tracks unlock, and the finale takes a built car to win.
 */

/** Paces standing in for a weaker, an average and a stronger driver. */
const DRIVERS = [0.75, 0.85, 0.95];

/** Where each driver finishes on `trackId` in car `carId` (built or stock). */
function places(trackId: string, carId: string, built = false): number[] {
  const def = tracks.find((t) => t.id === trackId)!;
  const car = carById(carId)!;
  const stats: CarStats = built
    ? applyBuild({ ...car.base }, fullBuild())
    : { ...car.base };
  return DRIVERS.map(
    (pace) => simulateRace(def, stats, { pace, mass: car.mass }).position,
  );
}

describe("rivals come from the track", () => {
  it("every track names a real rival car class", () => {
    for (const def of tracks) {
      expect(def.rivals, def.name).toBeDefined();
      expect(carById(def.rivals!.car), `${def.name} rival car`).toBeDefined();
      expect(rivalCarFor(def).id).toBe(def.rivals!.car);
    }
  });

  it("the field strings out: weakest first, the last at full strength", () => {
    const def = tracks.find((t) => t.id === "riverbend")!;
    const field = rivalField(def, 3);
    expect(field).toHaveLength(3);
    expect(field[2].stats).toEqual(rivalStatsFor(def));
    expect(field[0].stats.maxSpeed).toBeCloseTo(
      field[2].stats.maxSpeed * FIELD_SPREAD,
      9,
    );
    for (let i = 1; i < field.length; i++) {
      expect(field[i].stats.maxSpeed).toBeGreaterThan(
        field[i - 1].stats.maxSpeed,
      );
      expect(field[i].pace).toBeGreaterThan(field[i - 1].pace);
    }
  });

  it("labels who you'll race", () => {
    const clover = tracks.find((t) => t.id === "clover")!;
    const monsoon = tracks.find((t) => t.id === "monsoon")!;
    expect(rivalLabel(clover)).toBe("vs 1/10 Buggy +1");
    expect(rivalLabel(monsoon)).toBe("vs Street Sedan +3");
  });
});

describe("the ladder", () => {
  it("the fields get stronger as the tracks unlock", () => {
    // A field's strength: how much quicker its full-strength rival laps than
    // a stock sedan does, each on its own.
    const sedan = { ...carById("street-sedan")!.base };
    const strength = tracks.map((def) => {
      const mine = simulateRace(def, sedan, { pace: 0.85, rivals: 0 });
      const theirs = simulateRace(def, rivalStatsFor(def), {
        pace: (def.aiPace ?? 0.8) + 0.03,
        rivals: 0,
      });
      return mine.bestLapMs / theirs.bestLapMs;
    });
    expect(strength[0], "the warm-up field is slower than you").toBeLessThan(1);
    // A gentle climb: a breather now and then, never a field much softer
    // than one already beaten.
    for (let i = 1; i < strength.length; i++)
      expect(
        strength[i],
        `${tracks[i].name} after ${tracks[i - 1].name}`,
      ).toBeGreaterThan(Math.max(...strength.slice(0, i)) * 0.9);
    const half = Math.floor(strength.length / 2);
    const mean = (xs: number[]): number =>
      xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(strength.slice(half))).toBeGreaterThan(
      mean(strength.slice(0, half)) * 1.15,
    );
  });

  it("the warm-up is won in the starter car", () => {
    const warmUp = places(tracks[0].id, "street-sedan");
    for (const p of warmUp)
      expect(p, "a podium for every driver").toBeLessThanOrEqual(3);
    expect(warmUp).toContain(1);
  });

  it("the finale takes a built car to win", () => {
    const finale = tracks[tracks.length - 1].id;
    for (const car of ["street-sedan", "buggy", "brawler"])
      expect(places(finale, car), `a stock ${car}`).not.toContain(1);
    expect(places(finale, "brawler", true)).toEqual([1, 1, 1]);
  });

  it("the field races without anyone stalling", () => {
    for (const [track, car] of [
      ["overture", "street-sedan"],
      ["clover", "buggy"],
      ["midnight", "brawler"],
    ]) {
      const def = tracks.find((t) => t.id === track)!;
      const c = carById(car)!;
      const r = simulateRace(def, { ...c.base }, { pace: 0.85, mass: c.mass });
      expect(r.finished, `${track} in the ${car}`).toBe(true);
      // Shunted into a wall, a car backs out in well under a second.
      expect(r.longestStallMs, `${track} in the ${car}`).toBeLessThan(1500);
    }
  });
});
