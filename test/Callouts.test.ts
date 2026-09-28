import { describe, it, expect } from "vitest";
import { lapCallout, WRONG_WAY_MS, WrongWay } from "../src/race/Callouts.ts";
import { RaceState } from "../src/race/RaceState.ts";
import { buildTrack } from "../src/track/Track.ts";
import { overture } from "../src/track/tracks.ts";

/** A race that has banked `laps` (ms each), as `RaceState` would. */
function after(laps: number[]): RaceState {
  const race = new RaceState(buildTrack(overture), () => 0);
  race.lap = laps.length;
  race.lapTimesMs = [...laps];
  race.lastLapMs = laps[laps.length - 1] ?? 0;
  race.bestLapMs = Math.min(...laps);
  return race;
}

describe("lap callouts", () => {
  it("each lap closed calls out the next and the time just done", () => {
    const c = lapCallout(after([17500]), 3, Infinity, 1234)!;
    expect(c).toEqual({
      title: "LAP 2",
      detail: "0:17.500",
      tone: "lap",
      atMs: 1234,
    });
  });

  it("names the final lap, and a lap faster than every one before as best", () => {
    const slower = lapCallout(after([17500, 17900]), 3, Infinity, 0)!;
    expect(slower.title).toBe("FINAL LAP");
    expect(slower.tone).toBe("final");
    expect(slower.detail).toBe("0:17.900");
    const faster = lapCallout(after([17500, 17200]), 3, Infinity, 0)!;
    expect(faster.detail).toBe("0:17.200 · Best lap");
    expect(faster.tone).toBe("best");
  });

  it("a lap under the track's record is a new record, even the first", () => {
    const first = lapCallout(after([16900]), 3, 17000, 0)!;
    expect(first.detail).toBe("0:16.900 · New record!");
    expect(first.tone).toBe("record");
    // Faster than the old record but not than this race's best: just a lap.
    expect(lapCallout(after([16500, 16800]), 4, 17000, 0)!.tone).toBe("lap");
  });

  it("nothing before a lap is done, or at the flag", () => {
    expect(lapCallout(after([]), 3, Infinity, 0)).toBeNull();
    const done = after([17500, 17400, 17300]);
    done.finished = true;
    expect(lapCallout(done, 3, Infinity, 0)).toBeNull();
  });
});

describe("the wrong-way warning", () => {
  const L = 3000;
  const step = 1000 / 120;

  /** Drive `ms` at `perStep` px along the lap (negative = the wrong way). */
  function run(w: WrongWay, from: number, perStep: number, ms: number) {
    let arc = from;
    let shown = false;
    for (let t = 0; t < ms; t += step) {
      arc = (arc + perStep + L) % L;
      shown = w.update(arc, L, step, 150);
    }
    return { arc, shown };
  }

  it("goes up after most of a second heading back round the lap", () => {
    const w = new WrongWay();
    expect(run(w, 500, -1.2, WRONG_WAY_MS - 100).shown).toBe(false);
    expect(run(w, 400, -1.2, 200).shown).toBe(true);
  });

  it("clears once the car heads the right way again", () => {
    const w = new WrongWay();
    const { arc } = run(w, 500, -1.2, WRONG_WAY_MS + 300);
    expect(run(w, arc, 1.2, 600).shown).toBe(false);
  });

  it("racing on across the start line isn't the wrong way", () => {
    const w = new WrongWay();
    expect(run(w, L - 100, 1.5, 2000).shown).toBe(false);
  });

  it("a crawl backwards (easing off a wall) doesn't count", () => {
    const w = new WrongWay();
    let shown = false;
    for (let t = 0, arc = 500; t < 2000; t += step, arc -= 0.1)
      shown = w.update(arc, L, step, 10);
    expect(shown).toBe(false);
  });
});
