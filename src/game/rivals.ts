/**
 * The AI field for a track. Rival strength is a property of the *track* (its
 * `rivals` entry: a car class + an upgrade tier), never of the player's car,
 * so upgrading your own car genuinely pulls you ahead of the field, and later
 * tracks bring stronger rivals. Pure: no DOM, no physics.
 */
import type { TrackDef } from "../track/Track.ts";
import type { CarStats } from "../core/tuning.ts";
import { carById, defaultCar, type CarClass } from "./cars.ts";
import { applyBuild, freshUpgrades, maxTierFor, SLOTS } from "./upgrades.ts";

/** A track that doesn't say races stock street sedans. */
const DEFAULT_RIVALS = { car: "street-sedan", tier: 0, factor: 1 };

/** The car class the rivals drive on `def`. */
export function rivalCarFor(def: TrackDef): CarClass {
  return carById(def.rivals?.car ?? DEFAULT_RIVALS.car) ?? defaultCar;
}

/**
 * Stats of the strongest rival's car on `def`: the rival class with `tier`
 * upgrades in every slot, scaled by `factor`. The rest of the field runs a
 * touch below this (see `rivalField`).
 */
export function rivalStatsFor(def: TrackDef): CarStats {
  const r = { ...DEFAULT_RIVALS, ...def.rivals };
  const owned = freshUpgrades();
  for (const slot of SLOTS)
    owned[slot] = Math.min(maxTierFor(slot), Math.max(0, Math.floor(r.tier)));
  const s = applyBuild({ ...rivalCarFor(def).base }, owned);
  const f = r.factor ?? 1;
  return { ...s, maxSpeed: s.maxSpeed * f, accel: s.accel * f, grip: s.grip * f };
}

/**
 * The whole field: `count` rivals, spread a little in car and pace so they
 * string out legibly, the last one being the track's full-strength rival.
 */
export function rivalField(
  def: TrackDef,
  count: number,
): { stats: CarStats; pace: number }[] {
  const top = rivalStatsFor(def);
  const basePace = def.aiPace ?? 0.78;
  return Array.from({ length: count }, (_, i) => {
    const f = count <= 1 ? 1 : 0.95 + (0.05 * i) / (count - 1);
    return {
      stats: {
        ...top,
        maxSpeed: top.maxSpeed * f,
        accel: top.accel * f,
        grip: top.grip * f,
      },
      pace: Math.min(0.98, basePace + (i - 1) * 0.05),
    };
  });
}

/** Short menu label for who you'll race: "vs 1/10 Buggy +1". */
export function rivalLabel(def: TrackDef): string {
  const tier = Math.max(0, Math.floor(def.rivals?.tier ?? 0));
  return `vs ${rivalCarFor(def).name}${tier > 0 ? ` +${tier}` : ""}`;
}
