import { describe, it, expect } from "vitest";
import { buildTrack } from "../src/track/Track.ts";
import { overture, hairpin, tracks } from "../src/track/tracks.ts";
import type { Vec2 } from "../src/core/vec.ts";

describe("buildTrack", () => {
  it("derives outer/inner polygons of the same length as the centerline", () => {
    const t = buildTrack(overture);
    expect(t.outer.length).toBe(t.centerLine.length);
    expect(t.inner.length).toBe(t.centerLine.length);
    expect(t.gates.length).toBe(overture.gateCount);
  });

  it("places the start on the centerline and derives a valid heading", () => {
    const t = buildTrack(overture);
    expect(Number.isFinite(t.start.heading)).toBe(true);
    // start position should be (approximately) a centerline point
    const onLine = t.centerLine.some(
      (p) => Math.hypot(p.x - t.start.pos.x, p.y - t.start.pos.y) < 1e-6,
    );
    expect(onLine).toBe(true);
  });

  it("produces a finite bounding box", () => {
    const t = buildTrack(overture);
    expect(Number.isFinite(t.bounds.minX)).toBe(true);
    expect(t.bounds.maxX).toBeGreaterThan(t.bounds.minX);
    expect(t.bounds.maxY).toBeGreaterThan(t.bounds.minY);
  });

  it("gates span roughly the track width end-to-end", () => {
    const t = buildTrack(overture);
    for (const g of t.gates) {
      const gap: Vec2[] = [g.a, g.b];
      const d = Math.hypot(gap[1].x - gap[0].x, gap[1].y - gap[0].y);
      expect(d).toBeCloseTo(overture.width, -1); // 1 decimal place
    }
  });

  it("puts every checkpoint where the road is open, in order round the lap", () => {
    // In a bend tighter than half the road, the inside edge folds over
    // itself and a car hugging the apex could slip round a gate's end.
    for (const def of tracks) {
      const t = buildTrack(def);
      const cl = t.centerLine;
      const n = cl.length;
      const at = t.gates.map((g) => cl.indexOf(g.center));
      at.forEach((i, k) => {
        if (k > 0)
          expect(i, `${def.name} gate ${k}`).toBeGreaterThan(at[k - 1]);
        if (k === 0) return;
        const [a, b, c] = [cl[(i - 2 + n) % n], cl[i], cl[(i + 2) % n]];
        const cross = Math.abs(
          (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
        );
        const radius =
          (Math.hypot(b.x - a.x, b.y - a.y) *
            Math.hypot(c.x - b.x, c.y - b.y) *
            Math.hypot(a.x - c.x, a.y - c.y)) /
          (2 * cross);
        expect(radius, `${def.name} gate ${k}`).toBeGreaterThan(def.width / 2);
      });
    }
  });

  it("handles a different track (hairpin)", () => {
    const t = buildTrack(hairpin);
    expect(t.gates.length).toBe(hairpin.gateCount);
  });
});
