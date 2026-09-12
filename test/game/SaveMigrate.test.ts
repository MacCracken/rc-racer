import { describe, it, expect } from "vitest";
import { migrate, newSave } from "../../src/game/save.ts";

/**
 * Save-migration is exercised here because bestGhosts is a new field (v2).
 * migrate() must: (a) tolerate a v1 save that has no bestGhosts, and
 * (b) repair a corrupt ghost timeline without throwing.
 */
describe("Save migration — schema bump (v1 -> v2)", () => {
  it("fills a missing bestGhosts from a v1 save with an empty map", () => {
    const v1 = {
      version: 1,
      credits: 42,
      ownedCars: ["street-sedan"],
      upgrades: {},
      bestLaps: { overture: 5000 },
      selectedCar: "street-sedan",
      selectedTrack: "overture",
      clearedTracks: [],
    };
    const out = migrate(v1);
    expect(out.version).toBe(2);
    expect(out.bestGhosts).toEqual({}); // safe default, no crash
    expect(out.credits).toBe(42); // other fields survive
  });

  it("keeps a valid ghost timeline (ascending, deduped)", () => {
    const ghost = [
      { t: 0, x: 1, y: 2, heading: 0 },
      { t: 100, x: 3, y: 4, heading: 0.5 },
      { t: 200, x: 5, y: 6, heading: 0.9 },
    ];
    const out = migrate({
      version: 2,
      credits: 0,
      bestLaps: {},
      bestGhosts: { overture: ghost },
      ownedCars: [],
      upgrades: {},
      clearedTracks: [],
      selectedCar: "street-sedan",
      selectedTrack: "overture",
    });
    expect(out.bestGhosts.overture).toBeDefined();
    expect(out.bestGhosts.overture?.length).toBe(3);
  });

  it("repairs a corrupt ghost timeline (drops junk, no throw)", () => {
    const junk = [
      { t: "nope", x: 1, y: 2 }, // bad t
      42, // not an object
      null, // null
      { t: 150, x: NaN, y: 1 }, // NaN x
      { t: 100, x: 1, y: 1, heading: 1.2 }, // good
      { t: 100, x: 9, y: 9 }, // duplicate time -> dropped
      { t: 50, x: 2, y: 2 }, // good, earlier
    ];
    const out = migrate({
      bestGhosts: { overture: junk },
    });
    const g = out.bestGhosts.overture ?? [];
    // Only the 2 valid, distinct, ascending points survive.
    expect(g.map((p) => p.t)).toEqual([50, 100]);
    expect(g[0].x).toBe(2);
    expect(g[1].x).toBe(1);
  });

  it("null / non-object input migrates to a fresh save (v2)", () => {
    expect(migrate(null).version).toBe(2);
    expect(migrate("garbage").version).toBe(2);
    expect(migrate({}).version).toBe(2);
    // A brand-new save is always schema-current.
    expect(newSave().version).toBe(2);
  });
});
