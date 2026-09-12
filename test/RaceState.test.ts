import { describe, it, expect } from "vitest";
import { RaceState, formatLap } from "../src/race/RaceState.ts";
import { buildTrack } from "../src/track/Track.ts";
import { overture } from "../src/track/tracks.ts";
import type { Vec2 } from "../src/core/vec.ts";

/**
 * Drive a synthetic car around the centerline so it crosses every gate in
 * order, and assert the RaceState counts laps honestly.
 */
describe("RaceState lap detection", () => {
  function makeRace() {
    let clock = 0;
    const track = buildTrack(overture);
    const race = new RaceState(track, () => clock);
    return { track, race, advance: (ms: number) => (clock += ms) };
  }

  it("does not start a lap while the car is parked at the line", () => {
    const { track, race } = makeRace();
    const p: Vec2 = track.gates[0].center;
    race.update(p, p); // no movement
    expect(race.lap).toBe(0);
    expect(race.finished).toBe(false);
  });

  it("completes all laps when every gate is crossed in order", () => {
    const { track, race, advance } = makeRace();
    const cl = track.centerLine;
    // Drive one full lap, step through the centerline so each gate is crossed
    // in sequence; advance the clock so lap times are positive.
    for (let pass = 0; pass <= track.laps + 1; pass++) {
      for (let i = 0; i < cl.length; i++) {
        const cur = cl[i];
        const prev = cl[(i - 1 + cl.length) % cl.length];
        advance(50);
        race.update(prev, cur);
      }
    }
    expect(race.lap).toBeGreaterThanOrEqual(track.laps);
    expect(race.finished).toBe(true);
    expect(race.lapTimesMs.length).toBeGreaterThan(0);
    expect(Number.isFinite(race.bestLapMs)).toBe(true);
  });

  it("does not bank a lap on a back-and-forth jiggle at a single gate", () => {
    const { track, race } = makeRace();
    const gate = track.gates[1];
    // Oscillate across gate 1 only; it's not the start/finish, so no lap.
    for (let i = 0; i < 20; i++) {
      const prev = { x: gate.center.x, y: gate.center.y };
      const cur = {
        x: gate.a.x,
        y: gate.a.y,
      };
      race.update(prev, cur);
      race.update(cur, prev);
    }
    expect(race.lap).toBe(0);
  });
});

describe("formatLap", () => {
  it("renders mm:ss.mmm and handles zero", () => {
    expect(formatLap(64320)).toBe("1:04.320");
    expect(formatLap(0)).toBe("--:--.---");
    expect(formatLap(-5)).toBe("--:--.---");
  });
});
