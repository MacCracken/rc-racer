/**
 * Live split vs a ghost lap: how far ahead (negative) or behind (positive) of
 * a recorded lap the player is *at the same point on the track*. The ghost is
 * indexed by distance along the centerline, so the question is "when did the
 * ghost get here?", not "where was the ghost at this time?" — the latter
 * swings wildly through corners where both cars are slow.
 *
 * Pure: geometry comes in as an `arcOf` function (see `RaceState.arcOf`).
 */
import type { Vec2 } from "../core/vec.ts";
import type { Ghost } from "./Ghost.ts";

export interface Splits {
  /** Distance into the lap (px), strictly increasing. */
  s: number[];
  /** Lap time (ms) the ghost first reached each `s[i]`. */
  t: number[];
}

/**
 * Index a ghost lap by distance. `arcOf` maps a point to its arc position on
 * the loop (0 at the start line, wrapping at `lapLength`); frames are unwrapped
 * into one continuous run so the frames either side of the line don't jump a
 * lap. Only forward progress is kept (a spin that backs up doesn't count), so
 * each distance maps to the first time the ghost reached it.
 */
export function buildSplits(
  ghost: Ghost,
  arcOf: (p: Vec2) => number,
  lapLength: number,
): Splits {
  const s: number[] = [];
  const t: number[] = [];
  if (ghost.length < 2 || !(lapLength > 0)) return { s, t };
  const wrap = (d: number): number => d - lapLength * Math.round(d / lapLength);
  let prevArc = arcOf(ghost[0]);
  // The lap opens on the start line: ~0, or a hair before it.
  let dist = wrap(prevArc);
  let reach = -Infinity;
  for (const g of ghost) {
    const arc = arcOf(g);
    dist += wrap(arc - prevArc);
    prevArc = arc;
    if (dist > reach) {
      reach = dist;
      s.push(dist);
      t.push(g.t);
    }
  }
  return { s, t };
}

/**
 * Lap time (ms) at which the ghost first reached `dist` px into the lap,
 * interpolated between frames; null outside the recorded span.
 */
export function ghostTimeAt(sp: Splits, dist: number): number | null {
  const { s, t } = sp;
  const n = s.length;
  if (n < 2 || !(dist >= s[0] && dist <= s[n - 1])) return null;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid] <= dist) lo = mid;
    else hi = mid;
  }
  const f = (dist - s[lo]) / (s[hi] - s[lo]);
  return t[lo] + (t[hi] - t[lo]) * f;
}
