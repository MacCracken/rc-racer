import { describe, it, expect } from "vitest";
import {
  migrate,
  newSave,
  RECORDS_KEPT,
  SAVE_VERSION,
} from "../../src/game/save.ts";
import { defaultSettings } from "../../src/game/settings.ts";
import { maxTierFor } from "../../src/game/upgrades.ts";
import { MAX_GHOST_POINTS } from "../../src/race/Ghost.ts";

/**
 * Save-migration is exercised here because bestGhosts (v2), `settings` (v3)
 * and `records` (v4) are new fields. migrate() must: (a) tolerate a legacy save missing those
 * fields, (b) repair a corrupt ghost timeline / settings without throwing, and
 * (c) stamp every migrated payload schema-current.
 */
describe("Save migration — schema bumps (v1 -> current)", () => {
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
    expect(out.version).toBe(SAVE_VERSION);
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
        "street-sedan": {
          engine: 99,
          tires: -2,
          brakes: 1.7,
          aero: "x",
          bogus: 3,
        },
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
    expect(
      migrate({ selectedTrack: "slalom", clearedTracks: [] }).selectedTrack,
    ).toBe("overture");
    expect(
      migrate({ selectedTrack: "hairpin", clearedTracks: ["overture"] })
        .selectedTrack,
    ).toBe("hairpin");
  });

  it("caps an oversized stored ghost so it can't crowd the save", () => {
    const pts = Array.from({ length: 5000 }, (_, i) => ({
      t: i * 8,
      x: i,
      y: 0,
      heading: 0,
    }));
    const out = migrate({
      bestLaps: { overture: 18000 },
      bestGhosts: { overture: pts },
    });
    expect(out.bestGhosts.overture?.length).toBe(MAX_GHOST_POINTS);
  });

  it("null / non-object input migrates to a fresh save (current version)", () => {
    expect(migrate(null).version).toBe(SAVE_VERSION);
    expect(migrate("garbage").version).toBe(SAVE_VERSION);
    expect(migrate({}).version).toBe(SAVE_VERSION);
    // A brand-new save is always schema-current.
    expect(newSave().version).toBe(SAVE_VERSION);
  });
});

describe("Save migration — the ladder can grow", () => {
  it("keeps a cleared track selected even if a new track now precedes it", () => {
    // Clover was cleared, but the track before it (Riverbend) never was —
    // as when a track is slotted into the ladder ahead of one you've raced.
    const out = migrate({ selectedTrack: "clover", clearedTracks: ["clover"] });
    expect(out.selectedTrack).toBe("clover");
  });
});

describe("Save migration — records boards (v4)", () => {
  it("starts a pre-board save's boards from its track records", () => {
    const out = migrate({ version: 3, bestLaps: { overture: 17000 } });
    expect(out.records.overture).toEqual([{ ms: 17000, car: "", at: 0 }]);
  });

  it("repairs a board: drops junk, sorts fastest first, keeps the best few", () => {
    const laps = Array.from({ length: 9 }, (_, i) => ({
      ms: 20000 - i * 100,
      car: "buggy",
      at: 1_700_000_000_000,
    }));
    const out = migrate({
      version: 4,
      records: {
        overture: [
          ...laps,
          { ms: -5, car: "buggy", at: 1 }, // not a lap
          { ms: "fast" }, // not a number
          null,
          { ms: 19000, car: 7, at: "then" }, // repairable
        ],
      },
    });
    const board = out.records.overture;
    expect(board).toHaveLength(RECORDS_KEPT);
    for (let i = 1; i < board.length; i++)
      expect(board[i].ms).toBeGreaterThanOrEqual(board[i - 1].ms);
    // The repairable entry is the fastest lap; its car and date are unknown.
    expect(board[0]).toEqual({ ms: 19000, car: "", at: 0 });
    expect(board[1].ms).toBe(19200);
    expect(board.every((r) => r.ms > 0 && typeof r.car === "string")).toBe(
      true,
    );
  });

  it("keeps the track record on its board even if the board lost it", () => {
    const out = migrate({
      version: 4,
      bestLaps: { hairpin: 11000 },
      records: { hairpin: [{ ms: 12000, car: "brawler", at: 5 }] },
    });
    expect(out.records.hairpin.map((r) => r.ms)).toEqual([11000, 12000]);
  });
});

describe("Save migration — when the ladder or a track changes", () => {
  it("a selected track that's closed now opens on the one to clear before it", () => {
    // Clover followed Riverbend; now Gravel Pit sits between them, uncleared.
    const out = migrate({
      version: 3,
      clearedTracks: ["overture", "hairpin", "riverbend"],
      selectedTrack: "clover",
    });
    expect(out.selectedTrack).toBe("gravel-pit");
  });

  it("drops Dust Bowl records set before it became dirt, and keeps the rest", () => {
    const ghost = [
      { t: 0, x: 0, y: 0, heading: 0 },
      { t: 100, x: 1, y: 0, heading: 0 },
    ];
    const old = migrate({
      version: 3,
      bestLaps: { "dust-bowl": 13600, overture: 17700 },
      bestGhosts: { "dust-bowl": ghost, overture: ghost },
      clearedTracks: ["overture", "dust-bowl"],
    });
    expect(old.bestLaps["dust-bowl"]).toBeUndefined();
    expect(old.bestGhosts["dust-bowl"]).toBeUndefined();
    expect(old.records["dust-bowl"]).toBeUndefined();
    expect(old.clearedTracks).toContain("dust-bowl"); // still cleared
    expect(old.bestLaps.overture).toBe(17700);

    const now = migrate({ version: 4, bestLaps: { "dust-bowl": 14500 } });
    expect(now.bestLaps["dust-bowl"]).toBe(14500); // set on dirt: it stands
  });
});
