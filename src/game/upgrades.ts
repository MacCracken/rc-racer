import { KMH_PER_PX_S, type CarStats } from "../core/tuning.ts";

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
        120,
        { accel: 25, maxSpeed: 12 },
        "Sharper throttle response + a little top end.",
      ),
      t(
        "Turbo manifold",
        240,
        { accel: 30, maxSpeed: 16 },
        "More power across the rev band.",
      ),
      t(
        "Forced induction",
        420,
        { accel: 35, maxSpeed: 22 },
        "Real top-end and acceleration gains.",
      ),
      t(
        "Racing ECU",
        700,
        { accel: 40, maxSpeed: 30 },
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
        { grip: 0.03, braking: 20 },
        "More grip, a touch more stopping.",
      ),
      t(
        "Slicks",
        300,
        { grip: 0.04, braking: 25 },
        "Higher cornering grip, better braking.",
      ),
      t(
        "Semi-slick racing",
        520,
        { grip: 0.05, braking: 30 },
        "Big cornering advantage.",
      ),
      t(
        "Prototype slicks",
        820,
        { grip: 0.06, braking: 35 },
        "Maximum mechanical grip.",
      ),
    ],
  },
  {
    id: "brakes",
    name: "Brakes",
    tiers: [
      t("Vented discs", 110, { braking: 25 }, "Shorter stopping distance."),
      t("Big-bore calipers", 220, { braking: 30 }, "Corner-entry speed up."),
      t("Carbon brakes", 380, { braking: 40 }, "Slam on without lockup."),
      t(
        "Race-spec rotors",
        600,
        { braking: 55 },
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
        { turnRate: 0.4 },
        "Tighter response, less body.",
      ),
      t(
        "Coilovers",
        260,
        { turnRate: 0.5, grip: 0.01 },
        "Faster, flatter through corners.",
      ),
      t(
        "Adaptive dampers",
        460,
        { turnRate: 0.6, grip: 0.02 },
        "Planted and quick.",
      ),
      t("Semi-active", 720, { turnRate: 0.7, grip: 0.03 }, "Maximum turn-in."),
    ],
  },
  {
    id: "chassis",
    name: "Chassis / Weight",
    tiers: [
      t(
        "Stripped interior",
        130,
        { accel: 10, turnRate: 0.2 },
        "Lighter = quicker off the line.",
      ),
      t(
        "Alloy arms",
        280,
        { accel: 12, turnRate: 0.25, braking: 10 },
        "Balance gains across the board.",
      ),
      t(
        "Carbon tub",
        500,
        { accel: 16, turnRate: 0.35, braking: 15 },
        "Lighter + stronger, faster everywhere.",
      ),
      t(
        "Full carbon",
        780,
        { accel: 20, turnRate: 0.45, braking: 20 },
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
      t("E-brake", 100, { handbrakeGrip: -0.002 }, "Initiate slides on demand."),
      t(
        "Differential",
        240,
        { handbrakeGrip: -0.002, grip: 0.01 },
        "Cleaner, controlled oversteer.",
      ),
      t(
        "Drift diff",
        440,
        { handbrakeGrip: -0.002, grip: 0.015 },
        "Hold a long slide.",
      ),
      t(
        "LSD + setup",
        680,
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
  absMax: number;
  /** Lower is better (less handbrake grip = a longer drift). */
  invert?: boolean;
}[] = [
  { key: "maxSpeed", label: "Top speed", absMax: 360 },
  { key: "accel", label: "Acceleration", absMax: 260 },
  { key: "grip", label: "Grip", absMax: 0.4 },
  { key: "braking", label: "Braking", absMax: 400 },
  { key: "turnRate", label: "Handling", absMax: 5.5 },
  { key: "handbrakeGrip", label: "Drift", absMax: 0.05, invert: true },
];
export function statBars(stats: CarStats): StatBar[] {
  return STAT_META.map((m) => {
    const ratio = Math.min(1, Math.max(0, stats[m.key] / m.absMax));
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

function applyDelta(stats: CarStats, delta: Partial<CarStats>): CarStats {
  const out: CarStats = { ...stats };
  for (const key of Object.keys(delta) as (keyof CarStats)[]) {
    out[key] = (out[key] as number) + (delta[key] as number);
  }
  return out;
}
