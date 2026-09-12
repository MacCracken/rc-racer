import type { Vec2 } from "./vec.ts";

/**
 * Skid-mark trail — a pure, decaying buffer of tire skids. Kept framework-free
 * so its behaviour (when marks appear, how they fade, the count cap) is unit-
 * testable without a canvas. The renderer draws `state.marks`; the race loop
 * calls `sampleDrift` + `ageMarks` each fixed step.
 */

export interface SkidMark {
  x: number;
  y: number;
  angle: number;
  /** 1 = fresh, 0 = fully faded; rendered as alpha. */
  alpha: number;
}

export interface SkidState {
  marks: SkidMark[];
}

/** Hard cap on stored marks so the buffer can't grow unbounded. */
export const MAX_MARKS = 900;
/** Seconds a mark stays fully visible before fading out. */
export const SKID_LIFETIME = 2.4;

/** A body good enough to read kinematics from (Matter.Body satisfies this). */
export interface BodyLike {
  position: Vec2;
  angle: number;
  velocity: { x: number; y: number };
}

export interface DriftOpts {
  carLength: number;
  carWidth: number;
  maxSpeed: number;
  /** Min |forward|/maxSpeed below which no marks are laid. */
  minSpeedFrac?: number;
  /** Min |lateral|/|forward| that counts as "sliding". */
  slipRatio?: number;
}

const DEFAULTS: Required<DriftOpts> = {
  carLength: 30,
  carWidth: 16,
  maxSpeed: 200,
  minSpeedFrac: 0.18,
  slipRatio: 0.16,
};

export function createSkid(): SkidState {
  return { marks: [] };
}

/**
 * Lay rear-wheel skid marks for a sliding car. Adds 0 or 2 marks (one per rear
 * wheel) and returns the count added.
 *
 * A mark is laid only when the car is moving fast enough *and* its sideways
 * velocity is a meaningful fraction of its forward velocity — so coasting and
 * parking-in-a-spin never leave a trail.
 */
export function sampleDrift(
  state: SkidState,
  body: BodyLike,
  opts?: Partial<DriftOpts>,
): number {
  const o = { ...DEFAULTS, ...opts };
  const f = body.angle;
  const fx = Math.cos(f);
  const fy = Math.sin(f);
  // left / unit-lateral
  const lx = -fy;
  const ly = fx;

  const forward = body.velocity.x * fx + body.velocity.y * fy;
  const lateral = body.velocity.x * lx + body.velocity.y * ly;
  const speedFrac = Math.abs(forward) / Math.max(1, o.maxSpeed);

  if (speedFrac < o.minSpeedFrac) return 0;
  const slip = Math.abs(lateral) / Math.max(1, Math.abs(forward));
  if (slip < o.slipRatio) return 0;

  // Rear-axle centre, then one mark per rear wheel, split by the car width.
  const rx = body.position.x - fx * (o.carLength / 2);
  const ry = body.position.y - fy * (o.carLength / 2);
  state.marks.push({
    x: rx + lx * (o.carWidth / 2),
    y: ry + ly * (o.carWidth / 2),
    angle: f,
    alpha: 1,
  });
  state.marks.push({
    x: rx - lx * (o.carWidth / 2),
    y: ry - ly * (o.carWidth / 2),
    angle: f,
    alpha: 1,
  });

  if (state.marks.length > MAX_MARKS)
    state.marks.splice(0, state.marks.length - MAX_MARKS);
  return 2;
}

/** Age the trail: fade alpha, drop fully-faded marks. */
export function ageMarks(state: SkidState, dt: number): void {
  if (dt <= 0) return;
  const decay = dt / SKID_LIFETIME;
  if (decay >= 1) {
    state.marks.length = 0;
    return;
  }
  state.marks = state.marks.filter((m) => {
    m.alpha -= decay;
    return m.alpha > 0.02;
  });
}

/** Remaining visible mark count. */
export function visibleCount(state: SkidState): number {
  return state.marks.length;
}
