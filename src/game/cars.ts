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
  /** How hard it is to shove in a contact (1 = the sedan). */
  mass?: number;
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
    blurb:
      "Light and quick with a big top end — but twitchy, and short of grip in the wet.",
    base: {
      maxSpeed: 225,
      accel: 180,
      braking: 215,
      reverseAccel: 90,
      drag: 0.42,
      turnRate: 4.2,
      grip: 0.145,
      handbrakeGrip: 0.016,
    },
    cost: 500,
    look: "buggy",
    enginePitch: 1.3,
    mass: 0.8,
  },
  {
    id: "brawler",
    name: "1/8 Brawler",
    classLabel: "1/8",
    blurb:
      "Heavy, grippy and brutal: huge cornering grip and big brakes, and it shoves lighter cars aside.",
    base: {
      maxSpeed: 205,
      accel: 175,
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
    mass: 1.4,
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
