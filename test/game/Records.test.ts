import { describe, it, expect } from "vitest";
import { Records } from "../../src/game/records.ts";
import { Progression } from "../../src/game/progression.ts";
import { tracks } from "../../src/track/tracks.ts";

/** A save with laps on Overture (and so Hairpin open). */
function raced(): Progression {
  const prog = Progression.fresh();
  for (const [ms, carId] of [
    [18000, "street-sedan"],
    [14000, "buggy"],
  ] as const)
    prog.recordRace({
      trackId: "overture",
      carId,
      laps: 3,
      bestLapMs: ms,
      finished: true,
      at: Date.UTC(2026, 8, 26),
    });
  return prog;
}

describe("the Records screen", () => {
  it("shows a board per open track, fastest first, with the car", () => {
    const view = new Records().view(raced(), tracks);
    expect(view.tracks.map((t) => t.id)).toEqual(["overture", "hairpin"]);
    const [overture, hairpin] = view.tracks;
    expect(overture.laps.map((l) => [l.time, l.car])).toEqual([
      ["0:14.000", "1/10 Buggy"],
      ["0:18.000", "Street Sedan"],
    ]);
    expect(overture.laps[0].date).not.toBe("");
    expect(overture.outline?.d).toMatch(/^M/);
    expect(hairpin.laps).toEqual([]);
  });

  it("marks a lap from an older save's record, car and day unknown", () => {
    const prog = Progression.fresh();
    prog.data.records.overture = [{ ms: 17000, car: "", at: 0 }];
    const [lap] = new Records().view(prog, tracks).tracks[0].laps;
    expect(lap).toEqual({ time: "0:17.000", car: "—", date: "" });
  });

  it("with no clipboard, offers the line to copy by hand — until reopened", () => {
    const records = new Records();
    const prog = raced();
    let shown = 0;
    records.share(
      prog,
      tracks,
      "overture",
      () => true,
      () => shown++,
    );
    expect(shown).toBe(1);
    const view = records.view(prog, tracks);
    expect(view.copied).toBeNull();
    expect(view.byHand).toEqual({
      id: "overture",
      text: "RC Racer · Overture: 0:14.000 in the 1/10 Buggy. Beat it?",
    });
    records.reset();
    expect(records.view(prog, tracks).byHand).toBeNull();
  });

  it("does nothing once the screen has gone, or for a board with no laps", () => {
    const records = new Records();
    let shown = 0;
    records.share(
      raced(),
      tracks,
      "overture",
      () => false,
      () => shown++,
    );
    records.share(
      raced(),
      tracks,
      "hairpin",
      () => true,
      () => shown++,
    );
    expect(shown).toBe(0);
    expect(records.view(raced(), tracks).byHand).toBeNull();
  });
});
