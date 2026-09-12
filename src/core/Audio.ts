/**
 * Audio seam — kept out of the simulation like the renderer. The game fires
 * discrete `SoundEvent`s; a real impl turns them into sound, a null impl records
 * them (for tests) or does nothing. This makes "a chime plays on a lap/finish"
 * assertable without a real audio device, while the audible WebAudio output stays
 * the one part that genuinely needs a browser.
 */

export type SoundEvent = "lap" | "finish" | "click" | "boost" | "drift";

export interface IAudio {
  /** Fire a sound event (optionally scaled 0..1). */
  play(ev: SoundEvent, gain?: number): void;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
  /** Optional engine hum control for RPM-pitch simulation. */
  setEngineSpeed?(norm: number): void;
}

/**
 * Default impl. In a browser it lazily creates a WebAudio context and plays a
 * short oscillator per event; headless (no AudioContext) it degrades to a no-op
 * so the simulation is never affected.
 */
export class WebAudio implements IAudio {
  private ctx: AudioContext | null = null;
  muted = false;

  private ensure(): AudioContext | null {
    if (this.ctx !== null) return this.ctx;
    if (typeof window === "undefined") return null;
    const AC =
      (
        window as {
          AudioContext?: new () => AudioContext;
          webkitAudioContext?: new () => AudioContext;
        }
      ).AudioContext ??
      (
        window as {
          webkitAudioContext?: new () => AudioContext;
        }
      ).webkitAudioContext;
    if (typeof AC === "undefined") return null;
    try {
      this.ctx = new AC();
    } catch {
      return null;
    }
    return this.ctx;
  }

  /** Per-event pitch (Hz) — a lap chime is brighter than a click. */
  private static PITCH: Record<SoundEvent, number> = {
    lap: 660,
    finish: 880,
    click: 320,
    boost: 1100,
    drift: 180,
  };

  play(ev: SoundEvent, gain = 0.25): void {
    if (this.muted) return;
    const ctx = this.ensure();
    if (ctx === null) return; // headless: nothing to play, but no error either
    try {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const t = ctx.currentTime;
      osc.frequency.value = WebAudio.PITCH[ev];
      g.gain.setValueAtTime(Math.max(0, Math.min(1, gain)), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.15);
    } catch {
      // Browsers gate AudioContext behind a user gesture; a failed play is
      // a no-op, never a throw.
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }
}

/** Records every event (no sound) — handy for tests and the headless default. */
export class NullAudio implements IAudio {
  readonly log: { ev: SoundEvent; gain: number }[] = [];
  muted = false;
  play(ev: SoundEvent, gain = 0.25): void {
    if (this.muted) return;
    this.log.push({ ev, gain });
  }
  setMuted(muted: boolean): void {
    this.muted = muted;
  }
}

/**
 * Environment picker: real audio in a browser, a no-op recorder elsewhere so the
 * simulation and tests never depend on an audio device.
 */
export function createAudio(muted = false): IAudio {
  const inBrowser =
    typeof window !== "undefined" &&
    ((window as { AudioContext?: unknown }).AudioContext !== undefined ||
      (window as { webkitAudioContext?: unknown }).webkitAudioContext !==
        undefined);
  const audio: IAudio = inBrowser ? new WebAudio() : new NullAudio();
  audio.setMuted(muted);
  return audio;
}
