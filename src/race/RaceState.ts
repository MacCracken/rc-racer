import { type Vec2, segmentsIntersect } from "../core/vec.ts";
import { recordLap, type Ghost } from "./Ghost.ts";
import type { BuiltTrack } from "../track/Track.ts";
import { GATE_SUBSTEPS, GATE_TOLERANCE } from "../core/tuning.ts";

/** Min spacing between recorded lap samples: ~30 Hz is plenty for a ghost line. */
const SAMPLE_INTERVAL_MS = 1000 / 30;
/** Per-step movement (px) below which the car still counts as parked. */
const PARKED_EPS = 1e-6;

/** Arc length (px) along the closed centerline of its closest point to `p`. */
function arcPosition(cl: Vec2[], arc: number[], p: Vec2): number {
  let best = Infinity;
  let bestArc = 0;
  const n = cl.length;
  for (let i = 0; i < n; i++) {
    const a = cl[i];
    const b = cl[(i + 1) % n];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    const t =
      len2 === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2),
          );
    const d = Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
    if (d < best) {
      best = d;
      bestArc = arc[i] + Math.sqrt(len2) * t;
    }
  }
  return bestArc;
}

function pointToSegmentDist(p: Vec2, a: Vec2, b: Vec2): number {
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abLen2 = abx * abx + aby * aby;
  if (abLen2 === 0) return Math.hypot(apx, apy);
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLen2));
  const cx = a.x + abx * t;
  const cy = a.y + aby * t;
  return Math.hypot(p.x - cx, p.y - cy);
}

/**
 * Sequenced checkpoint / lap detection. The car must cross gates in index
 * order (1..N-1..0); crossing gate 0 (the start/finish) after the rest
 * completes a lap. This order requirement is what makes the lap count honest
 * even if the car skids off-line — you can't bank a lap without going around.
 *
 * Pure: no Matter, no time source. `now` is injected so it's unit-testable.
 */
export class RaceState {
  lap: number;
  nextGate: number;
  lapStartMs: number;
  lastLapMs = 0;
  bestLapMs = Infinity;
  /** The car's best-lap pose timeline, for a ghost the player can chase. */
  bestGhost: Ghost = [];
  /** Raw per-step pose samples for the lap in progress; promoted on a new best. */
  private lapSamples: {
    ms: number;
    x: number;
    y: number;
    dx: number;
    dy: number;
  }[] = [];
  /** Clock time of the last recorded lap sample (samples are throttled). */
  private lastSampleMs = -Infinity;
  lapTimesMs: number[] = [];
  finished = false;
  /** Clock time the final lap was completed (Infinity while racing). */
  finishMs = Infinity;
  /** False until the car first moves off the grid; the lap clock waits for it. */
  private started = false;
  /** Cumulative centerline arc length at each centerline point. */
  private readonly arc: number[];
  /** Arc length of each gate, and of one full lap, for `progress`. */
  private readonly gateArc: number[];
  private readonly lapLength: number;

  constructor(
    private readonly track: BuiltTrack,
    private readonly now: () => number,
  ) {
    this.lap = 0;
    // Start the car parked on the start line (gate 0); first thing to cross
    // is gate 1, so we don't instantly credit a lap by sitting at the line.
    this.nextGate = 1 % this.track.gates.length;
    this.lapStartMs = this.now();

    const cl = track.centerLine;
    this.arc = [0];
    let total = 0;
    for (let i = 0; i < cl.length; i++) {
      const a = cl[i];
      const b = cl[(i + 1) % cl.length];
      total += Math.hypot(b.x - a.x, b.y - a.y);
      if (i + 1 < cl.length) this.arc.push(total);
    }
    this.lapLength = total;
    this.gateArc = track.gates.map((g) => arcPosition(cl, this.arc, g.center));
  }

