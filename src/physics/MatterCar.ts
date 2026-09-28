import M from "matter-js";
import {
  CAR_BOUNCE,
  CAR_FRICTION,
  CAR_LENGTH,
  CAR_WIDTH,
  defaultCarStats,
  GRIP_ACCEL,
  WALL_BOUNCE,
  WALL_FRICTION,
  type CarStats,
} from "../core/tuning.ts";
import { gridSlot, type BuiltTrack } from "../track/Track.ts";
import { applyConditions, conditionsOf } from "../track/conditions.ts";
import type { InputState } from "../core/Input.ts";

const CAR_HALF = Math.max(CAR_LENGTH, CAR_WIDTH) / 2;
const clamp = (x: number, lo: number, hi: number) =>
  x < lo ? lo : x > hi ? hi : x;

/**
 * Matter's own collision setup, for the bodies kept as a seam (the race never
 * runs Matter's engine): every car sits in the same negative group, so Matter
 * would never collide cars with each other, only each car (category 0x2) with
 * the walls (category 0x1). Car-to-car contact is our own, analytic like the
 * walls: see `resolveCarContacts`.
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
 * Create a single car body in starting-grid slot `slot` (0 = pole, on the
 * line), with its stats baked into inertia.
 */
function createCarBody(track: BuiltTrack, stats: CarStats, slot = 0): M.Body {
  // Bigger stats -> slightly heavier body for feel; keep the hitbox the same
  // size so the band model stays consistent across builds.
  const mass = 1 + stats.maxSpeed / 1000;
  const p = gridSlot(track, slot);
  const car = M.Bodies.rectangle(p.x, p.y, CAR_LENGTH, CAR_WIDTH, {
    label: "car",
    mass,
    frictionAir: 0,
    friction: 0.1,
    collisionFilter: { group: CAR_GROUP, category: CAT_CAR, mask: CAT_WALL },
    render: { visible: false },
  });
  M.Body.setAngle(car, p.heading);
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
  /** The car's stats as it drives on this track (conditions applied). */
  stats: CarStats;
  /** How hard it is to shove in a contact (1 = a sedan). */
  mass: number;
  /** 0..1 target pace (ignored for the player). */
  pace?: number;
  /** The autopilot's preferred line, -1..1 across the road (0 = middle). */
  lane?: number;
  label: string;
}
export interface Arena {
  track: BuiltTrack;
  walls: M.Body[];
  cars: ArenaCar[];
}

/**
 * A rival's car + autopilot pace. The caller decides these (from the track),
 * so rivals never inherit the player's car or upgrades.
 */
export interface RivalSpec {
  stats: CarStats;
  pace: number;
  /** Who's driving, for the standings (default "rival<n>"). */
  name?: string;
  /** Contact mass (default 1). */
  mass?: number;
  /** Preferred line across the road, -1..1 (default 0, the middle). */
  lane?: number;
}

/**
 * The cars on a track, player first. Every car drives the track's conditions
 * (see `track/conditions.ts`): rain or dirt costs the whole field grip, not
 * just the player.
 *
 * The grid: `rivals` are listed weakest first, so the last (the strongest)
 * takes pole and the player starts at the back, with the whole field to get
 * past. Alone, the player starts on the line.
 */
