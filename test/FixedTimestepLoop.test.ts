import { describe, it, expect } from "vitest";
import { FixedTimestepLoop } from "../src/core/FixedTimestepLoop.ts";
import { FIXED_DT } from "../src/core/tuning.ts";

describe("FixedTimestepLoop", () => {
  it("runs no steps when less than one fixed dt elapses", () => {
    let calls = 0;
    const loop = new FixedTimestepLoop(FIXED_DT, () => calls++);
    const alpha = loop.update(FIXED_DT / 2);
    expect(calls).toBe(0);
    expect(alpha).toBeLessThan(1);
    expect(alpha).toBeGreaterThanOrEqual(0);
  });

  it("runs exactly three steps for three fixed dt of accumulated time", () => {
    let calls = 0;
    const loop = new FixedTimestepLoop(FIXED_DT, () => calls++);
    const alpha = loop.update(FIXED_DT * 3);
    expect(calls).toBe(3);
    expect(alpha).toBeCloseTo(0, 4);
  });

  it("returns partial alpha after the last completed step", () => {
    let calls = 0;
    const loop = new FixedTimestepLoop(FIXED_DT, () => calls++);
    const alpha = loop.update(FIXED_DT * 2.5); // 2 full steps + half leftover
    expect(calls).toBe(2);
    expect(alpha).toBeCloseTo(0.5, 3);
  });

  it("caps runaway catch-up instead of doing hundreds of steps", () => {
    let calls = 0;
    const loop = new FixedTimestepLoop(FIXED_DT, () => calls++);
    loop.update(1000); // huge delta: frame clamp + MAX_STEPS_PER_FRAME cap
    expect(calls).toBeLessThanOrEqual(8);
  });
});
