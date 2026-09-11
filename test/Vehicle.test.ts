import { describe, it, expect } from "vitest";
import {
  Vehicle,
  defaultCarStats,
  defaultCarTuning,
} from "../src/core/Vehicle.ts";
import type { InputState } from "../src/core/Input.ts";

const idle: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: false };

describe("Vehicle (kinematic)", () => {
  it("stays parked with no input", () => {
    const v = new Vehicle(defaultCarStats, defaultCarTuning, { x: 0, y: 0 });
    v.step(1 / 120, idle);
    expect(v.speed).toBeCloseTo(0, 6);
    expect(v.pos.x).toBe(0);
    expect(v.pos.y).toBe(0);
    expect(v.heading).toBe(0);
  });

  it("accelerates up to and no further than max speed", () => {
    const v = new Vehicle(defaultCarStats, defaultCarTuning, { x: 0, y: 0 });
    const throttle: InputState = {
      ...idle,
      throttle: 1,
    };
    for (let i = 0; i < 1200; i++) v.step(1 / 120, throttle);
    expect(v.speed).toBeLessThanOrEqual(defaultCarStats.maxSpeed + 1);
    expect(v.speed).toBeGreaterThanOrEqual(
      defaultCarStats.maxSpeed - defaultCarStats.maxSpeed * 0.02,
    );
  });

  it("brakes to a stop", () => {
    const v = new Vehicle(defaultCarStats, defaultCarTuning, { x: 0, y: 0 });
    v.speed = defaultCarStats.maxSpeed;
    const braking: InputState = { ...idle, brake: 1 };
    for (let i = 0; i < 120; i++) v.step(1 / 120, braking);
    expect(Math.abs(v.speed)).toBeLessThan(2);
  });

  it("steers only while moving", () => {
    const v = new Vehicle(defaultCarStats, defaultCarTuning, { x: 0, y: 0 });
    v.step(1 / 120, { ...idle, steer: 1 }); // parked: should not turn
    expect(v.heading).toBeCloseTo(0, 6);

    v.speed = 100;
    v.step(1 / 120, { ...idle, steer: 1 }); // moving: should turn
    expect(v.heading).not.toBe(0);
  });

  it("interpolated() blends between the last two steps at alpha=0.5", () => {
    const v = new Vehicle(defaultCarStats, defaultCarTuning, { x: 0, y: 0 });
    v.speed = 100;
    v.step(1 / 120, { ...idle, steer: 1 }); // prev -> curr
    const mid = v.interpolated(0.5);
    const prev = v.interpolated(0);
    expect(mid.heading).toBeGreaterThan(prev.heading);
    expect(mid.heading).toBeLessThan(v.heading);
  });
});
