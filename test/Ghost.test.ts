import { describe, it, expect } from "vitest";
import {
  recordLap,
  sampleGhost,
  makeGhost,
  capGhost,
  MAX_GHOST_POINTS,
  type Ghost,
  type GhostPoint,
} from "../src/race/Ghost.ts";

function lineGhost(): Ghost {
  // A straight line from (0,0) to (100,0), sampled at t=0 and t=1000.
  return makeGhost([
    { t: 0, x: 0, y: 0, heading: 0 },
    { t: 1000, x: 100, y: 0, heading: 0 },
  ] as GhostPoint[]);
}

describe("Ghost — best-lap record + replay", () => {
  it("clamps to the ends outside the recorded span", () => {
    const g = lineGhost();
    expect(sampleGhost(g, -500)).toEqual({ x: 0, y: 0, heading: 0 });
    expect(sampleGhost(g, 5000)).toEqual({ x: 100, y: 0, heading: 0 });
  });

  it("linearly interpolates x/y between bracketing frames", () => {
    const p = sampleGhost(lineGhost(), 500);
    expect(p!.x).toBeCloseTo(50, 6);
    expect(p!.y).toBeCloseTo(0, 6);
  });

  it("returns exact values on a stored frame", () => {
    const g = lineGhost();
    expect(sampleGhost(g, 0)).toEqual({ x: 0, y: 0, heading: 0 });
    expect(sampleGhost(g, 1000)).toEqual({ x: 100, y: 0, heading: 0 });
  });

  it("returns null for an empty ghost", () => {
    expect(sampleGhost([], 5)).toBeNull();
  });

  it("records a lap from raw samples, lap-relative in time", () => {
    const g = recordLap(
      [
        { ms: 1000, x: 0, y: 0, dx: 1, dy: 0 },
        { ms: 1500, x: 50, y: 0, dx: 1, dy: 0 },
        { ms: 2000, x: 100, y: 0, dx: 1, dy: 0 },
      ],
      1000,
    );
    expect(g[0].t).toBe(0); // 1000 - 1000
    expect(g[2].t).toBe(1000); // 2000 - 1000
    const mid = sampleGhost(g, 500);
    expect(mid!.x).toBeCloseTo(50, 6);
  });

  it("derive heading from sample direction", () => {
    const g = recordLap(
      [
        { ms: 0, x: 0, y: 0, dx: 0, dy: 1 }, // moving +y
        { ms: 100, x: 0, y: 1, dx: 0, dy: 1 },
      ],
      0,
    );
    expect(g[0].heading).toBeCloseTo(Math.PI / 2, 6);
  });

  it("capGhost thins evenly to the cap, keeping both ends in order", () => {
    const long = makeGhost(
      Array.from({ length: 5000 }, (_, i) => ({
        t: i * 10,
        x: i,
        y: 0,
        heading: 0,
      })),
    );
    const g = capGhost(long, 100);
    expect(g.length).toBe(100);
    expect(g[0].t).toBe(0);
    expect(g[99].t).toBe(49990);
    for (let i = 1; i < g.length; i++) expect(g[i].t).toBeGreaterThan(g[i - 1].t);
    expect(capGhost(lineGhost(), 100)).toEqual(lineGhost()); // short: untouched
  });

  it("recordLap never stores more than MAX_GHOST_POINTS frames (a slow lap can't bloat the save)", () => {
    const samples = Array.from({ length: 10_000 }, (_, i) => ({
      ms: i * 8,
      x: i,
      y: 0,
      dx: 1,
      dy: 0,
    }));
    expect(recordLap(samples, 0).length).toBe(MAX_GHOST_POINTS);
  });

  it("makeGhost sorts by time and drops duplicate times", () => {
    const g = makeGhost([
      { t: 100, x: 1, y: 1, heading: 0 },
      { t: 0, x: 2, y: 2, heading: 0 },
      { t: 100, x: 9, y: 9, heading: 0 }, // dup time -> dropped
    ]);
    expect(g[0].t).toBe(0);
    expect(g.length).toBe(2);
  });
});
