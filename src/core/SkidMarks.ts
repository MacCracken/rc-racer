import type { Vec2 } from "./vec.ts";

/**
 * Skid-mark trail — a pure, decaying buffer of tire skids. Kept framework-free
 * so its behaviour (when marks appear, how they fade, the count cap, and the
 * object reuse that keeps the hot path GC-free) is unit-testable without a
 * canvas. The renderer draws `state.marks`; the race loop calls `sampleDrift`
 * + `ageMarks` each fixed step.
 *
 * GC-friendliness: marks are not allocated per frame. A `pool` recycles each
 * mark as it fades or is evicted, so a sustained drift allocates nothing new —
 * the allocation-free property the 60fps pass depends on.
 */

export interface SkidMark {
  x: number;
  y: number;
  angle: number;
    /** 1 = fresh, 0 = fully faded; rendered as alpha. */
  alpha: number;
}

export interface SkidState {
     /** Visible marks, drawn by the renderer each frame. */
  marks: SkidMark[];
     /** Recycled marks, reused by `sampleDrift` instead of allocating. */
  pool: SkidMark[];
}

/** Hard cap on stored marks so the buffer can't grow unbounded. */
export const MAX_MARKS = 400;
/** Seconds a mark stays fully visible before fading out. */
export const SKID_LIFETIME = 2.4;
    /** Pool cap: at worst we hold ~2x MAX mark objects, then let GC reclaim. */
const POOL_CAP = MAX_MARKS;

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
    return { marks: [], pool: [] };
      }

  /**
    * Take a mark for the trail, reused from the pool when possible so a
    * sustained drift never allocates. `alpha` is reset to "fresh".
    */
function take(state: SkidState): SkidMark {
    const m = state.pool.pop();
    if (m !== undefined) {
      m.alpha = 1;
        return m;
      }
    return { x: 0, y: 0, angle: 0, alpha: 1 };
    }

    /**
     * Return a mark to the pool when it's free, so the next drift step reuses
     * it. Bounded by POOL_CAP — beyond that we let the GC reclaim it.
     */
function recycle(state: SkidState, m: SkidMark): void {
    if (state.pool.length >= POOL_CAP) return;
    state.pool.push(m);
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

    // Rear-axle centre, reusing each mark, split by the car width.
    const rx = body.position.x - fx * (o.carLength / 2);
    const ry = body.position.y - fy * (o.carLength / 2);
    const mR = take(state);
    mR.x = rx + lx * (o.carWidth / 2);
    mR.y = ry + ly * (o.carWidth / 2);
    mR.angle = f;
    state.marks.push(mR);
    const mL = take(state);
    mL.x = rx - lx * (o.carWidth / 2);
    mL.y = ry - ly * (o.carWidth / 2);
    mL.angle = f;
    state.marks.push(mL);

     // Keep the most recent marks; recycle the evicted ones into the pool.
    if (state.marks.length > MAX_MARKS) {
      const evicted = state.marks.splice(0, state.marks.length - MAX_MARKS);
      for (const m of evicted) recycle(state, m);
       }
    return 2;
    }

/** Age the trail: fade alpha, then route fully-faded marks back to the pool. */
export function ageMarks(state: SkidState, dt: number): void {
   if (dt <= 0) return;
     // A full lifetime means every existing mark has expired.
    if (dt >= SKID_LIFETIME) {
      for (const m of state.marks) recycle(state, m);
      state.marks.length = 0;
        return;
      }
    const decay = dt / SKID_LIFETIME;
    const marks = state.marks;
    let keep = 0;
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i];
      m.alpha -= decay;
        // In-place compaction keeps the array reference stable (no realloc).
      if (m.alpha > 0.02) {
        marks[keep] = m;
          keep += 1;
         } else {
        recycle(state, m);
      }
     }
    marks.length = keep;
    }

/** Remaining visible mark count. */
export function visibleCount(state: SkidState): number {
    return state.marks.length;
      }
