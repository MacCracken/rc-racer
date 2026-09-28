/**
 * scripts/career.ts — a whole career, simulated.
 *
 * A driver on the autopilot races the ladder from a fresh save as the game
 * runs it (the real field, grid, contact and `Progression`): the furthest
 * open track until a podium there opens the next, then the tracks not yet
 * won. Between races they spend their credits by one of three habits. For
 * each, it reports the race on which each track was first cleared and first
 * won, so what a tuning change does to the whole progression shows at a
 * glance:
 *
 *   npm run verify:career           # an average driver (pace 0.85)
 *   npm run verify:career -- 0.95   # a quicker one
 *
 * The driver's pace wanders a little from race to race, as a person's does
 * (seeded, so a run repeats exactly). Fails if a habit can't clear every
 * track: a gate nobody gets through.
 */
import { tracks } from "../src/track/tracks.ts";
import type { TrackDef } from "../src/track/Track.ts";
import { carById, carClasses, type CarClass } from "../src/game/cars.ts";
import { Progression } from "../src/game/progression.ts";
import {
  nextTier,
  totalInvested,
  UPGRADE_TREE,
  type SlotId,
} from "../src/game/upgrades.ts";
import { simulateRace } from "../src/race/simulate.ts";

/** A career stops here even if there's still a race to win. */
const MAX_RACES = 150;
/** Rivals in the field, as in the game. */
const RIVALS = 3;
/** The driver's pace wanders this far either way from race to race. */
const PACE_WANDER = 0.15;
/** The "mixed" habit spends this much on parts for a car before saving. */
const MIXED_BUDGET = 400;
const SEED = 12345;

/** A small seeded random source (mulberry32): the same run every time. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The cheapest car not yet owned, if any. */
function nextCar(prog: Progression): CarClass | undefined {
  return [...carClasses]
    .sort((a, b) => a.cost - b.cost)
    .find((c) => !prog.isCarOwned(c.id));
}

/** Buy the cheapest next part for the car being driven, if it's affordable. */
function buyCheapestPart(prog: Progression): boolean {
  const car = prog.selectedCarId;
  let best: { slot: SlotId; cost: number } | null = null;
  for (const s of UPGRADE_TREE) {
    const tier = nextTier(s.id, prog.upgradesFor(car));
    if (tier !== null && (best === null || tier.cost < best.cost))
      best = { slot: s.id, cost: tier.cost };
  }
  return best !== null && prog.buyUpgrade(car, best.slot);
}

/** How a player spends their credits between races. */
interface Habit {
  name: string;
  spend(prog: Progression): void;
}

const HABITS: Habit[] = [
  {
    // Every credit toward the next car; parts only once they're all owned.
    name: "Saves for cars",
    spend(prog) {
      for (;;) {
        const next = nextCar(prog);
        if (next !== undefined) {
          if (!prog.unlockCar(next.id)) return;
        } else if (!buyCheapestPart(prog)) return;
      }
    },
  },
  {
    // Some parts for each car, then saves for the next one.
    name: "Mixed",
    spend(prog) {
      for (;;) {
        const next = nextCar(prog);
        if (next !== undefined && prog.unlockCar(next.id)) continue;
        const invested = totalInvested(prog.upgradesFor(prog.selectedCarId));
        if (next !== undefined && invested >= MIXED_BUDGET) return;
        if (!buyCheapestPart(prog)) return;
      }
    },
  },
  {
    // Never buys a car: everything goes on the one it starts with.
    name: "Starter car only",
    spend(prog) {
      while (buyCheapestPart(prog));
    },
  },
];

/** How one career went. */
interface Career {
  /** Race number each track was first cleared (a podium) and first won. */
  clearedOn: Map<string, number>;
  wonOn: Map<string, number>;
  races: number;
  earned: number;
  /** The car it ended in. */
  car: string;
}

