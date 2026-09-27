import type { CarStats } from "../core/tuning.ts";
import type { CarLook } from "../core/theme.ts";

/**
 * A car class is a _stat vector_: the numbers that feed the physics. This is the
 * seam Phase 1 promised — the Vehicle Model is a pure function of a CarStats, so
 * a new car is just a new row of numbers, no new code.
 */
export interface CarClass {
  id: string;
  name: string;
  /** Short display label shown in the menu (e.g. "Street", "1/10", "1/8"). */
  classLabel: string;
  blurb: string;
  /** Base stat vector; upgrades are deltas applied on top. */
  base: CarStats;
  /** Credits to unlock (0 = owned from the start / free). */
  cost: number;
  /** Body style the renderer draws this class with. */
  look: CarLook;
  /** Engine pitch multiplier (1 = sedan): small motors whine, big ones growl. */
  enginePitch?: number;
}

export const carClasses: CarClass[] = [
  {
    id: "street-sedan",
    name: "Street Sedan",
    classLabel: "Street",
    blurb: "Balanced, forgiving, cheap. The everyday all-rounder.",
    base: {
      maxSpeed: 180,
      accel: 125,
      braking: 250,
      reverseAccel: 70,
      drag: 0.35,
      turnRate: 3.2,
      grip: 0.18,
      handbrakeGrip: 0.024,
    },
    cost: 0,
    look: "sedan",
  },
  {
    id: "buggy",
    name: "1/10 Buggy",
    classLabel: "1/10",
    blurb: "Light and quick with a huge top end — but twitchy and low grip.",
    base: {
      maxSpeed: 245,
      accel: 175,
      braking: 200,
      reverseAccel: 90,
      drag: 0.42,
      turnRate: 4.6,
      grip: 0.12,
      handbrakeGrip: 0.016,
    },
    cost: 500,
    look: "buggy",
    enginePitch: 1.3,
  },
  {
    id: "brawler",
    name: "1/8 Brawler",
    classLabel: "1/8",
    blurb:
      "Heavy, grippy and brutal: huge cornering power and big brakes, but a lower top end.",
    base: {
      maxSpeed: 205,
      accel: 165,
      braking: 320,
      reverseAccel: 80,
      drag: 0.4,
      turnRate: 3.5,
      grip: 0.24,
      handbrakeGrip: 0.032,
    },
    cost: 1200,
    look: "brawler",
    enginePitch: 0.78,
  },
];

/** The free default car, used by the race if none is selected. */
export const defaultCar =
  carClasses.find((c) => c.id === "street-sedan") ?? carClasses[0];

export function carById(id: string): CarClass | undefined {
  return carClasses.find((c) => c.id === id);
}

/** A neutral clone of the base stats (so callers can't mutate the catalog). */
export function freshBase(id: string): CarStats {
  const c = carById(id) ?? defaultCar;
  return { ...c.base };
}
