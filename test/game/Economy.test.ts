import { describe, it, expect } from "vitest";
import {
  applyBuild,
  freshUpgrades,
  UPGRADE_TREE,
} from "../../src/game/upgrades.ts";
import { computeReward } from "../../src/game/economy.ts";
import { carClasses } from "../../src/game/cars.ts";

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
          if (slot.tiers[i].statDelta[k] !== undefined) moved = true;
        }
      }
      expect(moved).toBe(true);
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
      60,
    );
    expect(
      Number.isFinite(
        computeReward({ parLapMs: par, bestLapMs: 1, lapsCompleted: 3 }),
      ),
    ).toBe(true);
  });
});
