import { describe, it, expect } from "vitest";
import { ReplayPlayer, type PosableCar } from "../src/race/ReplayPlayer.ts";
import { REPLAY_INTERVAL_MS, ReplayRecorder } from "../src/race/Replay.ts";
import { createSkid } from "../src/core/SkidMarks.ts";

/**
 * Two cars recorded for a second at 30 Hz: the player sliding along
 * (200 px/s forward, 100 px/s sideways, so it lays skid marks), braking in
 * the second half; a rival rolling straight on, steering right.
 */
function recorded() {
  const rec = new ReplayRecorder();
  for (let i = 0; i <= 30; i++) {
    const t = i * REPLAY_INTERVAL_MS;
    rec.record(t, [
      {
        x: (200 * t) / 1000,
        y: (100 * t) / 1000,
        angle: 0,
        steer: 0,
        braking: t >= 500,
      },
      { x: 50 + (100 * t) / 1000, y: 40, angle: 0, steer: 1, braking: false },
    ]);
  }
  const player = new ReplayPlayer();
  player.load(rec.finish());
  return player;
}

const car = (): PosableCar => ({
  body: { position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, angle: 1 },
  stats: { maxSpeed: 200 },
});

describe("replay playback", () => {
  it("has nothing to play until a race is loaded", () => {
    expect(new ReplayPlayer().ready).toBe(false);
    expect(recorded().ready).toBe(true);
    expect(recorded().length).toBeCloseTo(1000, 6);
  });

  it("starts from the green light at 1×, with the cars on their marks", () => {
    const p = recorded();
    const cars = [car(), car()];
    p.watch(cars, createSkid());
    expect(p.state()).toEqual({ held: false, atEnd: false, speed: 1 });
    expect(cars[1].body.position).toEqual({ x: 50, y: 40 });
    expect(cars[0].body.angle).toBe(0);
    // Velocity read off the next moment of motion, in px/s.
    expect(cars[0].body.velocity.x).toBeCloseTo(200, 6);
    expect(cars[0].body.velocity.y).toBeCloseTo(100, 6);
    expect(p.controls[1]).toEqual({ steer: 1, braking: false });
  });

  it("runs at its speed, holds when paused, and stops at the flag", () => {
    const p = recorded();
    const cars = [car(), car()];
    p.watch(cars, createSkid());
    p.step(0.1, cars, createSkid());
    expect(p.ms).toBeCloseTo(100, 6);
    p.cycleSpeed(); // 2×
    p.step(0.1, cars, createSkid());
    expect(p.ms).toBeCloseTo(300, 6);
    expect(cars[0].body.position.x).toBeCloseTo(60, 6);
    expect(p.toggle()).toBe(false); // held
    p.step(0.5, cars, createSkid());
    expect(p.ms).toBeCloseTo(300, 6);
    p.toggle();
    p.cycleSpeed(); // 4×
    expect(p.step(0.25, cars, createSkid())).toBe(true); // the flag, once
    expect(p.atEnd).toBe(true);
    expect(p.step(0.25, cars, createSkid())).toBe(false);
    expect(p.controls[0].braking).toBe(true);
    p.cycleSpeed();
    expect(p.speed).toBe(1); // 4× wraps round
  });

  it("from the flag, play goes back to the top", () => {
    const p = recorded();
    const cars = [car(), car()];
    p.watch(cars, createSkid());
    p.toEnd(cars, createSkid());
    expect(p.atEnd).toBe(true);
    expect(cars[0].body.velocity).toEqual({ x: 0, y: 0 }); // parked
    expect(p.toggle()).toBe(true);
    expect(p.ms).toBe(0);
    expect(p.held).toBe(false);
  });

  it("lays the player's skid marks again, but only while it plays", () => {
    const p = recorded();
    const cars = [car(), car()];
    const skid = createSkid();
    p.watch(cars, skid);
    expect(skid.marks).toHaveLength(0); // posing alone lays nothing
    p.step(1 / 120, cars, skid);
    expect(skid.marks.length).toBeGreaterThan(0);
    const laid = skid.marks.length;
    p.toggle(); // held
    p.step(1 / 120, cars, skid);
    expect(skid.marks).toHaveLength(laid);
  });

  it("badges the HUD with where it is", () => {
    const p = recorded();
    p.watch([car(), car()], createSkid());
    p.cycleSpeed();
    expect(p.badge()).toEqual({ ms: 0, totalMs: p.length, speed: 2 });
  });
});
