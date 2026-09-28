import { describe, it, expect } from "vitest";
import {
  createArena,
  createCarWorld,
  resolveCarContacts,
  stepCar,
  forwardSpeed,
} from "../src/physics/MatterCar.ts";
import { buildTrack, type TrackDef } from "../src/track/Track.ts";
import { RaceState } from "../src/race/RaceState.ts";
import { dustBowl, tracks } from "../src/track/tracks.ts";
import {
  CAR_BOUNCE,
  CAR_LENGTH,
  CAR_WIDTH,
  defaultCarStats,
  GRIP_ACCEL,
} from "../src/core/tuning.ts";
import type { Vec2 } from "../src/core/vec.ts";
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

// A huge circle is locally almost straight: the wall at (R + limit, 0)
// faces +x, and the road runs along +y there.
const R = 3000;
const ring: TrackDef = {
  id: "ring",
  name: "Ring",
  laps: 1,
  width: 120,
  centerLine: Array.from({ length: 720 }, (_, i) => ({
    x: R * Math.cos((i / 720) * Math.PI * 2),
    y: R * Math.sin((i / 720) * Math.PI * 2),
  })),
};
const limit = ring.width / 2 - (Math.max(CAR_LENGTH, CAR_WIDTH) / 2) * 0.7;

describe("wall contact", () => {
  /** Speed after a car at the wall, heading `heading`, moves at `v`. */
  function speedAfterHit(heading: number, vx: number, vy: number): number {
    const track = buildTrack(ring);
    const { car, walls } = createCarWorld(track);
    car.position.x = R + limit - 0.2;
    car.position.y = 0;
    car.angle = heading;
    car.velocity.x = vx;
    car.velocity.y = vy;
    for (let i = 0; i < 12; i++)
      stepCar(car, walls, track, idle, defaultCarStats, dt);
    return Math.hypot(car.velocity.x, car.velocity.y);
  }

  it("a graze keeps most of the car's speed", () => {
    const a = (5 * Math.PI) / 180; // 5° into the wall at 180 px/s
    const v = speedAfterHit(Math.PI / 2, 180 * Math.sin(a), 180 * Math.cos(a));
    expect(v).toBeGreaterThan(180 * 0.85); // was ~45% under the old flat scrub
  });

  it("a head-on hit still stops the car, with a small bounce", () => {
    const v = speedAfterHit(0, 180, 0);
    expect(v).toBeLessThan(180 * 0.4);
  });
});

describe("car contact", () => {
  /** Two cars on the ring's straight at x = R, both heading down the road. */
  function pair(massA = 1, massB = 1) {
    const track = buildTrack(ring);
    const rival = { stats: defaultCarStats, pace: 0.8, mass: massB };
    const arena = createArena(track, defaultCarStats, [rival], {
      mass: massA,
    });
    const [a, b] = arena.cars;
    for (const c of [a, b]) {
      c.body.angle = Math.PI / 2;
      c.body.position.x = R;
      c.body.velocity.x = 0;
      c.body.velocity.y = 0;
    }
    return { arena, a: a.body, b: b.body };
  }

  it("keeps cars from driving through each other: a shunt shoves the car ahead", () => {
    const { arena, a, b } = pair();
    a.position.y = 0;
    b.position.y = 24; // nose to tail they touch at a car's length apart
    a.velocity.y = 150;
    b.velocity.y = 50;
    const hits = resolveCarContacts(arena.cars);
    expect(hits).toEqual([{ a: 0, b: 1, speed: 100 }]);
    expect(b.position.y - a.position.y).toBeCloseTo(CAR_LENGTH, 6);
    // Momentum is kept, and a share of the closing speed bounces back.
    expect(a.velocity.y + b.velocity.y).toBeCloseTo(200, 6);
    expect(b.velocity.y - a.velocity.y).toBeCloseTo(100 * CAR_BOUNCE, 6);
  });

  it("side by side, cars are kept a car's width apart", () => {
    const { arena, a, b } = pair();
    a.position.y = b.position.y = 0;
    b.position.x = R + 10;
    resolveCarContacts(arena.cars);
    expect(b.position.x - a.position.x).toBeCloseTo(CAR_WIDTH, 6);
  });

  it("the heavier car shoves the lighter one further", () => {
    const { arena, a, b } = pair(1.4, 0.8);
    a.position.y = 0;
    b.position.y = 24;
    resolveCarContacts(arena.cars);
    expect(b.position.y - 24).toBeGreaterThan(-a.position.y * 1.5);
  });

  it("cars clear of each other don't touch", () => {
    const { arena, a, b } = pair();
    b.position.y = CAR_LENGTH + 1;
    a.velocity.y = 150;
    expect(resolveCarContacts(arena.cars)).toEqual([]);
    expect(a.velocity.y).toBe(150);
    expect(b.position.y).toBe(CAR_LENGTH + 1);
  });
});

