import { describe, it, expect } from "vitest";
import { tracks } from "../../src/track/tracks.ts";
import { buildTrack, type TrackDef } from "../../src/track/Track.ts";
import { createArena, stepCar } from "../../src/physics/MatterCar.ts";
import { RaceState } from "../../src/race/RaceState.ts";
import { makeDriver } from "../../src/race/AiDriver.ts";
import { FIXED_DT, type CarStats } from "../../src/core/tuning.ts";
import { carById } from "../../src/game/cars.ts";
import { applyBuild, freshUpgrades, SLOTS } from "../../src/game/upgrades.ts";
import {
  rivalCarFor,
  rivalField,
  rivalLabel,
  rivalStatsFor,
} from "../../src/game/rivals.ts";

/**
 * Rival strength belongs to the track. These pin the data (every track names a
 * real rival car), the field's shape, and the ladder itself: racing the real
 * autopilot, the upgrade level a sedan needs to win never drops as the tracks
 * unlock, so the progression "earn -> upgrade -> beat harder fields" holds.
 */

/** A car with `tier` upgrades in every slot. */
function built(car: string, tier: number): CarStats {
  const owned = freshUpgrades();
  for (const s of SLOTS) owned[s] = tier;
  return applyBuild({ ...carById(car)!.base }, owned);
}

/** Race an autopilot player (pace 0.9) against `def`'s field: its place. */
function placeAgainstField(def: TrackDef, player: CarStats): number {
  const track = buildTrack(def);
  const arena = createArena(track, player, rivalField(def, 3));
  let clock = 0;
  const cars = arena.cars.map((c) => ({
    c,
    race: new RaceState(track, () => clock),
    drive: makeDriver(track, {
      pace: c.isPlayer ? 0.9 : c.pace!,
      lookahead: 0.05,
    }),
    prev: { x: c.body.position.x, y: c.body.position.y },
  }));
  for (let s = 0; s < 150 / FIXED_DT && !cars[0].race.finished; s++) {
    clock += FIXED_DT * 1000;
    for (const k of cars) {
      stepCar(
        k.c.body,
        arena.walls,
        track,
        k.drive(k.c.body),
        k.c.stats,
        FIXED_DT,
      );
      k.race.update(k.prev, k.c.body.position);
      k.prev = { x: k.c.body.position.x, y: k.c.body.position.y };
    }
  }
  const mine = cars[0].race.finishMs;
  return 1 + cars.slice(1).filter((k) => k.race.finishMs < mine).length;
}

describe("rivals come from the track", () => {
  it("every track names a real rival car class", () => {
    for (const def of tracks) {
      expect(def.rivals, def.name).toBeDefined();
      expect(carById(def.rivals!.car), `${def.name} rival car`).toBeDefined();
      expect(rivalCarFor(def).id).toBe(def.rivals!.car);
    }
  });

  it("the field strings out: spread in car and pace, the last at full strength", () => {
    const def = tracks.find((t) => t.id === "riverbend")!;
    const field = rivalField(def, 3);
    expect(field).toHaveLength(3);
    expect(field[2].stats).toEqual(rivalStatsFor(def));
    for (let i = 1; i < field.length; i++) {
      expect(field[i].stats.maxSpeed).toBeGreaterThan(
        field[i - 1].stats.maxSpeed,
      );
      expect(field[i].pace).toBeGreaterThan(field[i - 1].pace);
    }
  });

  it("labels who you'll race", () => {
    const clover = tracks.find((t) => t.id === "clover")!;
    const slalom = tracks.find((t) => t.id === "slalom")!;
    expect(rivalLabel(clover)).toBe("vs 1/10 Buggy");
    expect(rivalLabel(slalom)).toBe("vs Street Sedan +2");
  });

  it("the sedan build needed to win never drops as tracks unlock", () => {
    const needed = tracks.map((def) => {
      for (let tier = 0; tier <= 4; tier++)
        if (placeAgainstField(def, built("street-sedan", tier)) === 1)
          return tier;
      return 5; // unwinnable in a sedan
    });
    expect(needed[0], "the warm-up is winnable in the starter car").toBe(0);
    for (let i = 1; i < needed.length; i++)
      expect(
        needed[i],
        `${tracks[i].name} easier than ${tracks[i - 1].name}`,
      ).toBeGreaterThanOrEqual(needed[i - 1]);
    expect(
      needed[needed.length - 1],
      "the last track needs upgrades",
    ).toBeGreaterThan(0);
    expect(
      Math.max(...needed),
      "every track is winnable in some sedan build",
    ).toBeLessThanOrEqual(4);
  });
});
