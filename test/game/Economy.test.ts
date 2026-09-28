import { describe, it, expect } from "vitest";
import {
  applyBuild,
  freshUpgrades,
  fullBuild,
  statBars,
  statGains,
  UPGRADE_TREE,
  type SlotId,
} from "../../src/game/upgrades.ts";
import {
  computeReward,
  FINISH_PAY,
  LAP_PAY,
  podiumBonus,
  rewardParts,
  PODIUM_BONUS,
} from "../../src/game/economy.ts";
import { carClasses } from "../../src/game/cars.ts";
import type { CarStats } from "../../src/core/tuning.ts";

describe("Upgrades", () => {
  it("applyBuild is a no-op on a fresh build", () => {
    const s = applyBuild(carClasses[0].base, freshUpgrades());
    expect(s.maxSpeed).toBe(carClasses[0].base.maxSpeed);
    expect(s.grip).toBe(carClasses[0].base.grip);
  });

  it("an engine upgrade raises top speed and acceleration", () => {
    const owned = freshUpgrades();
    owned.engine = 1;
    const s = applyBuild(carClasses[0].base, owned);
    expect(s.maxSpeed).toBeGreaterThan(carClasses[0].base.maxSpeed);
    expect(s.accel).toBeGreaterThan(carClasses[0].base.accel);
  });

  it("higher tiers cost more than lower tiers (every slot)", () => {
    for (const slot of UPGRADE_TREE) {
      for (let i = 1; i < slot.tiers.length; i++) {
        expect(slot.tiers[i].cost).toBeGreaterThan(slot.tiers[i - 1].cost);
      }
    }
  });

  it("every non-aero family moves at least one physics knob", () => {
    const families: {
      id: string;
      keys: (keyof import("../../src/core/tuning.ts").CarStats)[];
    }[] = [
      { id: "engine", keys: ["maxSpeed", "accel"] },
      { id: "tires", keys: ["grip", "braking"] },
      { id: "brakes", keys: ["braking"] },
      { id: "suspension", keys: ["turnRate"] },
      { id: "chassis", keys: ["accel", "turnRate", "braking"] },
      { id: "aero", keys: ["grip"] },
      { id: "drift", keys: ["handbrakeGrip"] },
    ];
    for (const f of families) {
      const slot = UPGRADE_TREE.find((x) => x.id === f.id)!;
      let moved = false;
      for (let i = 0; i < slot.tiers.length && !moved; i++) {
        for (const k of f.keys) {
          if (slot.tiers[i].statDelta![k] !== undefined) moved = true;
        }
      }
      expect(moved).toBe(true);
    }
  });
});

describe("Drift Kit", () => {
  it("every tier makes handbrake slides run farther (lower handbrake grip), never frictionless", () => {
    const drift = UPGRADE_TREE.find((s) => s.id === "drift")!;
    for (const car of carClasses) {
      let prev = car.base.handbrakeGrip;
      for (let k = 1; k <= drift.tiers.length; k++) {
        const owned = freshUpgrades();
        owned.drift = k;
        const hg = applyBuild(car.base, owned).handbrakeGrip;
        expect(hg, `${car.id} tier ${k}`).toBeLessThan(prev);
        expect(hg, `${car.id} tier ${k}`).toBeGreaterThan(0);
        prev = hg;
      }
    }
  });
});

describe("Upgrade effectiveness (no no-op tiers)", () => {
  // A tier is a "no-op upgrade" if buying it leaves every resolved stat
  // unchanged — the kind of dead purchase the tuning pass must catch.
  const statKeys: (keyof CarStats)[] = [
    "maxSpeed",
    "accel",
    "braking",
    "drag",
    "turnRate",
    "grip",
    "handbrakeGrip",
  ];

  it("every tier of every slot changes at least one resolved stat", () => {
    for (const car of carClasses) {
      for (const slot of UPGRADE_TREE) {
        let prev = applyBuild(car.base, freshUpgrades());
        for (let k = 1; k < slot.tiers.length; k++) {
          const owned = freshUpgrades();
          owned[slot.id] = k;
          const next = applyBuild(car.base, owned);
          let moved = false;
          for (const key of statKeys)
            if (Math.abs(next[key] - prev[key]) > 1e-9) moved = true;
          if (!moved)
            throw new Error(
              `${car.id}/${slot.id} tier ${k} is a no-op upgrade`,
            );
          prev = next;
        }
      }
    }
  });
});