  /** Feed the car's previous + current world position each fixed step. */
  update(prev: Vec2, cur: Vec2): void {
    if (this.finished) return;
    // Hold the lap clock at zero while the car is still parked on the grid, so
    // the first lap is timed from the moment it moves, not from race start.
    if (!this.started) {
      if (Math.hypot(cur.x - prev.x, cur.y - prev.y) <= PARKED_EPS) {
        this.lapStartMs = this.now();
        return;
      }
      this.started = true;
    }
    // Throttled: a per-step (120 Hz) log bloats the saved ghost and grows
    // without bound if the player idles mid-lap.
    const ms = this.now();
    if (ms - this.lastSampleMs >= SAMPLE_INTERVAL_MS) {
      this.lapSamples.push({
        ms,
        x: cur.x,
        y: cur.y,
        dx: cur.x - prev.x,
        dy: cur.y - prev.y,
      });
      this.lastSampleMs = ms;
    }
    const gate = this.track.gates[this.nextGate];
    if (gate === undefined) return;

    if (this.checkGateCross(prev, cur, gate)) {
      this.onGateCrossed(gate.index);
    }
  }

  private checkGateCross(
    prev: Vec2,
    cur: Vec2,
    gate: { a: Vec2; b: Vec2; index: number },
  ): boolean {
    // Fast path: exact segment intersection
    if (segmentsIntersect(prev, cur, gate.a, gate.b)) return true;

    // Sub-step the segment to avoid tunneling through narrow gates at high speed.
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return false;

    // If the step is tiny, use a proximity check – the unit test walks the centerline.
    if (len < GATE_TOLERANCE * 2) {
      return pointToSegmentDist(cur, gate.a, gate.b) <= GATE_TOLERANCE;
    }

    const steps = Math.max(
      1,
      Math.min(GATE_SUBSTEPS, Math.ceil(len / GATE_TOLERANCE)),
    );
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const p0 = { x: prev.x + dx * t0, y: prev.y + dy * t0 };
      const p1 = { x: prev.x + dx * t1, y: prev.y + dy * t1 };
      if (segmentsIntersect(p0, p1, gate.a, gate.b)) return true;
      // Allow a small miss distance for fast moves
      if (pointToSegmentDist(p1, gate.a, gate.b) <= GATE_TOLERANCE) return true;
    }
    return false;
  }

  private onGateCrossed(gateIndex: number): void {
    if (gateIndex === 0) {
      const t = this.now() - this.lapStartMs;
      this.lastLapMs = t;
      this.lapTimesMs.push(t);
      const isBest = t < this.bestLapMs; // Infinity on the first lap
      if (isBest) {
        this.bestLapMs = t;
        this.bestGhost = recordLap(this.lapSamples, this.lapStartMs);
      }
      this.lapSamples = [];
      this.lastSampleMs = -Infinity;
      this.lapStartMs = this.now();
      this.lap += 1;
      this.nextGate = 1 % this.track.gates.length;
      if (this.lap >= this.track.laps) {
        this.finished = true;
        this.finishMs = this.now();
      }
    } else {
      this.nextGate = (this.nextGate + 1) % this.track.gates.length;
    }
  }

  /**
   * Distance raced so far (px along the centerline), for live race order. The
   * car's arc position is measured from the last gate it crossed and capped at
   * the next one, so skipping a gate can't jump it ahead and straddling the
   * start line can't make it look a lap up (or down).
   */
  progress(pos: Vec2): number {
    const G = this.gateArc.length;
    const L = this.lapLength;
    if (G === 0 || L === 0) return 0;
    const last = (this.nextGate - 1 + G) % G;
    const from = this.gateArc[last];
    const to = last === G - 1 ? L : this.gateArc[last + 1];
    let ds = arcPosition(this.track.centerLine, this.arc, pos) - from;
    ds -= L * Math.round(ds / L); // wrap into [-L/2, L/2]
    return this.lap * L + from + Math.max(0, Math.min(to - from, ds));
  }
}

/** format ms as mm:ss.mmm (e.g. 1:04.320). */
export function formatLap(ms: number): string {
  if (!isFinite(ms) || ms <= 0) return "--:--.---";
  const totalMs = Math.round(ms);
  const m = Math.floor(totalMs / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const mm = totalMs % 1000;
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  return `${m}:${pad(s, 2)}.${pad(mm, 3)}`;
}

/** ms into the current lap for the HUD (live). */
export function currentLapTimeMs(race: RaceState, now: number): number {
  return now - race.lapStartMs;
}
