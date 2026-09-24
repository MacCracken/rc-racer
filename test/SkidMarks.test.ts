import { describe, it, expect } from "vitest";
import {
  createSkid,
  sampleDrift,
  ageMarks,
  visibleCount,
  MAX_MARKS,
  SKID_LIFETIME,
  type BodyLike,
} from "../src/core/SkidMarks.ts";

/** A tiny kinematics-only stand-in for a Matter body. */
function bodyFrom(
  x: number,
  y: number,
  angle: number,
  vx: number,
  vy: number,
): BodyLike {
  void angle;
  return { position: { x, y }, angle, velocity: { x: vx, y: vy } };
}

const O = { carLength: 30, carWidth: 16, maxSpeed: 200 } as const;

describe("SkidMarks.sampleDrift", () => {
  it("lays nothing when the car is not sliding", () => {
    const s = createSkid();
    // Fast and straight: velocity is pure forward, ~zero lateral.
    const added = sampleDrift(s, bodyFrom(0, 0, 0, 200, 0), O);
    expect(added).toBe(0);
    expect(visibleCount(s)).toBe(0);
  });

  it("lays two rear-wheel marks when sliding sideways", () => {
    const s = createSkid();
    // Heading 0 (along +x) but strong +y velocity = a big sideways slip.
    const added = sampleDrift(s, bodyFrom(0, 0, 0, 120, 150), O);
    expect(added).toBe(2);
    expect(s.marks[0]!.alpha).toBe(1);
    expect(s.marks[1]!.alpha).toBe(1);
  });

  it("does not lay marks when moving too slowly", () => {
    const s = createSkid();
    // Sideways but crawl-slow: below minSpeedFrac.
    const added = sampleDrift(s, bodyFrom(0, 0, 0, 4, 6), O);
    expect(added).toBe(0);
  });

  it("splits the two marks across the rear axle by the car width", () => {
    const s = createSkid();
    sampleDrift(s, bodyFrom(10, 5, 0, 80, 90), O);
    const [a, b] = s.marks;
    // Both near the rear axle, one ahead of the other along the lateral axis.
    expect(a!.x).toBeCloseTo(10 - 15, 1);
    expect(b!.x).toBeCloseTo(10 - 15, 1);
    expect(a!.y - b!.y).toBeCloseTo(16, 1);
  });
});

describe("SkidMarks.ageMarks", () => {
  it("drops every mark after one lifetime", () => {
    const s = createSkid();
    sampleDrift(s, bodyFrom(0, 0, 0, 120, 150), O);
    expect(visibleCount(s)).toBe(2);
    ageMarks(s, SKID_LIFETIME);
    expect(visibleCount(s)).toBe(0);
  });

  it("fades alpha toward zero across partial lifetimes", () => {
    const s = createSkid();
    sampleDrift(s, bodyFrom(0, 0, 0, 120, 150), O);
    const alpha0 = s.marks[0]!.alpha;
    ageMarks(s, SKID_LIFETIME / 2);
    expect(s.marks[0]!.alpha).toBeLessThan(alpha0);
    expect(s.marks[0]!.alpha).toBeGreaterThan(0);
  });

  it("a non-positive dt leaves the trail untouched", () => {
    const s = createSkid();
    sampleDrift(s, bodyFrom(0, 0, 0, 120, 150), O);
    ageMarks(s, 0);
    expect(visibleCount(s)).toBe(2);
  });

  it("ages in place, reusing the buffer (GC-friendly, no per-frame alloc)", () => {
    const s = createSkid();
    // Mixed alphas so some marks fade this step and some survive.
    s.marks.push({ x: 0, y: 0, angle: 0, alpha: 0.9 });
    s.marks.push({ x: 1, y: 0, angle: 0, alpha: 0.1 });
    s.marks.push({ x: 2, y: 0, angle: 0, alpha: 0.8 });
    const before = s.marks;
    ageMarks(s, SKID_LIFETIME * 0.6);
    // Same array reference: the trail compacts in place rather than via a fresh
    // allocation each step — the GC-friendliness the hot path relies on.
    expect(s.marks).toBe(before);
    // Survivors kept in original order; faded marks dropped.
    expect(s.marks.length).toBe(2);
    expect(s.marks[0]!.alpha).toBeCloseTo(0.3, 5);
    expect(s.marks[1]!.alpha).toBeCloseTo(0.2, 5);
   });
});

describe("SkidMarks buffer cap", () => {
  it("never exceeds MAX_MARKS", () => {
    const s = createSkid();
    for (let i = 0; i < MAX_MARKS + 50; i++)
      sampleDrift(s, bodyFrom(0, 0, 0, 120, 150), O);
    expect(visibleCount(s)).toBeLessThanOrEqual(MAX_MARKS);
    // And it keeps the most recent marks (front of the trail).
    expect(s.marks[0]!.alpha).toBe(1);
  });
});