describe("Economy", () => {
  const par = 4000;
  it("a faster best lap earns more than a slower one (monotonic)", () => {
    const fast = computeReward({
      parLapMs: par,
      bestLapMs: 3000,
      lapsCompleted: 3,
    });
    const med = computeReward({
      parLapMs: par,
      bestLapMs: 3800,
      lapsCompleted: 3,
    });
    expect(fast).toBeGreaterThan(med);
  });

  it("awards at least the base payout to anyone who finishes", () => {
    const r = computeReward({
      parLapMs: par,
      bestLapMs: 9999,
      lapsCompleted: 3,
    });
    expect(r).toBeGreaterThanOrEqual(60);
  });

  it("more laps completed pays a little more", () => {
    const a = computeReward({
      parLapMs: par,
      bestLapMs: par,
      lapsCompleted: 3,
    });
    const b = computeReward({
      parLapMs: par,
      bestLapMs: par,
      lapsCompleted: 5,
    });
    expect(b).toBeGreaterThanOrEqual(a);
  });

  it("rewards are finite for degenerate input", () => {
    expect(computeReward({ parLapMs: 0, bestLapMs: 0, lapsCompleted: 0 })).toBe(
      FINISH_PAY,
    );
    expect(
      Number.isFinite(
        computeReward({ parLapMs: par, bestLapMs: 1, lapsCompleted: 3 }),
      ),
    ).toBe(true);
  });
});

describe("Economy — podium bonus and the reward's parts", () => {
  it("pays the podium (P1 most), nothing off it or when racing alone", () => {
    expect(podiumBonus(1, 4)).toBe(PODIUM_BONUS[0]);
    expect(podiumBonus(1, 4)).toBeGreaterThan(podiumBonus(2, 4));
    expect(podiumBonus(2, 4)).toBeGreaterThan(podiumBonus(3, 4));
    expect(podiumBonus(3, 4)).toBeGreaterThan(0);
    expect(podiumBonus(4, 4)).toBe(0);
    expect(podiumBonus(1, 1)).toBe(0); // no field, no race to win
    expect(podiumBonus(0, 4)).toBe(0);
    expect(podiumBonus(1.5, 4)).toBe(0);
  });

  it("rewardParts sums to computeReward, the pace part only below par", () => {
    for (const best of [3000, 3800, 4000, 5000, Infinity, -1]) {
      const inp = { parLapMs: 4000, bestLapMs: best, lapsCompleted: 3 };
      const { base, pace } = rewardParts(inp);
      expect(base + pace).toBe(computeReward(inp));
      expect(base).toBe(FINISH_PAY + 3 * LAP_PAY);
      if (!(best > 0 && best < 4000)) expect(pace).toBe(0);
      else expect(pace).toBeGreaterThan(0);
    }
  });
});

describe("Upgrade preview — what a purchase does to the bars", () => {
  const sedan = carClasses.find((c) => c.id === "street-sedan")!.base;
  const withTier = (slot: SlotId, n: number): CarStats => {
    const owned = freshUpgrades();
    owned[slot] = n;
    return applyBuild(sedan, owned);
  };

  it("names just the bars a tier moves, in the units the bars read", () => {
    const after = withTier("engine", 1);
    const gains = statGains(sedan, after);
    expect(gains.map((g) => g.key)).toEqual(["maxSpeed", "accel"]);
    expect(gains[0].text).toBe("+4 km/h"); // 108 -> 112 km/h on the speedo
    const read = (s: CarStats) =>
      Number(statBars(s).find((b) => b.key === "accel")!.text);
    expect(gains[1].text).toBe(`+${read(after) - read(sedan)}`);
    expect(gains[1].to).toBeGreaterThan(gains[1].from);
  });

  it("counts a longer slide (less handbrake grip) as a Drift gain", () => {
    const gains = statGains(sedan, withTier("drift", 1));
    expect(gains.map((g) => g.label)).toEqual(["Grip", "Drift"]);
    for (const g of gains) expect(g.text).toMatch(/^\+\d+$/);
  });

  it("every tier visibly moves a bar, even on a car built up everywhere else", () => {
    // A bar that tops out early hides every later purchase that raises it.
    for (const car of carClasses) {
      for (const slot of UPGRADE_TREE) {
        const owned = fullBuild();
        for (let k = 1; k <= slot.tiers.length; k++) {
          owned[slot.id] = k - 1;
          const before = applyBuild(car.base, owned);
          owned[slot.id] = k;
          const gains = statGains(before, applyBuild(car.base, owned));
          expect(
            gains.length,
            `${car.id} ${slot.id} tier ${k}`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it("a fully built car fills its best bars, and no bar overflows", () => {
    for (const car of carClasses) {
      for (const bar of statBars(applyBuild(car.base, fullBuild()))) {
        expect(bar.norm).toBeGreaterThan(0);
        expect(bar.norm).toBeLessThanOrEqual(1);
      }
    }
  });
});
