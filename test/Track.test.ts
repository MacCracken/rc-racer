import { describe, it, expect } from "vitest";
import { buildTrack } from "../src/track/Track.ts";
import { overture, hairpin } from "../src/track/tracks.ts";
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

  it("handles a different track (hairpin)", () => {
    const t = buildTrack(hairpin);
    expect(t.gates.length).toBe(hairpin.gateCount);
  });
});
