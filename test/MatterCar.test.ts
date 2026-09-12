import { describe, it, expect } from "vitest";
import {
  createCarWorld,
  stepCar,
  forwardSpeed,
} from "../src/physics/MatterCar.ts";
import { buildTrack } from "../src/track/Track.ts";
import { dustBowl } from "../src/track/tracks.ts";
import { defaultCarStats } from "../src/core/tuning.ts";
import type { InputState } from "../src/core/Input.ts";

const idle: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const dt = 1 / 120;

describe("MatterCar physics", () => {
  it("accelerates forward under throttle", () => {
    const track = buildTrack(dustBowl);
    const { car, walls } = createCarWorld(track);
    const before = { x: car.position.x, y: car.position.y };
    for (let i = 0; i < 180; i++)
      stepCar(car, walls, track, { ...idle, throttle: 1 }, defaultCarStats, dt);
    const dx = Math.hypot(car.position.x - before.x, car.position.y - before.y);
    expect(dx).toBeGreaterThan(20);
    expect(Math.abs(forwardSpeed(car))).toBeGreaterThan(40);
  });

  it("turns under steering input while moving", () => {
    const track = buildTrack(dustBowl);
    const { car, walls } = createCarWorld(track);
    const startHeading = car.angle;
    for (let i = 0; i < 60; i++)
      stepCar(
        car,
        walls,
        track,
        { throttle: 1, brake: 0, steer: 1, handbrake: false },
        defaultCarStats,
        dt,
      );
    expect(Math.abs(car.angle - startHeading)).toBeGreaterThan(0.1);
  });

  it("stays parked when idle (no spin, negligible drift)", () => {
    const track = buildTrack(dustBowl);
    const { car, walls } = createCarWorld(track);
    const startX = car.position.x;
    const startY = car.position.y;
    for (let i = 0; i < 120; i++)
      stepCar(car, walls, track, { ...idle, steer: 1 }, defaultCarStats, dt);
    expect(
      Math.hypot(car.position.x - startX, car.position.y - startY),
    ).toBeLessThan(3);
    expect(Math.abs(forwardSpeed(car))).toBeLessThan(1);
  });

  it("collides with walls and stays inside the track band", () => {
    const track = buildTrack(dustBowl);
    const { car, walls } = createCarWorld(track);
    let stayedInBand = true;
    for (let i = 0; i < 300; i++) {
      stepCar(
        car,
        walls,
        track,
        { throttle: 1, brake: 0, steer: 0.5, handbrake: false },
        defaultCarStats,
        dt,
      );
      let minSeg = Infinity;
      const cl = track.centerLine;
      for (let s = 0; s < cl.length; s++) {
        const d = Math.hypot(
          car.position.x - cl[s].x,
          car.position.y - cl[s].y,
        );
        if (d < minSeg) minSeg = d;
      }
      if (minSeg > track.width / 2 + 4) stayedInBand = false;
    }
    expect(stayedInBand).toBe(true);
    expect(walls.every((w) => w.isStatic)).toBe(true);
    expect(car.isStatic).toBe(false);
  });
});
