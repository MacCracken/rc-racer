import { describe, it, expect } from "vitest";
import { Progression } from "../../src/game/progression.ts";
import { MemorySaveStore, newSave, migrate } from "../../src/game/save.ts";
import { recordLap } from "../../src/race/Ghost.ts";

describe("Progression — earn / spend / record", () => {
  it("awards credits for a finished race and beats a record", () => {
    const p = Progression.fresh();
    const before = p.credits;
    const out = p.recordRace({
      trackId: "overture",
      carId: p.selectedCarId,
      laps: 3,
      bestLapMs: 4000,
      finished: true,
    });
    expect(out.creditsEarned).toBeGreaterThan(0);
    expect(p.credits).toBe(before + out.creditsEarned);
    expect(out.newRecord).toBe(true);
    expect(p.isTrackCleared("overture")).toBe(true);
    expect(p.bestLap("overture")).toBe(4000);
  });

  it("stores the best-lap ghost on a new record", () => {
    const p = Progression.fresh();
    const ghost = recordLap(
      [
        { ms: 0, x: 0, y: 0, dx: 1, dy: 0 },
        { ms: 100, x: 10, y: 0, dx: 1, dy: 0 },
        { ms: 200, x: 20, y: 0, dx: 1, dy: 0 },
      ],
      0,
    );
    expect(ghost.length).toBe(3);
    const out = p.recordRace({
      trackId: "overture",
      carId: p.selectedCarId,
      laps: 3,
      bestLapMs: 4000,
      finished: true,
      bestLapGhost: ghost,
    });
    expect(out.newRecord).toBe(true);
    expect(p.ghostFor("overture").length).toBe(3);
    // A slower lap must not clobber the stored ghost.
    const slower = recordLap(
      [
        { ms: 0, x: 0, y: 0, dx: 1, dy: 0 },
        { ms: 80, x: 6, y: 0, dx: 1, dy: 0 },
      ],
      0,
    );
    p.recordRace({
      trackId: "overture",
      carId: "x",
      laps: 3,
      bestLapMs: 9000,
      finished: true,
      bestLapGhost: slower,
    });
    expect(p.ghostFor("overture").length).toBe(3);
  });

  it("does not beat an existing record with a slower lap, but still pays", () => {
    const p = Progression.fresh();
    p.recordRace({
      trackId: "hairpin",
      carId: "x",
      laps: 3,
      bestLapMs: 5000,
      finished: true,
    });
    const credits = p.credits;
    const out = p.recordRace({
      trackId: "hairpin",
      carId: "x",
      laps: 3,
      bestLapMs: 6000,
      finished: true,
    });
    expect(out.newRecord).toBe(false);
    expect(p.bestLap("hairpin")).toBe(5000);
    expect(p.credits).toBeGreaterThan(credits); // still pays for finishing
  });

  it("does not pay or record a non-finished attempt", () => {
    const p = Progression.fresh();
    const out = p.recordRace({
      trackId: "overture",
      carId: "x",
      laps: 0,
      bestLapMs: 0,
      finished: false,
    });
    expect(out.creditsEarned).toBe(0);
    expect(p.isTrackCleared("overture")).toBe(false);
  });

  it("unlocking a car costs its price and selects it", () => {
    const p = Progression.fresh();
    p.setCredits(500);
    expect(p.isCarOwned("buggy")).toBe(false);
    expect(p.unlockCar("buggy")).toBe(true);
    expect(p.isCarOwned("buggy")).toBe(true);
    expect(p.selectedCarId).toBe("buggy");
    expect(p.credits).toBe(0);
  });

  it("cannot unlock a car without enough credits", () => {
    const p = Progression.fresh();
    p.setCredits(100);
    expect(p.unlockCar("buggy")).toBe(false);
    expect(p.credits).toBe(100);
  });

  it("announces a newly affordable car once, on the race that reaches its price", () => {
    const p = Progression.fresh();
    p.setCredits(450); // buggy costs 500
    const race = {
      trackId: "overture",
      carId: "street-sedan",
      laps: 3,
      bestLapMs: 18000,
      finished: true,
    };
    expect(p.recordRace(race).unlockedCar).toBe("buggy");
    expect(p.recordRace(race).unlockedCar).toBeNull(); // already affordable
  });

  it("cannot select (and so race) a car it doesn't own", () => {
    const p = Progression.fresh();
    expect(p.selectCar("brawler")).toBe(false);
    expect(p.selectedCarId).toBe("street-sedan");
    expect(p.selectCar("street-sedan")).toBe(true);
  });

  it("cannot buy upgrades for a car it doesn't own", () => {
    const p = Progression.fresh();
    p.setCredits(1000);
    expect(p.buyUpgrade("buggy", "engine")).toBe(false);
    expect(p.credits).toBe(1000);
  });

  it("a non-positive lap time never becomes the record (nothing could beat it)", () => {
    const p = Progression.fresh();
    p.recordRace({
      trackId: "overture",
      carId: "street-sedan",
      laps: 3,
      bestLapMs: 17000,
      finished: true,
    });
    const out = p.recordRace({
      trackId: "overture",
      carId: "street-sedan",
      laps: 3,
      bestLapMs: -35000,
      finished: true,
      bestLapGhost: [],
    });
    expect(out.newRecord).toBe(false);
    expect(p.bestLap("overture")).toBe(17000);
    expect(out.creditsEarned).toBeGreaterThan(0); // finishing still pays
  });
});

