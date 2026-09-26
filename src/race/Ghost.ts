/**
 * Ghost line — a recording of a car's best lap, replayable as a "ghost" the
 * player can chase. Built from per-lap (t, x, y, heading) samples; replayed by
 * `sampleGhost`, which linearly interpolates a pose at any lap-relative time.
 * Pure math, so it's fully unit-testable without a screen. The *drawing* of a
 * ghost is a renderer concern and un-verifiable headless; this module is the
 * testable data + lookup that feeds it.
 */

/** One recorded frame: lap-relative time (ms) and the car's pose. */
export interface GhostPoint {
  t: number;
  x: number;
  y: number;
  heading: number;
}

export type Ghost = GhostPoint[];

/**
 * Most frames a stored ghost keeps. Every ghost rides in the one localStorage
 * save, so an unbounded one (a slow or idle lap) could blow the quota and stop
 * *all* progress from saving.
 */
export const MAX_GHOST_POINTS = 1500;

/** Evenly thin a ghost to at most `max` frames, keeping the first and last. */
export function capGhost(g: Ghost, max = MAX_GHOST_POINTS): Ghost {
  if (g.length <= max || max < 2) return g;
  const stride = (g.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => g[Math.round(i * stride)]);
}

/** Build a ghost from arbitrary samples: sort by time, drop dupes. */
export function makeGhost(points: GhostPoint[]): Ghost {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const out: Ghost = [];
  let last = -Infinity;
  for (const p of sorted) {
    if (p.t !== last) {
      out.push({ t: p.t, x: p.x, y: p.y, heading: p.heading });
      last = p.t;
    }
  }
  return out;
}

export interface Pose {
  x: number;
  y: number;
  heading: number;
}

/**
 * Replayed pose at lap-relative time `t`, linearly interpolated between the two
 * bracketing frames (heading the short way round, so a ghost crossing ±π
 * doesn't spin). Clamps to the ends outside the recorded span. Returns null
 * for an empty ghost.
 */
export function sampleGhost(g: Ghost, t: number): Pose | null {
  if (g.length === 0) return null;
  if (g.length === 1) return { x: g[0].x, y: g[0].y, heading: g[0].heading };
  if (t <= g[0].t) return poseFrom(g[0]);
  if (t >= g[g.length - 1].t) return poseFrom(g[g.length - 1]);

  // Binary search for the [lo, hi] bracket with g[lo].t <= t < g[hi].t.
  let lo = 0;
  let hi = g.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (g[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = g[lo];
  const b = g[hi];
  const f = (t - a.t) / (b.t - a.t || 1);
  let turn = (b.heading - a.heading) % (Math.PI * 2);
  if (turn > Math.PI) turn -= Math.PI * 2;
  else if (turn < -Math.PI) turn += Math.PI * 2;
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    heading: a.heading + turn * f,
  };
}

function poseFrom(p: GhostPoint): Pose {
  return { x: p.x, y: p.y, heading: p.heading };
}

/**
 * One raw step of a lap in progress: clock time, position, the step's
 * movement, and (when known) the body's heading.
 */
export interface LapSample {
  ms: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  heading?: number;
}

/**
 * Build a ghost from a single lap's samples. `startMs` is the lap's origin so
 * times become lap-relative. Samples at or before `startMs` are dropped. Each
 * frame keeps the body's heading when the sample has one (a drifting car
 * points off its line of travel), else faces the way it moved.
 */
export function recordLap(samples: LapSample[], startMs: number): Ghost {
  const pts: GhostPoint[] = [];
  let lastHeading = 0;
  for (const s of samples) {
    const t = s.ms - startMs;
    if (t < 0) continue;
    if (s.heading !== undefined && Number.isFinite(s.heading))
      lastHeading = s.heading;
    else if ((s.dx || s.dy) !== 0) lastHeading = Math.atan2(s.dy, s.dx);
    pts.push({ t, x: s.x, y: s.y, heading: lastHeading });
  }
  return capGhost(makeGhost(pts));
}
