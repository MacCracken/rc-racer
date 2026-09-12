import type { InputState } from "../core/Input.ts";
import type { BuiltTrack } from "../track/Track.ts";
import type { Vec2 } from "../core/vec.ts";

/**
 * A tiny autopilot the AI rivals run. It is intentionally simple: chase a
 * look-ahead point on the centerline, brake for corners, and steer back
 * on-line if pushed wide. `pace` (0..1) scales target speed, so per-track
 * `aiPace` (and rival variety) gives an imperfect-but-legible field — the
 * roadmap's "imperfect but legible" acceptance bar.
 *
 * Pure: no Matter, no clock — takes only position/velocity/angle + a track.
 */

/** The minimal view of a body the driver needs. */
export interface Drivable {
  position: Vec2;
  velocity: Vec2;
  angle: number;
}

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

/**
 * Produce the driver input for one step, written into (and returned from) `out`
 * so the race loop can reuse it.
 */
export function aiInput(
  d: Drivable,
  track: BuiltTrack,
  pace: number,
  out: InputState,
  lookaheadFrac = 0.06,
): InputState {
  const cl = track.centerLine;
  const L = cl.length;
  const look = Math.max(4, Math.round(L * lookaheadFrac));
  const idx = nearestIndex(cl, d.position);

  // A stable look-ahead target *along* the loop.
  const ahead = cl[(idx + look) % L];
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

  // A higher pace carries more speed: brakes later, eases in less.
  const p = Math.max(0, Math.min(1, pace));
  const brakeErr = 0.45 + 0.55 * p;
  const brakeTurn = 0.5 + 0.45 * p;
  const braking = Math.abs(err) > brakeErr || turn > brakeTurn;

  out.steer = Math.max(-1, Math.min(1, err * 1.5));
  out.brake = braking ? 0.9 : 0;
  out.throttle = braking ? 0.35 * p + 0.15 : 0.7 + 0.3 * p;
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
}

/** Convenience wrapper: build a one-shot driver for a pace. */
export function makeDriver(
  track: BuiltTrack,
  options: AiOptions,
): (d: Drivable) => InputState {
  const out: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  const lo = options.lookahead ?? 0.06;
  return (d: Drivable): InputState => aiInput(d, track, options.pace, out, lo);
}
