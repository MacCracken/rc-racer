import M from "matter-js";
import {
  CAR_LENGTH,
  CAR_WIDTH,
  defaultCarStats,
  type CarStats,
} from "../core/tuning.ts";
import type { BuiltTrack } from "../track/Track.ts";
import type { InputState } from "../core/Input.ts";

const CAR_HALF = Math.max(CAR_LENGTH, CAR_WIDTH) / 2;
const clamp = (x: number, lo: number, hi: number) =>
  x < lo ? lo : x > hi ? hi : x;

/**
 * Shared collision setup so an AI *field* of cars can coexist: every car sits in
 * the same negative group, so cars never collide with each other, but each car
 * (category 0x2) collides with the walls (category 0x1). For the analytic band
 * model this is belt-and-braces; it also keeps a future SAT upgrade sane.
 */
const CAR_GROUP = -1;
const CAT_WALL = 0x0001;
const CAT_CAR = 0x0002;

export interface CarWorld {
  car: M.Body;
  walls: M.Body[];
  track: BuiltTrack;
}

/**
 * Build static walls from a track's outer/inner boundaries.
 *
 * Physics note: for a top-down arcade *ribbon* track we integrate the car
 * ourselves (deterministic, no Engine.update unit surprises) and use Matter's
 * bodies for shape + an analytic "stay in the band" collision that is correct by
 * construction for a closed annulus and cannot permanently stall the car. Full
 * SAT/wheel-constraint collisions are a later-phase enhancement.
 */
function buildWalls(track: BuiltTrack): M.Body[] {
  const walls: M.Body[] = [];
  const thickness = 16;
  const addRing = (pts: { x: number; y: number }[]): void => {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      const midx = (p.x + q.x) / 2;
      const midy = (p.y + q.y) / 2;
      const angle = Math.atan2(q.y - p.y, q.x - p.x);
      const segLen = Math.hypot(q.x - p.x, q.y - p.y) + thickness;
      walls.push(
        M.Bodies.rectangle(midx, midy, segLen, thickness, {
          isStatic: true,
          collisionFilter: {
            group: 0,
            category: CAT_WALL,
            mask: CAT_WALL | CAT_CAR,
          },
          label: "wall",
          render: { visible: false },
          angle,
        }),
      );
    }
  };
  addRing(track.outer);
  addRing(track.inner);
  return walls;
}

/**
 * Create a single car body at the start line, offset laterally by `side` px, with
 * its stats baked into inertia.
 */
function createCarBody(track: BuiltTrack, stats: CarStats, side = 0): M.Body {
  // Bigger stats -> slightly heavier body for feel; keep the hitbox the same
  // size so the band model stays consistent across builds.
  const mass = 1 + stats.maxSpeed / 1000;
  const p = track.start.pos;
  const nx = -Math.sin(track.start.heading);
  const ny = Math.cos(track.start.heading);
  const car = M.Bodies.rectangle(
    p.x + nx * side,
    p.y + ny * side,
    CAR_LENGTH,
    CAR_WIDTH,
    {
      label: "car",
      mass,
      frictionAir: 0,
      friction: 0.1,
      collisionFilter: { group: CAR_GROUP, category: CAT_CAR, mask: CAT_WALL },
      render: { visible: false },
    },
  );
  M.Body.setAngle(car, track.start.heading);
  M.Body.setVelocity(car, { x: 0, y: 0 });
  return car;
}

/**
 * The physical world for a *single* car race. We keep a Matter engine around as a
 * seam for a future SAT upgrade, but integrate by hand (Euler) so the HUD speed is
 * in px/s, not Matter's internal units.
 */
export function createCarWorld(track: BuiltTrack): CarWorld {
  const engine = M.Engine.create();
  engine.gravity.x = 0;
  engine.gravity.y = 0;
  const walls = buildWalls(track);
  const car = createCarBody(track, defaultCarStats, 0);
  M.Composite.add(engine.world, walls);
  M.Composite.add(engine.world, [car]);
  // The engine is only a placeholder seam; stepCar integrates by hand.
  void engine;
  return { car, walls, track };
}

/**
 * A *multi-car* arena: a player plus N AI rivals, each with its own Matter body
 * and a per-rival `pace` (0..1) the autopilot drives toward.
 */
export interface ArenaCar {
  isPlayer: boolean;
  body: M.Body;
  stats: CarStats;
  /** 0..1 target pace (ignored for the player). */
  pace?: number;
  label: string;
}
export interface Arena {
  track: BuiltTrack;
  walls: M.Body[];
  cars: ArenaCar[];
}