describe("Progression — upgrades", () => {
  it("buys an upgrade, spends credits, and changes resolved stats", () => {
    const p = Progression.fresh();
    p.setCredits(500);
    const statsBefore = p.resolveStats("street-sedan");
    expect(p.buyUpgrade("street-sedan", "engine")).toBe(true);
    const statsAfter = p.resolveStats("street-sedan");
    expect(statsAfter.maxSpeed).toBeGreaterThan(statsBefore.maxSpeed);
    expect(statsAfter.accel).toBeGreaterThan(statsBefore.accel);
    expect(p.credits).toBe(500 - 120); // first engine tier costs 120
  });

  it("cannot buy beyond the last tier", () => {
    const p = Progression.fresh();
    p.setCredits(1e9);
    const car = "street-sedan";
    // Buy every tier, then the next must fail.
    while (p.buyUpgrade(car, "engine")) {
      /* drain */
    }
    expect(p.buyUpgrade(car, "engine")).toBe(false);
  });

  it("a fast buggy has a higher top speed than the sedan", () => {
    const p = Progression.fresh();
    expect(p.resolveStats("buggy").maxSpeed).toBeGreaterThan(
      p.resolveStats("street-sedan").maxSpeed,
    );
  });
});

describe("Progression — save / load round-trip", () => {
  it("persists and reloads state through a store", () => {
    const p = Progression.fresh();
    p.setCredits(600);
    expect(p.unlockCar("buggy")).toBe(true);
    p.recordRace({
      trackId: "overture",
      carId: "buggy",
      laps: 3,
      bestLapMs: 4100,
      finished: true,
    });

    const store = new MemorySaveStore();
    store.save(p.snapshot());
    const p2 = Progression.fromStore(store);

    expect(p2.credits).toBe(p.credits);
    expect(p2.isCarOwned("buggy")).toBe(true);
    expect(p2.bestLap("overture")).toBe(4100);
    expect(p2.selectedTrackId).toBe(p.selectedTrackId);
  });

  it("migrate() salvages a corrupt / partial save into a valid one", () => {
    const m = migrate({ credits: -5, garbage: true }); // negative, junk fields
    expect(m.credits).toBe(0);
    expect(typeof m.version).toBe("number");
    const m2 = migrate(null); // no object
    expect(m2).toEqual(newSave());
  });
});