export function createArena(
  track: BuiltTrack,
  playerStats: CarStats,
  rivals: RivalSpec[] = [],
  player: { mass?: number } = {},
): Arena {
  const walls = buildWalls(track);
  const conditions = conditionsOf(track.def);
  const cars: ArenaCar[] = [
    {
      isPlayer: true,
      body: createCarBody(track, playerStats, rivals.length),
      stats: applyConditions(playerStats, conditions),
      mass: player.mass ?? 1,
      label: "you",
    },
  ];
  rivals.forEach((r, i) => {
    const slot = rivals.length - 1 - i;
    cars.push({
      isPlayer: false,
      body: createCarBody(track, r.stats, slot),
      stats: applyConditions(r.stats, conditions),
      mass: r.mass ?? 1,
      pace: r.pace,
      // Unless told otherwise, a rival keeps to the side it starts on.
      lane: r.lane ?? (slot === 0 ? 0 : slot % 2 === 1 ? 1 : -1),
      label: r.name ?? `rival${i + 1}`,
    });
  });
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
 *
 * Returns how hard the car hit a wall this step: its speed into the wall
 * (px/s), or 0 if it touched none.
 */
export function stepCar(
  car: M.Body,
  walls: M.Body[],
  track: BuiltTrack,
  input: InputState,
  stats: CarStats,
  dtS: number,
): number {
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

  // Lateral: the tyres pull a slide back in line with the heading — a share
  // of it each step (`grip`, less at speed), but never harder than the
  // cornering limit, GRIP_ACCEL × grip. Turn in harder than that at speed and
  // the car slides wide. The handbrake drops both: the rear lets go.
  const speedFrac = clamp(
    Math.abs(forward) / Math.max(1, stats.maxSpeed),
    0,
    1,
  );
  const tyre = input.handbrake ? stats.handbrakeGrip : stats.grip;
  const grip = input.handbrake ? tyre : tyre * (1 - 0.4 * speedFrac);
  const most = GRIP_ACCEL * tyre * dtS;
  lateral -= clamp(lateral * clamp(grip, 0, 0.99), -most, most);

  const worldVX = fx * forward + lx * lateral;
  const worldVY = fy * forward + ly * lateral;

  // Integrate position.
  car.position.x += worldVX * dtS;
  car.position.y += worldVY * dtS;

  // Steering: yaw authority scales with speed, inverts in reverse.
  let yaw = input.steer * stats.turnRate * speedFrac;
  if (forward < -0.5) yaw = -yaw;
  car.angle += yaw * dtS;

  car.velocity.x = worldVX;
  car.velocity.y = worldVY;
  // (walls are real Matter bodies for the seam; retained for future SAT use)
  void walls;
  return keepOnRoad(car, track);
}

/**
 * Wall contact: keep the car inside the drivable band (analytic, so it can't
 * stall), and take the speed it drove into the wall off it. Returns that
 * speed (px/s), or 0 if it was on the road.
 */
function keepOnRoad(car: M.Body, track: BuiltTrack): number {
  const seg = closestOnCenterLine(track.centerLine, car.position);
  const limit = track.width / 2 - CAR_HALF * 0.7;
  if (seg.dist <= limit) return 0;
  const nx = (seg.x - car.position.x) / seg.dist;
  const ny = (seg.y - car.position.y) / seg.dist;
  const overflow = seg.dist - limit;
  car.position.x += nx * overflow;
  car.position.y += ny * overflow;
  // Split the velocity into the part driving into the wall and the part
  // sliding along it: cancel the first with a small bounce, and scrub the
  // second in proportion to how hard we hit. (Scaling *all* speed by 0.45
  // on every contact step made even a 5° graze halve the car's speed.)
  const vx = car.velocity.x;
  const vy = car.velocity.y;
  const into = -(vx * nx + vy * ny);
  if (into <= 0) return 0;
  const tx = -ny;
  const ty = nx;
  const along = vx * tx + vy * ty;
  const kept =
    Math.sign(along) * Math.max(0, Math.abs(along) - WALL_FRICTION * into);
  const back = WALL_BOUNCE * into;
  car.velocity.x = tx * kept + nx * back;
  car.velocity.y = ty * kept + ny * back;
  return into;
}

/** Contact capsule: a car's axis segment runs ±CONTACT_HALF, swept by CONTACT_R. */
const CONTACT_R = CAR_WIDTH / 2;
const CONTACT_HALF = CAR_LENGTH / 2 - CONTACT_R;

/** Two cars that bumped this step, and how hard (closing speed, px/s). */
export interface CarContact {
  /** Indexes into the cars passed in. */
  a: number;
  b: number;
  speed: number;
}

/** Closest points between segments p1-q1 and p2-q2 (Ericson, RTCD 5.1.9). */
function closestBetween(
  p1x: number,
  p1y: number,
  d1x: number,
  d1y: number,
  p2x: number,
  p2y: number,
  d2x: number,
  d2y: number,
): { s: number; t: number } {
  const rx = p1x - p2x;
  const ry = p1y - p2y;
  const a = d1x * d1x + d1y * d1y;
  const e = d2x * d2x + d2y * d2y;
  const f = d2x * rx + d2y * ry;
  const c = d1x * rx + d1y * ry;
  const b = d1x * d2x + d1y * d2y;
  const denom = a * e - b * b;
  let s = denom > 1e-9 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
  let t = (b * s + f) / e;
  if (t < 0) {
    t = 0;
    s = clamp(-c / a, 0, 1);
  } else if (t > 1) {
    t = 1;
    s = clamp((b - c) / a, 0, 1);
  }
  return { s, t };
}

/**
 * Keep cars from driving through each other. Each car is a capsule along its
 * axis, as wide as the body; two that overlap are pushed apart — the lighter
 * one further — and, if closing, trade an impulse along the contact normal
 * (`CAR_BOUNCE` of the closing speed comes back) with a little friction
 * across it, so a shunt from behind shoves the car ahead and two cars
 * rubbing door to door both lose a touch of speed. Returns each new impact.
 */
export function resolveCarContacts(cars: readonly ArenaCar[]): CarContact[] {
  const hits: CarContact[] = [];
  for (let i = 0; i < cars.length; i++)
    for (let j = i + 1; j < cars.length; j++) {
      const speed = resolvePair(cars[i], cars[j]);
      if (speed > 0) hits.push({ a: i, b: j, speed });
    }
  return hits;
}

/** One pair's contact (see `resolveCarContacts`): its closing speed, or 0. */
function resolvePair(ca: ArenaCar, cb: ArenaCar): number {
  const A = ca.body;
  const B = cb.body;
  // Far apart: skip the segment math.
  const cx = B.position.x - A.position.x;
  const cy = B.position.y - A.position.y;
  const reach = 2 * (CONTACT_HALF + CONTACT_R);
  if (cx * cx + cy * cy >= reach * reach) return 0;

  const ax = Math.cos(A.angle) * CONTACT_HALF;
  const ay = Math.sin(A.angle) * CONTACT_HALF;
  const bx = Math.cos(B.angle) * CONTACT_HALF;
  const by = Math.sin(B.angle) * CONTACT_HALF;
  const { s, t } = closestBetween(
    A.position.x - ax,
    A.position.y - ay,
    2 * ax,
    2 * ay,
    B.position.x - bx,
    B.position.y - by,
    2 * bx,
    2 * by,
  );
  let nx = B.position.x - bx + 2 * bx * t - (A.position.x - ax + 2 * ax * s);
  let ny = B.position.y - by + 2 * by * t - (A.position.y - ay + 2 * ay * s);
  let d = Math.hypot(nx, ny);
  if (d >= 2 * CONTACT_R) return 0;
  if (d < 1e-6) {
    // Axes crossing: part them along the line between their centres.
    d = Math.hypot(cx, cy);
    [nx, ny] = d < 1e-6 ? [1, 0] : [cx / d, cy / d];
    d = 0;
  } else {
    nx /= d;
    ny /= d;
  }

  // Push apart, the lighter car further.
  const ia = 1 / Math.max(0.1, ca.mass);
  const ib = 1 / Math.max(0.1, cb.mass);
  const push = (2 * CONTACT_R - d) / (ia + ib);
  A.position.x -= nx * push * ia;
  A.position.y -= ny * push * ia;
  B.position.x += nx * push * ib;
  B.position.y += ny * push * ib;

  // Trade an impulse if they're closing.
  const rvx = B.velocity.x - A.velocity.x;
  const rvy = B.velocity.y - A.velocity.y;
  const vn = rvx * nx + rvy * ny;
  if (vn >= 0) return 0;
  const jn = (-(1 + CAR_BOUNCE) * vn) / (ia + ib);
  // Friction across the contact, capped so it can only stop the rubbing.
  const tx = -ny;
  const ty = nx;
  const vt = rvx * tx + rvy * ty;
  const jt =
    -Math.sign(vt) * Math.min(CAR_FRICTION * jn, Math.abs(vt) / (ia + ib));
  const jx = nx * jn + tx * jt;
  const jy = ny * jn + ty * jt;
  A.velocity.x -= jx * ia;
  A.velocity.y -= jy * ia;
  B.velocity.x += jx * ib;
  B.velocity.y += jy * ib;
  return -vn;
}

/** What one step of the whole field ran into. */
export interface FieldStep {
  /** Each car's speed into a wall this step (0 = none), aligned with the cars. */
  walls: number[];
  /** Cars that bumped each other. */
  contacts: CarContact[];
}

/**
 * Advance every car in the arena one fixed step on its input (aligned with
 * `arena.cars`), then settle car-to-car contact. The one place a race moves.
 * A car shoved off the road is put back on it, so none ends a step outside
 * the band, where it could slip round the end of a checkpoint.
 */
export function stepField(
  arena: Arena,
  inputs: readonly InputState[],
  dtS: number,
): FieldStep {
  const walls = arena.cars.map((c, i) =>
    stepCar(c.body, arena.walls, arena.track, inputs[i], c.stats, dtS),
  );
  const contacts = resolveCarContacts(arena.cars);
  if (contacts.length > 0)
    arena.cars.forEach((c, i) => {
      walls[i] = Math.max(walls[i], keepOnRoad(c.body, arena.track));
    });
  return { walls, contacts };
}

/** Signed forward speed (px/s) of the car, for the HUD / camera. */
export function forwardSpeed(car: M.Body): number {
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  return car.velocity.x * fx + car.velocity.y * fy;
}
