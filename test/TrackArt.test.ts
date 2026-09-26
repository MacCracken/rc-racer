import { describe, it, expect } from "vitest";
import {
  CURB_WIDTH,
  distToCenterLine,
  foliageFor,
  hashString,
  rng,
  sceneryFor,
} from "../src/core/trackArt.ts";
import { shade } from "../src/core/theme.ts";
import { buildTrack } from "../src/track/Track.ts";
import { tracks } from "../src/track/tracks.ts";

/**
 * The pure half of the track/car art: scenery placement (must never sit on
 * the road, must be the same every visit) and the colour shading helper.
 */

describe("scenery placement", () => {
  it("every item on every track is clear of the road and of each other", () => {
    for (const def of tracks) {
      const track = buildTrack(def);
      const items = sceneryFor(track);
      expect(items.length, def.name).toBeGreaterThan(10);
      const roadEdge = track.width / 2 + CURB_WIDTH / 2;
      for (const it of items) {
        // A tyre stack is three tyres in a row (reaching 3r from its centre).
        const reach = it.kind === "tires" ? it.r * 3 : it.r;
        expect(
          distToCenterLine(track.centerLine, it),
          `${def.name}: ${it.kind} on the road`,
        ).toBeGreaterThanOrEqual(roadEdge + reach);
      }
      for (let i = 0; i < items.length; i++)
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i];
          const b = items[j];
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.r + b.r);
        }
    }
  });

  it("is the same every time a track is visited", () => {
    const track = buildTrack(tracks[0]);
    expect(sceneryFor(track)).toEqual(sceneryFor(buildTrack(tracks[0])));
  });

  it("seeds deterministically", () => {
    const a = rng(hashString("overture"));
    const b = rng(hashString("overture"));
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
    expect(hashString("overture")).not.toBe(hashString("hairpin"));
  });

  it("picks foliage to suit the ground: green on grass, olive on dirt", () => {
    expect(foliageFor("#0c1d12")).toBe("#3e7d3a"); // Overture's grass
    expect(foliageFor("#1a140a")).not.toBe("#3e7d3a"); // Dust Bowl's dirt
  });
});

describe("shade", () => {
  it("lightens toward white and darkens toward black", () => {
    expect(shade("#808080", 1)).toBe("#ffffff");
    expect(shade("#808080", -1)).toBe("#000000");
    expect(shade("#808080", 0)).toBe("#808080");
    expect(shade("#204060", 0.5)).toBe("#90a0b0");
    expect(shade("#204060", -0.5)).toBe("#102030");
  });

  it("passes anything that isn't #rrggbb through untouched", () => {
    expect(shade("red", 0.5)).toBe("red");
    expect(shade("#abc", 0.5)).toBe("#abc");
  });
});
