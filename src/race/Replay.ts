/**
 * A race replay: every car's pose through the race, to watch back from the
 * results. Kept in memory for the last race only — never saved — and small:
 * four cars at 30 Hz over a minute is a few thousand poses. Pure: the Game
 * records poses as it steps the race, and replays them by `sampleReplay`.
 */

/** One car at one moment: its pose, and what its wheels and lights show. */
export interface CarPose {
  x: number;
  y: number;
  angle: number;
  steer: number;
  braking: boolean;
}

export interface ReplayFrame {
  /** Race clock (ms) since GO. */
  t: number;
  /** Every car, player first, in the arena's order. */
  cars: CarPose[];
}

export type Replay = ReplayFrame[];

/** How often a pose is recorded: plenty for smooth interpolated playback. */
export const REPLAY_INTERVAL_MS = 1000 / 30;

/**
 * Builds a replay as the race runs. Ask `due(t)` each step and only build
 * the poses when a frame is wanted (about every `REPLAY_INTERVAL_MS`), so
 * the race loop makes no garbage in between; `record` also takes an
 * off-beat frame (the finish), so the replay ends exactly on it.
 */
export class ReplayRecorder {
  private readonly frames: ReplayFrame[] = [];

  /** Is a frame due at race time `t` (ms)? */
  due(t: number): boolean {
    const last = this.frames[this.frames.length - 1];
    return last === undefined || t - last.t >= REPLAY_INTERVAL_MS - 1e-6;
  }

  /** Keep the cars' poses at race time `t` (copied; `t` never goes back). */
  record(t: number, cars: readonly CarPose[]): void {
    const last = this.frames[this.frames.length - 1];
    if (last !== undefined && t <= last.t) return;
    this.frames.push({ t, cars: cars.map((c) => ({ ...c })) });
  }

  /** The replay so far. */
  finish(): Replay {
    return this.frames;
  }
}

/** How long a replay runs (ms). */
export function replayLength(r: Replay): number {
  return r.length === 0 ? 0 : r[r.length - 1].t - r[0].t;
}

/** Turn from `a` to `b` the short way round (radians). */
function turn(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Every car's pose at replay time `t` (ms from the replay's start),
 * interpolated between the frames either side (headings the short way
 * round), clamped to the first and last frames. Null for an empty replay.
 */
export function sampleReplay(r: Replay, t: number): CarPose[] | null {
  if (r.length === 0) return null;
  const at = r[0].t + t;
  if (r.length === 1 || at <= r[0].t) return r[0].cars.map((c) => ({ ...c }));
  const end = r[r.length - 1];
  if (at >= end.t) return end.cars.map((c) => ({ ...c }));
  let lo = 0;
  let hi = r.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (r[mid].t <= at) lo = mid;
    else hi = mid;
  }
  const a = r[lo];
  const b = r[hi];
  const f = (at - a.t) / (b.t - a.t || 1);
  return a.cars.map((p, i) => {
    const q = b.cars[i] ?? p;
    return {
      x: p.x + (q.x - p.x) * f,
      y: p.y + (q.y - p.y) * f,
      angle: p.angle + turn(p.angle, q.angle) * f,
      steer: p.steer + (q.steer - p.steer) * f,
      braking: p.braking,
    };
  });
}