/** Where a player goes next: the track to clear, then the ones to win. */
function nextTrack(
  prog: Progression,
  wonOn: Map<string, number>,
): TrackDef | undefined {
  return (
    tracks.find(
      (t, i) => prog.isTrackUnlocked(i) && !prog.isTrackCleared(t.id),
    ) ?? tracks.find((t) => !wonOn.has(t.id))
  );
}

function career(habit: Habit, pace: number): Career {
  const prog = Progression.fresh();
  const wander = seeded(SEED);
  const clearedOn = new Map<string, number>();
  const wonOn = new Map<string, number>();
  let earned = 0;
  let races = 0;
  for (let def = nextTrack(prog, wonOn); def !== undefined;) {
    if (races === MAX_RACES) break;
    races += 1;
    prog.selectTrack(def.id);
    const carId = prog.selectedCarId;
    const drive = pace + (wander() * 2 - 1) * PACE_WANDER;
    const r = simulateRace(def, prog.resolveStats(carId), {
      pace: Math.max(0, Math.min(1, drive)),
      rivals: RIVALS,
      mass: carById(carId)?.mass,
    });
    const outcome = prog.recordRace({
      trackId: def.id,
      carId,
      laps: def.laps,
      bestLapMs: r.bestLapMs,
      finished: r.finished,
      position: r.position,
      fieldSize: RIVALS + 1,
    });
    earned += outcome.creditsEarned;
    if (outcome.cleared && !clearedOn.has(def.id)) clearedOn.set(def.id, races);
    if (r.finished && r.position === 1 && !wonOn.has(def.id))
      wonOn.set(def.id, races);
    habit.spend(prog);
    def = nextTrack(prog, wonOn);
  }
  const car = carById(prog.selectedCarId)?.name ?? prog.selectedCarId;
  return { clearedOn, wonOn, races, earned, car };
}

const arg = process.argv[2];
const pace = arg === undefined ? 0.85 : Number(arg);
if (!(pace > 0 && pace <= 1)) {
  console.error(`The driver's pace is 0..1 (got "${arg}").`);
  process.exit(2);
}

const careers = HABITS.map((h) => career(h, pace));

const COL = 20;
const left = (s: string, n: number): string => s.padEnd(n);
const right = (s: string, n: number): string => s.padStart(n);
const race = (n: number | undefined): string =>
  n === undefined ? "–" : String(n);
const row = (label: string, cells: string[]): string =>
  (left(label, 16) + cells.map((c) => left(c, COL)).join("")).trimEnd();

console.log(
  `A career, simulated: a driver at pace ${pace} (±${PACE_WANDER} a race), ` +
    `at most ${MAX_RACES} races.`,
);
console.log(
  "The race each track was first cleared (a podium, which opens the next) and first won.\n",
);
console.log(
  row(
    "",
    HABITS.map((h) => h.name),
  ),
);
console.log(
  row(
    "",
    HABITS.map(() => `${right("clear", 5)}  ${right("won", 5)}`),
  ),
);
for (const t of tracks)
  console.log(
    row(
      t.name,
      careers.map(
        (c) =>
          `${right(race(c.clearedOn.get(t.id)), 5)}  ${right(race(c.wonOn.get(t.id)), 5)}`,
      ),
    ),
  );
console.log("");
console.log(
  row(
    "Races",
    careers.map((c) => right(String(c.races), 5)),
  ),
);
console.log(
  row(
    "Credits a race",
    careers.map((c) => right(String(Math.round(c.earned / c.races)), 5)),
  ),
);
console.log(
  row(
    "Ends in",
    careers.map((c) => c.car),
  ),
);

const stuck = HABITS.filter((_, i) =>
  tracks.some((t) => !careers[i].clearedOn.has(t.id)),
);
if (stuck.length > 0) {
  console.log(
    `\n--- stuck before the end of the ladder: ${stuck.map((h) => h.name).join(", ")} ---`,
  );
  process.exit(1);
}
console.log("\n--- every habit clears every track ---");
