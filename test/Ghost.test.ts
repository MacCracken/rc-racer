import { describe, it, expect } from "vitest";
import {
  recordLap,
  sampleGhost,
  makeGhost,
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
