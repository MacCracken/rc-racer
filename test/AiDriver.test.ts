import { describe, it, expect } from "vitest";
import { chooseLine, makeDriver, type Drivable } from "../src/race/AiDriver.ts";
import {
  createArena,
  forwardSpeed,
  stepCar,
  stepField,
} from "../src/physics/MatterCar.ts";
import { buildTrack, type TrackDef } from "../src/track/Track.ts";
import { hairpin } from "../src/track/tracks.ts";
import { RaceState } from "../src/race/RaceState.ts";
import {
  CAR_LENGTH,
  CAR_WIDTH,
  defaultCarStats,
  FIXED_DT,
  type CarStats,
} from "../src/core/tuning.ts";

/**
 * The autopilot the rivals race with: it brakes for each bend by what its
 * car's grip allows, goes round a slower car rather than through it, keeps a
 * gap when it can't get by, and backs out of a wall it's been shunted into.
 */

// A huge circle is locally almost straight: at (R, 0) the road runs along +y.
const R = 3000;
const ring: TrackDef = {
  id: "ring",
  name: "Ring",
  laps: 99,
  width: 120,
  centerLine: Array.from({ length: 720 }, (_, i) => ({
    x: R * Math.cos((i / 720) * Math.PI * 2),
    y: R * Math.sin((i / 720) * Math.PI * 2),
  })),
};

/** A car at `y` on the ring's straight, heading down the road at `speed`. */
const at = (y: number, speed = 0, x = R): Drivable => ({
  position: { x, y },
  velocity: { x: 0, y: speed },
  angle: Math.PI / 2,
});

describe("the autopilot's corner speeds", () => {
  /** Steps of a lap of Hairpin spent off the throttle, on the brake. */
  function brakingSteps(stats: CarStats): number {
    const track = buildTrack(hairpin);
    const arena = createArena(track, stats);
    const { body, stats: s } = arena.cars[0];
    const drive = makeDriver(track, { pace: 0.85, lookahead: 0.05, car: s });
    let clock = 0;
    const race = new RaceState(track, () => clock);
    let prev = { x: body.position.x, y: body.position.y };
    let braking = 0;
    for (let i = 0; i < 40 / FIXED_DT && race.lap < 1; i++) {
      const input = drive(body);
      if (input.throttle === 0 && input.brake > 0) braking++;
      stepCar(body, arena.walls, track, input, s, FIXED_DT);
      clock += FIXED_DT * 1000;
      race.update(prev, body.position);
      prev = { x: body.position.x, y: body.position.y };
    }
    expect(race.lap).toBe(1);
    return braking;
  }

  it("brakes for a bend its grip can't take flat out, less the more grip it has", () => {
    const loose = brakingSteps({ ...defaultCarStats, grip: 0.12 });
    const planted = brakingSteps({ ...defaultCarStats, grip: 0.3 });
    expect(loose).toBeGreaterThan(0);
    expect(planted).toBeLessThan(loose);
  });
});

describe("the autopilot in traffic", () => {
  it("goes round a slower car in its way instead of through it", () => {
    const track = buildTrack(ring);
    const slow: CarStats = { ...defaultCarStats, maxSpeed: 90 };
    const arena = createArena(track, defaultCarStats, [
      { stats: slow, pace: 0.8 },
    ]);
    const [me, them] = arena.cars;
    Object.assign(me.body.position, { x: R, y: 0 });
    Object.assign(them.body.position, { x: R, y: 90 });
    for (const c of [me, them]) {
      c.body.angle = Math.PI / 2;
      Object.assign(c.body.velocity, { x: 0, y: 90 });
    }
    const drivers = arena.cars.map((c) =>
      makeDriver(track, { pace: 0.85, lookahead: 0.05, car: c.stats }),
    );
    let pressed = 0;
    for (let i = 0; i < 6 / FIXED_DT; i++) {
      const inputs = arena.cars.map((c, k) => ({
        ...drivers[k](
          c.body,
          arena.cars.filter((o) => o !== c).map((o) => o.body),
        ),
      }));
      pressed += stepField(arena, inputs, FIXED_DT).contacts.length;
    }
    // Well past it, having barely touched it.
    expect(me.body.position.y - them.body.position.y).toBeGreaterThan(
      CAR_LENGTH * 3,
    );
    expect(pressed).toBeLessThan(0.2 / FIXED_DT);
  });

  it("with no way by, it holds its line and keeps a gap", () => {
    const track = buildTrack(ring);
    // A car right on our nose, flanked on both sides: boxed in.
    const ahead = CAR_LENGTH * 1.3;
    const traffic = [
      at(ahead, 150),
      at(ahead, 150, R + CAR_WIDTH * 1.8),
      at(ahead, 150, R - CAR_WIDTH * 1.8),
    ];
    const line = chooseLine(at(0, 150), track, 0, traffic);
    expect(line.throttle).toBeLessThan(0.5);
    expect(Math.abs(line.offset)).toBeLessThan(CAR_WIDTH);
    // Alone, it's flat out on its own line.
    expect(chooseLine(at(0, 150), track, 0, [])).toEqual({
      offset: 0,
      throttle: 1,
    });
  });

  it("backs out of a wall it's been shunted into, then drives on", () => {
    const track = buildTrack(ring);
    const arena = createArena(track, defaultCarStats);
    const { body, stats } = arena.cars[0];
    // Parked against the outer wall, nose into it.
    Object.assign(body.position, { x: R + 45, y: 0 });
    Object.assign(body.velocity, { x: 0, y: 0 });
    body.angle = 0.1;
    const drive = makeDriver(track, {
      pace: 0.85,
      lookahead: 0.05,
      car: stats,
    });
    for (let i = 0; i < 4 / FIXED_DT; i++)
      stepCar(body, arena.walls, track, drive(body), stats, FIXED_DT);
    // Pointing down the road (+y) and going.
    expect(Math.abs(body.angle - Math.PI / 2)).toBeLessThan(0.5);
    expect(forwardSpeed(body)).toBeGreaterThan(80);
    expect(body.position.y).toBeGreaterThan(CAR_LENGTH * 2);
  });
});
