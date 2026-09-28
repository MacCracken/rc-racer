import { KMH_PER_PX_S, type CarStats } from "../core/tuning.ts";
import { carClasses } from "./cars.ts";

/**
 * Upgrade tree, data-driven. Each *slot* (a component family) has a stack of
 * *tiers*; buying tier n gives you its `statDelta` on top of the base and of any
 * tiers below it. Costs rise with tier, forcing the "fund the thing that moves
 * your lap time most" decision — the heart of the depth.
 *
 * Every family maps onto the physics-validated CarStats knobs, so installing an
 * upgrade *visibly* changes the car's behavior.
 */
export type SlotId =
  "engine" | "tires" | "brakes" | "suspension" | "chassis" | "aero" | "drift";

export interface UpgradeTier {
  name: string;
  cost: number;
  /** Deltas applied to CarStats (only the fields that matter). */
  statDelta: Partial<CarStats>;
  description: string;
}

export interface UpgradeSlot {
  id: SlotId;
  name: string;
  tiers: UpgradeTier[];
}

/** `owned[slot]` = how many tiers you own in that slot (0..tier count). */
export type OwnedUpgrades = Record<SlotId, number>;

export const SLOTS: SlotId[] = [
  "engine",
  "tires",
  "brakes",
  "suspension",
  "chassis",
  "aero",
  "drift",
];

const t = (
  name: string,
  cost: number,
  statDelta: Partial<CarStats>,
  description: string,
): UpgradeTier => ({ name, cost, statDelta, description });

const empty: OwnedUpgrades = {
  engine: 0,
  tires: 0,
  brakes: 0,
  suspension: 0,
  chassis: 0,
  aero: 0,
  drift: 0,
};

export function freshUpgrades(): OwnedUpgrades {
  return { ...empty };
}

export function maxTierFor(slot: SlotId): number {
  const s = UPGRADE_TREE.find((x) => x.id === slot);
  return s ? s.tiers.length : 0;
}

