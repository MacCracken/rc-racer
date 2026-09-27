import { describe, it, expect } from "vitest";
import {
  REPLAY_INTERVAL_MS,
  ReplayRecorder,
  replayLength,
  sampleReplay,
  type CarPose,
} from "../src/race/Replay.ts";

/** A car at `x` (and `angle`), otherwise at rest. */
const at = (x: number, angle = 0, braking = false): CarPose => ({
  x,
  y: 0,
  angle,
  steer: 0,
  braking,
});

describe("replay recording", () => {
  it("wants about one frame per interval however often it's asked", () => {
    const rec = new ReplayRecorder();
    let asked = 0;
    for (let step = 0; step <= 120; step++) {
      const t = (step * 1000) / 120; // a second at 120 Hz
      if (!rec.due(t)) continue;
      asked++;
      rec.record(t, [at(step)]);
    }
    const r = rec.finish();
    expect(r.length).toBe(asked);
    expect(r.length).toBeGreaterThanOrEqual(25);
    expect(r.length).toBeLessThanOrEqual(32);
    for (let i = 1; i < r.length; i++)
      expect(r[i].t - r[i - 1].t).toBeGreaterThanOrEqual(
        REPLAY_INTERVAL_MS - 1e-6,
      );
  });

  it("takes an off-beat frame so it ends exactly on the flag", () => {
    const rec = new ReplayRecorder();
    rec.record(0, [at(0)]);
    rec.record(40, [at(4)]);
    expect(rec.due(50)).toBe(false);
    rec.record(50, [at(5)]); // the finish, between beats
    rec.record(50, [at(9)]); // the same moment again: ignored
    rec.record(45, [at(9)]); // and time never runs back
    const r = rec.finish();
    expect(r.map((f) => f.t)).toEqual([0, 40, 50]);
    expect(replayLength(r)).toBe(50);
    expect(r[2].cars[0].x).toBe(5);
  });

  it("copies what it's given, so later changes don't rewrite history", () => {
    const rec = new ReplayRecorder();
    const car = at(1);
    rec.record(0, [car]);
    car.x = 99;
    expect(rec.finish()[0].cars[0].x).toBe(1);
  });
});

describe("replay playback", () => {
  const rec = new ReplayRecorder();
  rec.record(0, [at(0, Math.PI - 0.1), at(100)]);
  rec.record(100, [at(10, -Math.PI + 0.1, true), at(120)]);
  const replay = rec.finish();

  it("interpolates every car between frames", () => {
    const mid = sampleReplay(replay, 50)!;
    expect(mid[0].x).toBeCloseTo(5, 9);
    expect(mid[1].x).toBeCloseTo(110, 9);
  });

  it("turns the short way round across ±π", () => {
    const mid = sampleReplay(replay, 50)!;
    // π−0.1 to −π+0.1 is a 0.2 rad turn through π, not a spin back round.
    expect(Math.abs(Math.abs(mid[0].angle) - Math.PI)).toBeLessThan(1e-9);
  });

  it("holds the first and last frames outside the recording", () => {
    expect(sampleReplay(replay, -50)![0].x).toBe(0);
    expect(sampleReplay(replay, 500)![0].x).toBe(10);
    expect(sampleReplay(replay, 500)![0].braking).toBe(true);
    expect(sampleReplay([], 0)).toBeNull();
  });
});
