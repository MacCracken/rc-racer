import { describe, it, expect } from "vitest";
import { migrate, newSave } from "../../src/game/save.ts";
import { defaultSettings } from "../../src/game/settings.ts";
import { maxTierFor } from "../../src/game/upgrades.ts";
import { MAX_GHOST_POINTS } from "../../src/race/Ghost.ts";

/**
 * Save-migration is exercised here because bestGhosts (v2) and `settings` (v3)
 * are new fields. migrate() must: (a) tolerate a legacy save missing those
 * fields, (b) repair a corrupt ghost timeline / settings without throwing, and
 * (c) stamp every migrated payload schema-current.
 */
describe("Save migration — schema bump (v1 -> v3)", () => {
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
    expect(out.version).toBe(3);
    expect(out.bestGhosts).toEqual({}); // safe default, no crash
    expect(out.settings).toEqual(defaultSettings()); // prefs default, no crash
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

  it("heals a corrupt record: a non-positive best lap is dropped with its ghost", () => {
    // What the stale race clock once saved: a negative "record" (unbeatable)
    // and the empty ghost recorded beside it.
    const out = migrate({
      bestLaps: { overture: -35441.7, hairpin: 12000, clover: null },
      bestGhosts: {
        overture: [],
        hairpin: [
          { t: 0, x: 0, y: 0, heading: 0 },
          { t: 100, x: 1, y: 0, heading: 0 },
        ],
      },
    });
    expect(out.bestLaps.overture).toBeUndefined();
    expect(out.bestGhosts.overture).toBeUndefined();
    expect(out.bestLaps.clover).toBeUndefined();
    expect(out.bestLaps.hairpin).toBe(12000);
    expect(out.bestGhosts.hairpin?.length).toBe(2);
  });

  it("clamps upgrade tiers to whole, in-range counts and drops unknown cars", () => {
    const out = migrate({
      ownedCars: ["street-sedan"],
      upgrades: {
        "street-sedan": { engine: 99, tires: -2, brakes: 1.7, aero: "x", bogus: 3 },
        "no-such-car": { engine: 1 },
      },
    });
    const up = out.upgrades["street-sedan"];
    expect(up.engine).toBe(maxTierFor("engine"));
    expect(up.tires).toBe(0);
    expect(up.brakes).toBe(1);
    expect(up.aero).toBe(0);
    expect(up).not.toHaveProperty("bogus");
    expect(out.upgrades).not.toHaveProperty("no-such-car");
  });

  it("never selects a car that isn't owned (or double-lists an owned one)", () => {
    const out = migrate({
      ownedCars: ["street-sedan", "street-sedan"],
      selectedCar: "brawler",
    });
    expect(out.ownedCars).toEqual(["street-sedan"]);
    expect(out.selectedCar).toBe("street-sedan");
  });

  it("never selects a track that is still locked", () => {
    expect(migrate({ selectedTrack: "slalom", clearedTracks: [] }).selectedTrack).toBe(
      "overture",
    );
    expect(
      migrate({ selectedTrack: "hairpin", clearedTracks: ["overture"] }).selectedTrack,
    ).toBe("hairpin");
  });

  it("caps an oversized stored ghost so it can't crowd the save", () => {
    const pts = Array.from({ length: 5000 }, (_, i) => ({
      t: i * 8,
      x: i,
      y: 0,
      heading: 0,
    }));
    const out = migrate({ bestLaps: { overture: 18000 }, bestGhosts: { overture: pts } });
    expect(out.bestGhosts.overture?.length).toBe(MAX_GHOST_POINTS);
  });

  it("null / non-object input migrates to a fresh save (v3)", () => {
    expect(migrate(null).version).toBe(3);
    expect(migrate("garbage").version).toBe(3);
    expect(migrate({}).version).toBe(3);
    // A brand-new save is always schema-current.
    expect(newSave().version).toBe(3);
  });
});
