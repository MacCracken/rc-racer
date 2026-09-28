import type { InputState } from "../core/Input.ts";
import type { BuiltTrack } from "../track/Track.ts";
import type { Vec2 } from "../core/vec.ts";
import {
  CAR_LENGTH,
  CAR_WIDTH,
  GRIP_ACCEL,
  type CarStats,
} from "../core/tuning.ts";

/**
 * A tiny autopilot the AI rivals run. It is intentionally simple: chase a
 * look-ahead point on its line, brake for each bend by what its car's grip
 * allows there, and steer back on-line if pushed wide. `pace` (0..1) sets how
 * close to that limit it runs, so per-track `aiPace` (and rival variety)
 * gives an imperfect-but-legible field — the roadmap's "imperfect but
 * legible" acceptance bar.
 *
 * In a field, each rival keeps to its own `lane` across the road, and a car
 * in its way ahead (the player too) pulls its line out to pass on whichever
 * side has the room, so the field races side by side instead of queueing
 * nose to tail. Shunted into a wall, it gets itself out (see `makeDriver`).
 *
 * Pure: no Matter, no clock — takes only position/velocity/angle + a track.
 */

/** The minimal view of a body the driver needs. */
export interface Drivable {
  position: Vec2;
  velocity: Vec2;
  angle: number;
}

/** How far a `lane` of ±1 sits from the middle, as a share of half the road. */
const LANE_REACH = 0.45;
/** Furthest off the middle the autopilot will aim, as a share of half the road. */
const LINE_LIMIT = 0.6;
/** A car ahead within this (px), and on our line, is in the way. */
const AVOID_AHEAD = 110;
/** Side-by-side gap (centre to centre, px) the autopilot passes with. */
const PASS_GAP = CAR_WIDTH * 1.9;
/** Following a car, lift off to keep at least this (centre to centre, px)… */
const FOLLOW_GAP = CAR_LENGTH * 1.7;
/** …easing all the way off at this… */
const FOLLOW_MIN = CAR_LENGTH * 1.05;
/** …and only when going faster than this (px/s). */
const FOLLOW_SPEED = 40;

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Index of the nearest centerline point to a position. */
function nearestIndex(cl: Vec2[], p: Vec2): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < cl.length; i++) {
    const dx = cl[i].x - p.x;
    const dy = cl[i].y - p.y;
    const d = dx * dx + dy * dy;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** Distance squared to the nearest centerline point (for the off-track check). */
function distSqToLine(cl: Vec2[], p: Vec2): number {
  let bd = Infinity;
  for (let i = 0; i < cl.length; i++) {
    const dx = cl[i].x - p.x;
    const dy = cl[i].y - p.y;
    const d = dx * dx + dy * dy;
    if (d < bd) bd = d;
  }
  // The nearest centerline *point* is a good proxy for "how far off line".
  return bd;
}

/** Unit normals of a closed centerline, on the same side as `Track`'s outer wall. */
const normalsCache = new WeakMap<Vec2[], Vec2[]>();
function normalsOf(cl: Vec2[]): Vec2[] {
  let ns = normalsCache.get(cl);
  if (ns === undefined) {
    const n = cl.length;
    ns = cl.map((_, i) => {
      const a = cl[(i - 1 + n) % n];
      const b = cl[(i + 1) % n];
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l };
    });
    normalsCache.set(cl, ns);
  }
  return ns;
}

/** Half the stretch of road (px) a bend's radius is measured across. */
const BEND_SPAN = 100;
/** The slowest the autopilot ever plans to take a bend (px/s). */
const BEND_MIN_SPEED = 45;

/**
 * Radius of the bend (px) at each centerline point: the circle through the
 * road `BEND_SPAN` behind and ahead of it. Measured over a stretch, not
 * point to point, so a short kink the road's width lets a car straighten
 * doesn't read as a hairpin.
 */
