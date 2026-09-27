import { describe, it, expect } from "vitest";
import { outlineOf } from "../src/track/outline.ts";
import { tracks } from "../src/track/tracks.ts";
import type { TrackDef } from "../src/track/Track.ts";

/** Every coordinate in an SVG path's data. */
const coords = (d: string): number[][] =>
  [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [+m[1], +m[2]]);

describe("track outlines for the menu", () => {
  it("fit every track, road and all, inside the thumbnail box", () => {
    for (const def of tracks) {
      const o = outlineOf(def, 64, 44);
      const pts = coords(o.d);
      expect(pts.length, def.name).toBeGreaterThan(20);
      expect(pts.length, def.name).toBeLessThanOrEqual(64);
      for (const [x, y] of pts) {
        expect(x - o.road / 2, def.name).toBeGreaterThanOrEqual(-0.1);
        expect(x + o.road / 2, def.name).toBeLessThanOrEqual(64.1);
        expect(y - o.road / 2, def.name).toBeGreaterThanOrEqual(-0.1);
        expect(y + o.road / 2, def.name).toBeLessThanOrEqual(44.1);
      }
      expect(o.d.endsWith("Z")).toBe(true);
      // The start dot sits where the path begins: the start line.
      expect(pts[0]).toEqual([o.start.x, o.start.y]);
    }
  });

  it("keeps the road legible however big the track", () => {
    const huge: TrackDef = {
      ...tracks[0],
      centerLine: tracks[0].centerLine.map((p) => ({
        x: p.x * 20,
        y: p.y * 20,
      })),
    };
    expect(outlineOf(huge, 64, 44).road).toBeGreaterThanOrEqual(2.5);
  });

  it("copes with a track with no centerline", () => {
    expect(outlineOf({ ...tracks[0], centerLine: [] }, 64, 44).d).toBe("");
  });
});
