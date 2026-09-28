/**
 * A whole race run headless: the field, grid, car contact and autopilots the
 * game races (`stepField`, `rivalField`), with the player's car on an
 * autopilot too — its `pace` standing in for a driver's skill. For balance
 * tests and tuning scripts, so they measure the race the game actually runs.
 */
import { FIXED_DT, type CarStats } from "../core/tuning.ts";
import { createArena, stepField } from "../physics/MatterCar.ts";
import { buildTrack, type TrackDef } from "../track/Track.ts";
import { rivalField } from "../game/rivals.ts";
import { makeDriver } from "./AiDriver.ts";
import { RaceState } from "./RaceState.ts";

export interface SimOptions {
  /** The player autopilot's pace, 0..1. */
  pace: number;
  /** Rivals in the field (default 3, as in the game). */
  rivals?: number;
  /** The player's contact mass (default 1). */
  mass?: number;
  /** Give up after this much race time (s). */
  capS?: number;
}

export interface SimResult {
  finished: boolean;
  /** Where the player finished (1 = won), ranked as the game ranks it. */
  position: number;
  /** Race time at the player's finish (ms; Infinity if it didn't). */
  finishMs: number;
  bestLapMs: number;
  /** How many steps the player's car was pressed against another. */
  bumps: number;
  /** Longest any car sat crawling (under 25 px/s) once off the grid (ms). */
  longestStallMs: number;
}

/** A car slower than this (px/s) once the race is going is stalled. */
const STALL_SPEED = 25;

export function simulateRace(
  def: TrackDef,
  player: CarStats,
  opts: SimOptions,
): SimResult {
  const track = buildTrack(def);
  const arena = createArena(track, player, rivalField(def, opts.rivals ?? 3), {
    mass: opts.mass,
  });
  let clock = 0;
  const now = (): number => clock;
  const cars = arena.cars.map((c) => ({
    body: c.body,
    race: new RaceState(track, now),
    drive: makeDriver(track, {
      pace: c.isPlayer ? opts.pace : (c.pace ?? 0.8),
      lookahead: 0.05,
      lane: c.lane,
      car: c.stats,
    }),
    traffic: arena.cars.filter((o) => o !== c).map((o) => o.body),
  }));
  const me = cars[0];
  let bumps = 0;
  let longestStallMs = 0;
  const stalled = cars.map(() => 0);
  const cap = (opts.capS ?? 240) / FIXED_DT;
  for (let s = 0; s < cap && !me.race.finished; s++) {
    clock += FIXED_DT * 1000;
    const prev = cars.map((k) => ({
      x: k.body.position.x,
      y: k.body.position.y,
    }));
    const inputs = cars.map((k) => ({ ...k.drive(k.body, k.traffic) }));
    const hits = stepField(arena, inputs, FIXED_DT);
    cars.forEach((k, i) => {
      k.race.update(prev[i], k.body.position, k.body.angle);
      const v = Math.hypot(k.body.velocity.x, k.body.velocity.y);
      stalled[i] =
        clock > 2000 && v < STALL_SPEED ? stalled[i] + FIXED_DT * 1000 : 0;
      longestStallMs = Math.max(longestStallMs, stalled[i]);
    });
    bumps += hits.contacts.filter((c) => c.a === 0 || c.b === 0).length;
  }
  const mine = me.race.progress(me.body.position);
  const ahead = cars
    .slice(1)
    .filter((k) =>
      me.race.finished
        ? k.race.finished && k.race.finishMs < me.race.finishMs
        : k.race.finished || k.race.progress(k.body.position) > mine,
    ).length;
  return {
    finished: me.race.finished,
    position: ahead + 1,
    finishMs: me.race.finishMs,
    bestLapMs: me.race.bestLapMs,
    bumps,
    longestStallMs,
  };
}