const radiiCache = new WeakMap<Vec2[], number[]>();
function radiiOf(cl: Vec2[]): number[] {
  let rs = radiiCache.get(cl);
  if (rs === undefined) {
    const n = cl.length;
    /** The point `BEND_SPAN` px along the road from point `i` (either way). */
    const walk = (i: number, dir: 1 | -1): Vec2 => {
      let left = BEND_SPAN;
      let at = i;
      for (let k = 0; k < n; k++) {
        const next = (at + dir + n) % n;
        const seg = Math.hypot(cl[next].x - cl[at].x, cl[next].y - cl[at].y);
        if (seg >= left) {
          const f = left / seg;
          return {
            x: cl[at].x + (cl[next].x - cl[at].x) * f,
            y: cl[at].y + (cl[next].y - cl[at].y) * f,
          };
        }
        left -= seg;
        at = next;
      }
      return cl[at];
    };
    rs = cl.map((b, i) => {
      const a = walk(i, -1);
      const c = walk(i, 1);
      const cross = Math.abs(
        (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
      );
      if (cross < 1e-9) return Infinity;
      const ab = Math.hypot(b.x - a.x, b.y - a.y);
      const bc = Math.hypot(c.x - b.x, c.y - b.y);
      const ca = Math.hypot(a.x - c.x, a.y - c.y);
      return (ab * bc * ca) / (2 * cross);
    });
    radiiCache.set(cl, rs);
  }
  return rs;
}

/**
 * How close to the cornering limit a driver of `pace` takes a bend: a share
 * of √(grip × radius) on the middle of the road. Over 1 is still on the
 * road, because the line through a bend is wider than its middle.
 */
const cornerMargin = (pace: number): number => 0.8 + 0.28 * pace;

/**
 * The fastest a car can be going at centerline point `idx` and still make
 * every bend within stopping reach: each bend's own speed (the tyres'
 * sideways pull, √(a × R), by `margin`), plus what braking over the road to
 * it can shed. `car` is as it drives here, conditions and all.
 */
function cornerSpeed(
  cl: Vec2[],
  idx: number,
  speed: number,
  car: CarStats,
  margin: number,
): number {
  const radii = radiiOf(cl);
  const n = cl.length;
  const a = GRIP_ACCEL * car.grip;
  const b = car.braking * 0.9;
  const bendAt = (i: number): number =>
    Math.max(BEND_MIN_SPEED, margin * Math.sqrt(a * radii[i]));
  const reach = (speed * speed) / (2 * b) + CAR_LENGTH * 2;
  let limit = bendAt(idx);
  let s = 0;
  for (let k = 1; k < n && s < reach; k++) {
    const i = (idx + k) % n;
    const p = cl[(i - 1 + n) % n];
    s += Math.hypot(cl[i].x - p.x, cl[i].y - p.y);
    const bend = bendAt(i);
    limit = Math.min(limit, Math.sqrt(bend * bend + 2 * b * s));
  }
  return limit;
}

/** Where the autopilot aims across the road, and how much throttle it keeps. */
export interface LineChoice {
  /** Offset from the middle of the road (px, + toward the outer wall). */
  offset: number;
  /** 0..1 of the throttle it would use: under 1 when following too close. */
  throttle: number;
}

/** Another car as seen from ours: how far ahead, how far across, how fast. */
interface Seen {
  car: Drivable;
  /** Ahead of us along our heading (px; negative = behind). */
  along: number;
  /** Across the road from us (px, + toward the outer wall). */
  side: number;
  /** Its speed along our heading (px/s). */
  speed: number;
}

/**
 * What a driver carries from step to step: the line it's steering for, and
 * the pass it's making, so it holds one side until the car is behind it
 * rather than weaving back in halfway past.
 */
export interface PassMemo {
  car: Drivable | null;
  /** +1 passing on its outer-wall side, -1 on its inner side. */
  side: number;
  /** The line it's steering for (px across the road; see `LineChoice`). */
  line?: number;
}

/** Most the line moves across the road in a step (px; 90 px/s). */
const LINE_STEP = 0.75;
/** Share of the gap still to make up beside a car the line moves per step. */
const PASS_GAIN = 0.03;

/**
 * The line to drive: `lane`, unless a car ahead is in our path. Then pass it
 * on the side we're already on — or the other, if ours is short of road or
 * has a car in it — and hold that side until we're by. With neither side
 * open, stay in line and keep a gap to it rather than drive into it.
 *
 * A pass is steered by the gap itself: the line moves across by a share of
 * the difference between how far to the side of the other car we are and
 * how far we want to be, until they match. The autopilot cuts in toward every
 * apex, so where a car sits on the road says as much about the corner as
 * about its line; car to car, the corner cancels out. (Aiming for a spot
 * worked out from the middle of the road put a passing car right back in
 * line behind the car it was passing.)
 */
export function chooseLine(
  d: Drivable,
  track: BuiltTrack,
  lane: number,
  traffic: readonly Drivable[],
  memo: PassMemo = { car: null, side: 0 },
): LineChoice {
  const cl = track.centerLine;
  const idx = nearestIndex(cl, d.position);
  const n = normalsOf(cl)[idx];
  const half = track.width / 2;
  const limit = half * LINE_LIMIT;
  const clampLine = (x: number): number => Math.max(-limit, Math.min(limit, x));
  const own = clampLine(lane * half * LANE_REACH);
  // Where our centre may go before the wall pushes back, less a margin.
  const road = half - CAR_LENGTH * 0.35 - CAR_WIDTH * 0.5;

  const fx = Math.cos(d.angle);
  const fy = Math.sin(d.angle);
  const mine =
    (d.position.x - cl[idx].x) * n.x + (d.position.y - cl[idx].y) * n.y;
  const speed = d.velocity.x * fx + d.velocity.y * fy;
  const seen: Seen[] = traffic.map((car) => {
    const rx = car.position.x - d.position.x;
    const ry = car.position.y - d.position.y;
    return {
      car,
      along: rx * fx + ry * fy,
      side: rx * n.x + ry * n.y,
      speed: car.velocity.x * fx + car.velocity.y * fy,
    };
  });

  // Carry on a pass until that car is behind us (or gone away up the road).
  let pass = seen.find((o) => o.car === memo.car);
  if (
    pass !== undefined &&
    (pass.along < -CAR_LENGTH * 0.6 ||
      pass.along > AVOID_AHEAD * 1.3 ||
      Math.abs(pass.side) > PASS_GAP * 1.7)
  )
    pass = undefined;
  if (pass === undefined) {
    memo.car = null;
    // The nearest car ahead in our path that we're not falling behind.
    for (const o of seen) {
      if (o.along <= 0 || o.along >= (pass?.along ?? AVOID_AHEAD)) continue;
      if (Math.abs(o.side) >= PASS_GAP) continue;
      if (o.speed > speed + 5 && o.along > FOLLOW_GAP) continue; // pulling away
      pass = o;
    }
  }

  const line = memo.line ?? own;
  // Back toward our own lane, unless a pass says otherwise.
  let move = own - line;
  if (pass !== undefined) {
    const b = pass;
    // Pass `side` of it: open if that spot is on the road (right here, where
    // we really are) and no other car is in it.
    const open = (side: number): boolean => {
      const across = b.side + side * PASS_GAP;
      if (Math.abs(mine + across) > road) return false;
      return seen.every(
        (o) =>
          o === b ||
          o.along < -CAR_LENGTH ||
          o.along > b.along + CAR_LENGTH ||
          Math.abs(o.side - across) >= PASS_GAP * 0.9,
      );
    };
    const first =
      memo.car === b.car
        ? memo.side
        : b.side > 0 || (b.side === 0 && lane < 0)
          ? -1
          : 1;
    const side = open(first) ? first : open(-first) ? -first : 0;
    if (side !== 0) {
      // How far we still are from `PASS_GAP` to that side of it.
      move = PASS_GAIN * (b.side + side * PASS_GAP);
      memo.car = b.car;
      memo.side = side;
    } else {
      // Boxed in: hold our line and keep a gap (below).
      move = 0;
      memo.car = null;
    }
  }
  const offset = Math.max(
    -half * 0.9,
    Math.min(
      half * 0.9,
      line + Math.max(-LINE_STEP, Math.min(LINE_STEP, move)),
    ),
  );
  memo.line = offset;

  // Right on our nose and no faster than us: back off to keep a gap. Never
  // from a crawl, though: two cars nose to nose after a shunt would each
  // wait for the other forever.
  let throttle = 1;
  for (const o of seen) {
    if (speed < FOLLOW_SPEED || o.along <= 0 || o.along >= FOLLOW_GAP) continue;
    if (Math.abs(o.side) >= CAR_WIDTH * 1.2 || o.speed > speed + 5) continue;
    const room = (o.along - FOLLOW_MIN) / (FOLLOW_GAP - FOLLOW_MIN);
    throttle = Math.min(throttle, Math.max(0, Math.min(1, room)));
  }
  return { offset, throttle };
}

/**
 * Produce the driver input for one step, written into (and returned from) `out`
 * so the race loop can reuse it. `line` is where across the road to aim (see
 * `chooseLine`); the default is the middle. Given the `car` it drives (stats
 * as on this track), it brakes for each bend by the speed its grip allows
 * there (see `cornerSpeed`); without, by how sharply the road turns.
 */
export function aiInput(
  d: Drivable,
  track: BuiltTrack,
  pace: number,
  out: InputState,
  lookaheadFrac = 0.06,
  line: LineChoice = { offset: 0, throttle: 1 },
  car?: CarStats,
): InputState {
  const cl = track.centerLine;
  const L = cl.length;
  const look = Math.max(4, Math.round(L * lookaheadFrac));
  const idx = nearestIndex(cl, d.position);

  // A stable look-ahead target *along* the loop, on our line across it.
  const ai = (idx + look) % L;
  const n = normalsOf(cl)[ai];
  const ahead = {
    x: cl[ai].x + n.x * line.offset,
    y: cl[ai].y + n.y * line.offset,
  };
  const desired = Math.atan2(ahead.y - d.position.y, ahead.x - d.position.x);
  const err = wrap(desired - d.angle);

  // Corner sharpness from the direction change over two look-ahead windows.
  const p0 = cl[(idx + look) % L];
  const p1 = cl[(idx + L - 1) % L];
  const p2 = cl[(idx + 2 * look) % L];
  const a1 = Math.atan2(p0.y - p1.y, p0.x - p1.x);
  const a2 = Math.atan2(p2.y - p0.y, p2.x - p0.x);
  const turn = Math.abs(wrap(a2 - a1));

  // Forward speed (Matter velocity is px/s in our model).
  const fx = Math.cos(d.angle);
  const fy = Math.sin(d.angle);
  const speed = d.velocity.x * fx + d.velocity.y * fy;

  // A higher pace carries more speed: brakes later, eases in less. Pointed
  // well off the target (a hairpin, a spin), it feathers the throttle round;
  // (throttle wins over brake in `stepCar`, so that never reverses it).
  const p = Math.max(0, Math.min(1, pace));
  const feather = Math.abs(err) > 0.45 + 0.55 * p;
  // Over the speed its grip allows for the bends ahead: off the throttle and
  // on the brake. Near it: ease off. Blind to the car: feather for a turn.
  let braking = false;
  let easing = feather;
  if (car === undefined) {
    easing ||= turn > 0.5 + 0.45 * p;
  } else {
    const limit = cornerSpeed(cl, idx, speed, car, cornerMargin(p));
    braking = speed > limit + 4;
    easing ||= speed > limit - 8;
  }

  // Rolling backwards the nose swings against the wheel: steer the other way.
  out.steer = Math.max(-1, Math.min(1, err * 1.5)) * (speed < -2 ? -1 : 1);
  out.brake = braking || easing ? 0.9 : 0;
  out.throttle =
    (braking ? 0 : easing ? 0.35 * p + 0.15 : 0.7 + 0.3 * p) * line.throttle;
  out.handbrake = Math.abs(err) > 1.15 && Math.abs(speed) > 120;

  // If pushed to the track edge, steer back toward the line.
  if (distSqToLine(cl, d.position) > (track.width * 0.32) ** 2) {
    let nx = 0;
    let ny = 0;
    let bd = Infinity;
    for (let i = 0; i < L; i++) {
      const dx = cl[i].x - d.position.x;
      const dy = cl[i].y - d.position.y;
      const dd = dx * dx + dy * dy;
      if (dd < bd) {
        bd = dd;
        nx = dx;
        ny = dy;
      }
    }
    const back = wrap(Math.atan2(ny, nx) - d.angle);
    out.steer = Math.max(-1, Math.min(1, back * 1.8));
  }
  return out;
}

export interface AiOptions {
  /** 0..1 target pace; higher = carries more speed through corners. */
  pace: number;
  /** Look-ahead as a fraction of the track (higher = smoother through curves). */
  lookahead?: number;
  /** Preferred line across the road, -1..1 (0 = the middle, the default). */
  lane?: number;
  /**
   * The car it drives, as on this track (conditions applied), to brake for
   * each bend by what its grip allows. Without it, it brakes by how sharply
   * the road turns, blind to the car.
   */
  car?: CarStats;
}

/** A car this slow (px/s)… */
const STUCK_SPEED = 25;
/** …turned this far off the road's direction (rad)… */
const STUCK_ANGLE = 0.35;
/** …for this many steps is stuck, nose to a wall. */
const STUCK_STEPS = 45;
/** Steps it reverses out for (at most); it stops once pointing down the road. */
const BACK_OUT_STEPS = 180;
/** Reversing this long without getting going backwards means it's blocked… */
const BLOCKED_STEPS = 40;
/** …so it drives out forwards instead, for up to this many steps. */
const DRIVE_OUT_STEPS = 120;

/**
 * Convenience wrapper: build a one-shot driver for a pace. Pass the other
 * cars on the road as `traffic` to have it race them (see `chooseLine`).
 *
 * A car shunted to a stop against a wall can't steer out (steering needs
 * speed, and the throttle only presses it into the wall), so the driver
 * gets itself out: it backs away, turning the nose back down the road —
 * or, wedged with a wall behind it too, drives out forwards on full lock —
 * then races on.
 */
export function makeDriver(
  track: BuiltTrack,
  options: AiOptions,
): (d: Drivable, traffic?: readonly Drivable[]) => InputState {
  const out: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  const lo = options.lookahead ?? 0.06;
  const lane = options.lane ?? 0;
  const memo: PassMemo = { car: null, side: 0 };
  let stuck = 0;
  /** Getting unstuck: how, and how many steps it has been doing it. */
  let escape: { way: "back" | "out"; steps: number } | null = null;
  return (d: Drivable, traffic: readonly Drivable[] = []): InputState => {
    const cl = track.centerLine;
    const i = nearestIndex(cl, d.position);
    const n = normalsOf(cl)[i];
    // Off the road's direction (+ = turned clockwise of it).
    const off = wrap(d.angle - Math.atan2(-n.x, n.y));
    const speed =
      d.velocity.x * Math.cos(d.angle) + d.velocity.y * Math.sin(d.angle);
    stuck =
      Math.abs(speed) < STUCK_SPEED && Math.abs(off) > STUCK_ANGLE
        ? stuck + 1
        : 0;
    if (escape === null && stuck > STUCK_STEPS)
      escape = { way: "back", steps: 0 };
    if (escape !== null) {
      escape.steps += 1;
      stuck = 0;
      const pointed = Math.abs(off) < STUCK_ANGLE;
      if (escape.way === "back") {
        if (escape.steps >= BLOCKED_STEPS && speed > -STUCK_SPEED / 3)
          escape = { way: "out", steps: 0 };
        else if (pointed || escape.steps >= BACK_OUT_STEPS) escape = null;
      } else if (
        (pointed && speed > STUCK_SPEED) ||
        escape.steps >= DRIVE_OUT_STEPS
      )
        escape = null;
      if (escape !== null) {
        // Backing out, the nose swings against the wheel: steer with the
        // error; driving out, against it.
        const back = escape.way === "back";
        out.throttle = back ? 0 : 1;
        out.brake = back ? 1 : 0;
        out.steer = back ? Math.sign(off) : -Math.sign(off);
        out.handbrake = false;
        return out;
      }
    }
    return aiInput(
      d,
      track,
      options.pace,
      out,
      lo,
      lane === 0 && traffic.length === 0
        ? undefined
        : chooseLine(d, track, lane, traffic, memo),
      options.car,
    );
  };
}