export const UPGRADE_TREE: UpgradeSlot[] = [
  {
    id: "engine",
    name: "Engine",
    tiers: [
      t(
        "Dual-sport mapping",
        150,
        { accel: 15, maxSpeed: 6 },
        "Sharper throttle response + a little top end.",
      ),
      t(
        "Turbo manifold",
        300,
        { accel: 20, maxSpeed: 8 },
        "More power across the rev band.",
      ),
      t(
        "Forced induction",
        520,
        { accel: 25, maxSpeed: 10 },
        "Real top-end and acceleration gains.",
      ),
      t(
        "Racing ECU",
        850,
        { accel: 30, maxSpeed: 12 },
        "Serious launch + top speed.",
      ),
    ],
  },
  {
    id: "tires",
    name: "Tires",
    tiers: [
      t(
        "Soft compound",
        140,
        { grip: 0.03, braking: 20, accel: 5 },
        "More grip: quicker through corners, a touch more stopping.",
      ),
      t(
        "Slicks",
        300,
        { grip: 0.04, braking: 25, accel: 5 },
        "Higher cornering grip, better braking.",
      ),
      t(
        "Semi-slick racing",
        520,
        { grip: 0.05, braking: 30, accel: 8 },
        "Big cornering advantage.",
      ),
      t(
        "Prototype slicks",
        820,
        { grip: 0.06, braking: 35, accel: 10 },
        "Maximum mechanical grip.",
      ),
    ],
  },
  {
    id: "brakes",
    name: "Brakes",
    tiers: [
      t(
        "Vented discs",
        110,
        { braking: 25, grip: 0.01 },
        "Shorter stops, steadier into corners.",
      ),
      t(
        "Big-bore calipers",
        220,
        { braking: 30, grip: 0.015 },
        "Corner-entry speed up.",
      ),
      t(
        "Carbon brakes",
        380,
        { braking: 40, grip: 0.02 },
        "Slam on without lockup.",
      ),
      t(
        "Race-spec rotors",
        600,
        { braking: 55, grip: 0.025 },
        "Brake later, carry more speed.",
      ),
    ],
  },
  {
    id: "suspension",
    name: "Suspension",
    tiers: [
      t(
        "Stiffer springs",
        120,
        { turnRate: 0.4, grip: 0.01 },
        "Tighter response, less body roll.",
      ),
      t(
        "Coilovers",
        260,
        { turnRate: 0.5, grip: 0.02 },
        "Faster, flatter through corners.",
      ),
      t(
        "Adaptive dampers",
        460,
        { turnRate: 0.6, grip: 0.03 },
        "Planted and quick.",
      ),
      t("Semi-active", 720, { turnRate: 0.7, grip: 0.04 }, "Maximum turn-in."),
    ],
  },
  {
    id: "chassis",
    name: "Chassis / Weight",
    tiers: [
      t(
        "Stripped interior",
        130,
        { accel: 12, turnRate: 0.2, grip: 0.01 },
        "Lighter = quicker off the line and into corners.",
      ),
      t(
        "Alloy arms",
        280,
        { accel: 15, turnRate: 0.25, braking: 10, grip: 0.015 },
        "Balance gains across the board.",
      ),
      t(
        "Carbon tub",
        500,
        { accel: 18, turnRate: 0.35, braking: 15, grip: 0.02 },
        "Lighter + stronger, faster everywhere.",
      ),
      t(
        "Full carbon",
        780,
        { accel: 22, turnRate: 0.45, braking: 20, grip: 0.025 },
        "Featherweight race chassis.",
      ),
    ],
  },
  {
    id: "aero",
    name: "Aerodynamics",
    tiers: [
      t(
        "Front splitter",
        150,
        { grip: 0.02, drag: -0.02 },
        "Downforce at speed; less drag.",
      ),
      t(
        "Side skirts",
        300,
        { grip: 0.03, drag: -0.03 },
        "Stability through fast corners.",
      ),
      t("Rear wing", 500, { grip: 0.04, drag: -0.04 }, "Big high-speed bite."),
      t(
        "Full aero kit",
        800,
        { grip: 0.06, drag: -0.05 },
        "Glued to the track at speed.",
      ),
    ],
  },
  {
    id: "drift",
    name: "Drift Kit",
    tiers: [
      t(
        "E-brake",
        80,
        { handbrakeGrip: -0.002, grip: 0.01 },
        "Initiate slides on demand.",
      ),
      t(
        "Differential",
        180,
        { handbrakeGrip: -0.002, grip: 0.01 },
        "Cleaner, controlled oversteer.",
      ),
      t(
        "Drift diff",
        320,
        { handbrakeGrip: -0.002, grip: 0.015 },
        "Hold a long slide.",
      ),
      t(
        "LSD + setup",
        520,
        { handbrakeGrip: -0.002, grip: 0.02 },
        "Maximum drift control.",
      ),
    ],
  },
];

/** Sum all owned tiers of every slot onto the base (cumulative). */
export function applyBuild(base: CarStats, owned: OwnedUpgrades): CarStats {
  let out: CarStats = { ...base };
  for (const slot of UPGRADE_TREE) {
    const count = owned[slot.id] ?? 0;
    for (let k = 0; k < count; k++) {
      const delta = slot.tiers[k]?.statDelta;
      if (delta === undefined) continue;
      out = applyDelta(out, delta);
    }
  }
  return out;
}

/** Cost to buy the *next* tier in a slot, or null if none left / already maxed. */
export function nextTier(
  slot: SlotId,
  owned: OwnedUpgrades,
): UpgradeTier | null {
  const s = UPGRADE_TREE.find((x) => x.id === slot);
  if (s === undefined) return null;
  const count = owned[slot] ?? 0;
  const next = s.tiers[count];
  return next === undefined ? null : next;
}

/** Total credits currently invested in `owned`. */
export function totalInvested(owned: OwnedUpgrades): number {
  let sum = 0;
  for (const slot of UPGRADE_TREE) {
    const count = owned[slot.id] ?? 0;
    for (let k = 0; k < count; k++) sum += slot.tiers[k]?.cost ?? 0;
  }
  return sum;
}

