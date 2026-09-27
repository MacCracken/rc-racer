/**
 * Track conditions: what the road is (tarmac or dirt), the weather (clear or
 * rain) and the light (day or night). Terrain and weather are stat tradeoffs,
 * applied to every car on the track — player and rivals alike — so a wet
 * race asks the same of the whole field; night changes only what you can see.
 * Pure: the renderer reads the same `Conditions` to dress the track.
 */
import type { CarStats } from "../core/tuning.ts";
import type { Lighting, Terrain, TrackDef, Weather } from "./Track.ts";

export interface Conditions {
  terrain: Terrain;
  weather: Weather;
  lighting: Lighting;
}

/** A track's conditions, with the defaults filled in. */
export function conditionsOf(def: TrackDef): Conditions {
  return {
    terrain: def.terrain ?? "tarmac",
    weather: def.weather ?? "clear",
    lighting: def.lighting ?? "day",
  };
}

/** Per-stat multipliers (a missing stat is unchanged). */
export type StatScale = Partial<Record<keyof CarStats, number>>;

/**
 * Loose, rutted dirt: the tyres bite less, so less grip, longer handbrake
 * slides and softer braking, with wheelspin off the line and a lower top end.
 */
export const DIRT: StatScale = {
  grip: 0.78,
  handbrakeGrip: 0.75,
  braking: 0.82,
  accel: 0.9,
  maxSpeed: 0.94,
};

/**
 * Standing water: grip and braking fall away (brake early), the car slides
 * more readily, and the launch is a touch softer. Top speed is untouched.
 */
export const RAIN: StatScale = {
  grip: 0.6,
  handbrakeGrip: 0.75,
  braking: 0.65,
  accel: 0.92,
};

function scales(c: Conditions): StatScale[] {
  const out: StatScale[] = [];
  if (c.terrain === "dirt") out.push(DIRT);
  if (c.weather === "rain") out.push(RAIN);
  return out;
}

/** `stats` as they drive in `c`: the conditions' multipliers, composed. */
export function applyConditions(stats: CarStats, c: Conditions): CarStats {
  const out: CarStats = { ...stats };
  for (const scale of scales(c))
    for (const key of Object.keys(scale) as (keyof CarStats)[])
      out[key] *= scale[key]!;
  return out;
}

/** Short tags for the menu, e.g. ["Dirt", "Night"]; none for dry tarmac by day. */
export function conditionTags(c: Conditions): string[] {
  const tags: string[] = [];
  if (c.terrain === "dirt") tags.push("Dirt");
  if (c.weather === "rain") tags.push("Rain");
  if (c.lighting === "night") tags.push("Night");
  return tags;
}