describe("the cornering limit", () => {
  /** How far (rad) a car's path turns in 0.4 s at full lock from top speed. */
  function pathTurn(grip: number): number {
    const track = buildTrack(ring);
    const { car, walls } = createCarWorld(track);
    const stats = { ...defaultCarStats, grip };
    car.position.x = R;
    car.position.y = 0;
    car.angle = Math.PI / 2;
    car.velocity.x = 0;
    car.velocity.y = stats.maxSpeed;
    for (let i = 0; i < 0.4 / dt; i++)
      stepCar(car, walls, track, { ...idle, throttle: 1, steer: 1 }, stats, dt);
    return Math.atan2(car.velocity.y, car.velocity.x) - Math.PI / 2;
  }

  it("the tyres only pull so hard: turn in harder at speed and the car slides wide", () => {
    const grip = defaultCarStats.grip;
    // The path can't bend much faster than the tyres' pull allows at this
    // speed (the throttle, pushing along a heading turned into the slide,
    // helps a little), while the heading, at full lock, turns far faster.
    const most = ((GRIP_ACCEL * grip) / defaultCarStats.maxSpeed) * 0.4;
    expect(Math.abs(pathTurn(grip))).toBeLessThanOrEqual(most * 1.1);
    expect(defaultCarStats.turnRate * 0.4).toBeGreaterThan(most * 3);
    // More grip holds a tighter line.
    expect(Math.abs(pathTurn(grip * 2))).toBeGreaterThan(
      Math.abs(pathTurn(grip)) * 1.5,
    );
  });
});

/** Distance from `p` to the closed centerline polyline. */
function distToCenterLine(cl: Vec2[], p: Vec2): number {
  let best = Infinity;
  for (let i = 0; i < cl.length; i++) {
    const a = cl[i];
    const b = cl[(i + 1) % cl.length];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby),
      ),
    );
    best = Math.min(best, Math.hypot(p.x - a.x - abx * t, p.y - a.y - aby * t));
  }
  return best;
}

/** `n` identical rivals, enough to fill the grid. */
const field = (n: number) =>
  Array.from({ length: n }, () => ({ stats: defaultCarStats, pace: 0.8 }));

describe("starting grid", () => {
  it("puts every car of a full field on the asphalt, apart, on every track", () => {
    for (const def of tracks) {
      const track = buildTrack(def);
      const arena = createArena(track, defaultCarStats, field(5));
      // The collision band's edge for a car's centre (see stepCar).
      const limit =
        track.width / 2 - (Math.max(CAR_LENGTH, CAR_WIDTH) / 2) * 0.7;
      const pos = arena.cars.map((c) => c.body.position);
      for (const p of pos)
        expect(
          distToCenterLine(track.centerLine, p),
          def.name,
        ).toBeLessThanOrEqual(limit);
      for (let i = 0; i < pos.length; i++)
        for (let j = i + 1; j < pos.length; j++)
          expect(
            Math.hypot(pos[i].x - pos[j].x, pos[i].y - pos[j].y),
            `${def.name}: cars ${i} and ${j} overlap`,
          ).toBeGreaterThan(CAR_LENGTH);
    }
  });

  it("puts the player at the back, the strongest rival on pole", () => {
    const track = buildTrack(dustBowl);
    // Rivals come weakest first (see `rivalField`).
    const arena = createArena(track, defaultCarStats, field(3));
    const onLine = (i: number): boolean =>
      Math.hypot(
        arena.cars[i].body.position.x - track.start.pos.x,
        arena.cars[i].body.position.y - track.start.pos.y,
      ) < 1e-6;
    expect(onLine(3)).toBe(true); // the last (strongest) rival
    expect(onLine(0)).toBe(false);
    // The player is the furthest back of the field.
    const race = new RaceState(track, () => 0);
    const back = (i: number) => race.lapProgress(arena.cars[i].body.position);
    for (let i = 1; i < 4; i++) expect(back(0)).toBeLessThan(back(i));
  });

  it("starts a player racing alone on the line", () => {
    const track = buildTrack(dustBowl);
    const arena = createArena(track, defaultCarStats);
    expect(arena.cars[0].body.position.x).toBeCloseTo(track.start.pos.x, 6);
    expect(arena.cars[0].body.position.y).toBeCloseTo(track.start.pos.y, 6);
  });
});
