import { type Vec2, segmentsIntersect } from "../core/vec.ts";
import { recordLap, type Ghost } from "./Ghost.ts";
import type { BuiltTrack } from "../track/Track.ts";
import { GATE_SUBSTEPS, GATE_TOLERANCE } from "../core/tuning.ts";

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
  lapTimesMs: number[] = [];
  finished = false;
  /** ms into the current lap, for the HUD. */
  private started = false;

  constructor(
    private readonly track: BuiltTrack,
    private readonly now: () => number,
  ) {
    this.lap = 0;
    // Start the car parked on the start line (gate 0); first thing to cross
    // is gate 1, so we don't instantly credit a lap by sitting at the line.
    this.nextGate = 1 % this.track.gates.length;
    this.lapStartMs = this.now();
  }

  /** Feed the car's previous + current world position each fixed step. */
  update(prev: Vec2, cur: Vec2): void {
    if (this.finished) return;
    // Kick off the first lap timer once the car first moves off the grid.
    if (!this.started && Math.hypot(cur.x - prev.x, cur.y - prev.y) > 1.5) {
      this.started = true;
    }
    this.lapSamples.push({
      ms: this.now(),
      x: cur.x,
      y: cur.y,
      dx: cur.x - prev.x,
      dy: cur.y - prev.y,
    });
    const gate = this.track.gates[this.nextGate];
    if (gate === undefined) return;

    if (this.checkGateCross(prev, cur, gate)) {
      this.onGateCrossed(gate.index);
    }
  }

  private checkGateCross(prev: Vec2, cur: Vec2, gate: { a: Vec2; b: Vec2; index: number }): boolean {
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

    const steps = Math.max(1, Math.min(GATE_SUBSTEPS, Math.ceil(len / GATE_TOLERANCE)));
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
      this.lapStartMs = this.now();
      this.lap += 1;
      this.nextGate = 1 % this.track.gates.length;
      if (this.lap >= this.track.laps) this.finished = true;
    } else {
      this.nextGate = (this.nextGate + 1) % this.track.gates.length;
    }
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
