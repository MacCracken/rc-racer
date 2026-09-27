import { describe, it, expect } from "vitest";
import { buildSplits, ghostTimeAt } from "../src/race/Split.ts";
import { makeGhost, type GhostPoint } from "../src/race/Ghost.ts";
import { RaceState } from "../src/race/RaceState.ts";
import { buildTrack } from "../src/track/Track.ts";
import { hairpin } from "../src/track/tracks.ts";
import { createCarWorld, stepCar } from "../src/physics/MatterCar.ts";
import { makeDriver } from "../src/race/AiDriver.ts";
import { defaultCarStats, FIXED_DT } from "../src/core/tuning.ts";

/**
 * Splits index a ghost lap by distance along the track, so "how far ahead or
 * behind am I?" compares like with like: the time the ghost reached *this*
 * point. A 1-D loop (arc = x wrapped to [0, L)) keeps the math checkable.
 */
const L = 1000;
const arcOf = (p: { x: number }): number => ((p.x % L) + L) % L;
const frames = (xs: number[], dt = 100): GhostPoint[] =>
  xs.map((x, i) => ({ t: i * dt, x, y: 0, heading: 0 }));

describe("Splits — a ghost lap indexed by distance", () => {
  it("maps a distance to the time the ghost got there", () => {
    const g = makeGhost(frames([0, 100, 200, 300, 400, 500]));
    const sp = buildSplits(g, arcOf, L);
    expect(ghostTimeAt(sp, 250)).toBeCloseTo(250, 9);
    expect(ghostTimeAt(sp, 500)).toBeCloseTo(500, 9);
  });

  it("stays continuous across the start line (no lap-sized jump)", () => {
    // Opens a hair before the line (arc 995) and closes a hair past it.
    const g = makeGhost(frames([-5, 5, 500, 995, 1005]));
    const sp = buildSplits(g, arcOf, L);
    expect(sp.s[0]).toBeCloseTo(-5, 9);
    expect(sp.s[sp.s.length - 1]).toBeCloseTo(1005, 9);
    expect(ghostTimeAt(sp, 0)).toBeCloseTo(50, 9);
    expect(ghostTimeAt(sp, 1000)).toBeCloseTo(350, 9);
  });

  it("counts the first time a point was reached, ignoring a spin that backs up", () => {
    const g = makeGhost(frames([0, 300, 250, 280, 400, 600]));
    const sp = buildSplits(g, arcOf, L);
    expect(ghostTimeAt(sp, 280)).toBeCloseTo(280 / 3, 6); // on the way out
    for (let i = 1; i < sp.s.length; i++)
      expect(sp.s[i]).toBeGreaterThan(sp.s[i - 1]);
  });

  it("is null outside the recorded span and for an empty ghost", () => {
    const sp = buildSplits(makeGhost(frames([100, 200])), arcOf, L);
    expect(ghostTimeAt(sp, 50)).toBeNull();
    expect(ghostTimeAt(sp, 250)).toBeNull();
    expect(ghostTimeAt(buildSplits([], arcOf, L), 0)).toBeNull();
  });

  it("on a real track, a lap's own frames read back their own times", () => {
    const track = buildTrack(hairpin);
    const { car, walls } = createCarWorld(track);
    let clock = 0;
    const race = new RaceState(track, () => clock);
    const drive = makeDriver(track, { pace: 0.8, lookahead: 0.05 });
    let prev = { x: car.position.x, y: car.position.y };
    for (let i = 0; i < 60 / FIXED_DT && race.lap < 2; i++) {
      stepCar(car, walls, track, drive(car), defaultCarStats, FIXED_DT);
      race.update(prev, car.position, car.angle);
      prev = { x: car.position.x, y: car.position.y };
      clock += FIXED_DT * 1000;
    }
    const ghost = race.bestGhost;
    expect(ghost.length).toBeGreaterThan(100);
    const sp = buildSplits(ghost, (p) => race.arcOf(p), race.lapLength);
    // Mid-lap frames (clear of the line) map straight back to their time.
    for (const f of ghost.slice(20, -20))
      expect(Math.abs(ghostTimeAt(sp, race.arcOf(f))! - f.t)).toBeLessThan(40);
  });
});

describe("RaceState — lap progress", () => {
  it("progress = completed laps + distance into this lap; the line is arc 0", () => {
    const track = buildTrack(hairpin);
    const race = new RaceState(track, () => 0);
    const p = track.centerLine[3];
    expect(race.progress(p)).toBe(
      race.lap * race.lapLength + race.lapProgress(p),
    );
    expect(race.arcOf(track.centerLine[0])).toBe(0);
    expect(race.arcOf(p)).toBeGreaterThan(0);
  });
});
