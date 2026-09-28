/**
 * What the HUD calls out as a race goes: each lap as it closes (its time,
 * and whether it was your best or a new track record), the final lap, and
 * driving the wrong way round. Pure: fed by the race, drawn by the renderer.
 */
import { formatLap, type RaceState } from "./RaceState.ts";

/** A line across the middle of the screen, for a moment. */
export interface Callout {
  title: string;
  detail?: string;
  /** What kind of news it is, for its colour. */
  tone: "record" | "best" | "final" | "lap";
  /** Race clock (ms) it went up. */
  atMs: number;
}

/** How long a callout stays up (ms). */
export const CALLOUT_MS = 2000;

/**
 * The callout for the lap `race` has just closed (`race.lap` of `laps`):
 * the lap it opens — the final one, named as such — and the time of the one
 * just done, marked as a new record if it beats `recordMs` (the track's
 * best before this race, if it has one) and every lap before it, else as a
 * best lap if it's this race's fastest. None for the flag: the results say
 * it all.
 */
export function lapCallout(
  race: RaceState,
  laps: number,
  recordMs: number,
  nowMs: number,
): Callout | null {
  if (race.finished || race.lap === 0) return null;
  const t = race.lastLapMs;
  const before = Math.min(...race.lapTimesMs.slice(0, -1));
  // (A track's first race has no record to beat: its results crown one.)
  const record = isFinite(recordMs) && t < recordMs && t < before;
  // (The first lap is always the race's best so far: no news.)
  const best = !record && race.lap > 1 && t < before;
  const final = race.lap === laps - 1;
  const note = record ? "New record!" : best ? "Best lap" : "";
  return {
    title: final ? "FINAL LAP" : `LAP ${race.lap + 1}`,
    detail: `${formatLap(t)}${note ? ` · ${note}` : ""}`,
    tone: record ? "record" : best ? "best" : final ? "final" : "lap",
    atMs: nowMs,
  };
}

/** Going the wrong way round this long (ms) puts the warning up. */
export const WRONG_WAY_MS = 700;

/**
 * Notices a car heading the wrong way round the track: back along the lap,
 * at more than a crawl, for most of a second (a moment's reverse out of a
 * wall doesn't count). Heading the right way clears it twice as fast.
 */
export class WrongWay {
  private prevArc: number | null = null;
  private backMs = 0;

  /**
   * Feed the car each step: where it is along the lap (`arc`, px), the
   * lap's length, the step (ms) and its speed (px/s). True while the
   * warning should show.
   */
  update(arc: number, lapLength: number, dtMs: number, speed: number): boolean {
    if (this.prevArc !== null && lapLength > 0) {
      let d = arc - this.prevArc;
      d -= lapLength * Math.round(d / lapLength);
      if (d < 0 && Math.abs(speed) > 30) this.backMs += dtMs;
      else if (d > 0) this.backMs = Math.max(0, this.backMs - 2 * dtMs);
    }
    this.prevArc = arc;
    return this.backMs > WRONG_WAY_MS;
  }
}