export function createArena(
  track: BuiltTrack,
  playerStats: CarStats,
  rivalPaces: number[] = [],
): Arena {
  const walls = buildWalls(track);
  const cars: ArenaCar[] = [
    {
      isPlayer: true,
      body: createCarBody(track, playerStats, 0),
      stats: playerStats,
      label: "you",
    },
  ];
  for (let i = 0; i < rivalPaces.length; i++) {
    // Vary the fields a touch so a faster pace is visibly faster.
    const stat: CarStats = {
      ...playerStats,
      maxSpeed: playerStats.maxSpeed * (0.9 + 0.03 * i),
      accel: playerStats.accel * (0.9 + 0.03 * i),
      grip: playerStats.grip * (0.86 + 0.02 * i),
    };
    const side = (i + 1) * 28 * (i % 2 === 0 ? 1 : -1);
    cars.push({
      isPlayer: false,
      body: createCarBody(track, stat, side),
      stats: stat,
      pace: rivalPaces[i],
      label: `rival${i + 1}`,
    });
  }
  return { track, walls, cars };
}

/** Closest point on the closed centerline polyline, and its distance. */
function closestOnCenterLine(
  cl: { x: number; y: number }[],
  p: { x: number; y: number },
): { x: number; y: number; dist: number } {
  let best = Infinity;
  let bx = p.x;
  let by = p.y;
  const n = cl.length;
  for (let i = 0; i < n; i++) {
    const a = cl[i];
    const b = cl[(i + 1) % n];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = p.x - a.x;
    const apy = p.y - a.y;
    const t = clamp(
      (apx * abx + apy * aby) / Math.max(1, abx * abx + aby * aby),
      0,
      1,
    );
    const cx = a.x + abx * t;
    const cy = a.y + aby * t;
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d < best) {
      best = d;
      bx = cx;
      by = cy;
    }
  }
  return { x: bx, y: by, dist: best };
}

/**
 * Advance the car one fixed step. We own integration (Euler) so speed handling is
 * deterministic and never subject to Matter's time-step units.
 */
export function stepCar(
  car: M.Body,
  walls: M.Body[],
  track: BuiltTrack,
  input: InputState,
  stats: CarStats,
  dtS: number,
): void {
  // Local axes. Matter angle 0 = along +x (forward).
  const angle = car.angle;
  const fx = Math.cos(angle);
  const fy = Math.sin(angle);
  const lx = -fy; // left / lateral
  const ly = fx;

  const vx = car.velocity.x;
  const vy = car.velocity.y;
  let forward = vx * fx + vy * fy;
  let lateral = vx * lx + vy * ly;

  // Longitudinal: throttle / brake / coasting drag.
  if (input.throttle > 0) {
    forward += stats.accel * input.throttle * dtS;
  } else if (input.brake > 0) {
    if (forward > 0.5) {
      forward -= stats.braking * input.brake * dtS;
      if (forward < 0) forward = 0;
    } else {
      forward -= stats.reverseAccel * input.brake * dtS;
    }
  }
  forward = clamp(
    forward * (1 - stats.drag * dtS),
    -stats.maxSpeed * 0.35,
    stats.maxSpeed,
  );

  // Lateral: grip damping. Handbrake (and high speed) reduce grip -> slide.
  const speedFrac = clamp(
    Math.abs(forward) / Math.max(1, stats.maxSpeed),
    0,
    1,
  );
  const grip = input.handbrake
    ? stats.handbrakeGrip
    : stats.grip * (1 - 0.4 * speedFrac);
  lateral *= 1 - clamp(grip, 0, 0.99);

  const worldVX = fx * forward + lx * lateral;
  const worldVY = fy * forward + ly * lateral;

  // Integrate position.
  car.position.x += worldVX * dtS;
  car.position.y += worldVY * dtS;

  // Steering: yaw authority scales with speed, inverts in reverse.
  let yaw = input.steer * stats.turnRate * speedFrac;
  if (forward < -0.5) yaw = -yaw;
  car.angle += yaw * dtS;

  // Collision: keep the car inside the drivable band (analytic, can't stall).
  const seg = closestOnCenterLine(track.centerLine, car.position);
  const limit = track.width / 2 - CAR_HALF * 0.7;
  let vx2 = worldVX;
  let vy2 = worldVY;
  if (seg.dist > limit) {
    const nx = (seg.x - car.position.x) / seg.dist;
    const ny = (seg.y - car.position.y) / seg.dist;
    const overflow = seg.dist - limit;
    car.position.x += nx * overflow;
    car.position.y += ny * overflow;
    // scrub the outward velocity component + bleed some energy on impact
    const outward = vx2 * -nx + vy2 * -ny;
    if (outward > 0) {
      vx2 += nx * outward * 1.4;
      vy2 += ny * outward * 1.4;
      vx2 *= 0.45;
      vy2 *= 0.45;
    }
  }
  car.velocity.x = vx2;
  car.velocity.y = vy2;

  // (walls are real Matter bodies for the seam; retained for future SAT use)
  void walls;
}

/** Signed forward speed (px/s) of the car, for the HUD / camera. */
export function forwardSpeed(car: M.Body): number {
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  return car.velocity.x * fx + car.velocity.y * fy;
}