/** A human-readable "stat bars" summary for the UI (0..1 normalized per stat). */
export interface StatBar {
  key: keyof CarStats;
  label: string;
  value: number;
  norm: number;
  /** Readout: km/h for top speed, else a 0-100 rating (raw grip is ~0.2). */
  text: string;
}
const STAT_META: {
  key: keyof CarStats;
  label: string;
  /** Lower is better (less handbrake grip = a longer drift). */
  invert?: boolean;
}[] = [
  { key: "maxSpeed", label: "Top speed" },
  { key: "accel", label: "Acceleration" },
  { key: "grip", label: "Grip" },
  { key: "braking", label: "Braking" },
  { key: "turnRate", label: "Handling" },
  { key: "handbrakeGrip", label: "Drift", invert: true },
];

/** Handbrake grip that would read as a full Drift bar (none at all is 0). */
const DRIFT_SCALE = 0.05;

/** Every slot at its top tier: the most a car can be built up. */
export function fullBuild(): OwnedUpgrades {
  const owned = freshUpgrades();
  for (const s of UPGRADE_TREE) owned[s.id] = s.tiers.length;
  return owned;
}

let scales: Partial<Record<keyof CarStats, number>> | null = null;

/**
 * A bar's full scale: the best any car class reaches fully built. So 100 means
 * "the best build in the game", and no bar tops out while an upgrade that
 * raises it is still for sale — a full bar would hide that purchase.
 */
function barScale(key: keyof CarStats): number {
  if (key === "handbrakeGrip") return DRIFT_SCALE;
  if (scales === null) {
    const built = carClasses.map((c) => applyBuild(c.base, fullBuild()));
    scales = {};
    for (const m of STAT_META)
      scales[m.key] = Math.max(...built.map((s) => s[m.key]));
  }
  return scales[key] ?? 1;
}

export function statBars(stats: CarStats): StatBar[] {
  return STAT_META.map((m) => {
    const ratio = Math.min(1, Math.max(0, stats[m.key] / barScale(m.key)));
    const norm = m.invert ? 1 - ratio : ratio;
    return {
      key: m.key,
      label: m.label,
      value: stats[m.key],
      norm,
      text:
        m.key === "maxSpeed"
          ? `${Math.round(stats.maxSpeed * KMH_PER_PX_S)} km/h`
          : String(Math.round(norm * 100)),
    };
  });
}

/** How one stat bar moves between two builds: the garage's upgrade preview. */
export interface StatGain {
  key: keyof CarStats;
  label: string;
  /** Bar fill before and after, 0..1. */
  from: number;
  to: number;
  /** The change as the bars read it: "+7 km/h" for top speed, else "+8". */
  text: string;
}

/**
 * The stat bars that change from `before` to `after` (e.g. the car now and
 * with the next tier fitted). Differences are taken between the *displayed*
 * readouts, so the preview always matches what the bars show once bought.
 */
export function statGains(before: CarStats, after: CarStats): StatGain[] {
  const now = statBars(before);
  const next = statBars(after);
  const out: StatGain[] = [];
  now.forEach((bar, i) => {
    const kmh = bar.key === "maxSpeed";
    const d = kmh
      ? Math.round(after.maxSpeed * KMH_PER_PX_S) -
        Math.round(before.maxSpeed * KMH_PER_PX_S)
      : Math.round(next[i].norm * 100) - Math.round(bar.norm * 100);
    if (d === 0) return;
    out.push({
      key: bar.key,
      label: bar.label,
      from: bar.norm,
      to: next[i].norm,
      text: `${d > 0 ? "+" : "−"}${Math.abs(d)}${kmh ? " km/h" : ""}`,
    });
  });
  return out;
}

function applyDelta(stats: CarStats, delta: Partial<CarStats>): CarStats {
  const out: CarStats = { ...stats };
  for (const key of Object.keys(delta) as (keyof CarStats)[]) {
    out[key] = (out[key] as number) + (delta[key] as number);
  }
  return out;
}
