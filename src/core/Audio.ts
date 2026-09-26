/**
 * Audio seam — kept out of the simulation like the renderer. The game fires
 * discrete `SoundEvent`s; a real impl turns them into sound, a null impl records
 * them (for tests) or does nothing. This makes "a chime plays on a lap/finish"
 * assertable without a real audio device, while the audible WebAudio output stays
 * the one part that genuinely needs a browser.
 */

export type SoundEvent =
  | "lap"
  | "finish"
  | "click"
  | "boost"
  | "drift"
  /** A start-countdown beep (3, 2, 1)… */
  | "count"
  /** …and the higher one as the lights go green. */
  | "go";

/** The engine voice's live state, as `engineFor` derives it from the car. */
export interface EngineSound {
  /** 0..1: how fast the motor spins (sets the pitch). */
  rpm: number;
  /** 0..1: throttle — a loaded motor sounds louder and brighter. */
  load: number;
  /** Per-car pitch multiplier: a light buggy whines higher than a brawler. */
  pitch: number;
}

/** Engine pitch (Hz) at idle and at full revs, before the car's multiplier. */
export const ENGINE_IDLE_HZ = 62;
export const ENGINE_MAX_HZ = 380;

/**
 * Engine state for a car at `speedFrac` of its top speed with `throttle`
 * held. An RC motor's revs track the wheels, but under throttle it spins up
 * ahead of a slow car (wheelspin) — so you can rev it on the grid.
 */
export function engineFor(
  speedFrac: number,
  throttle: number,
  pitch = 1,
): EngineSound {
  const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
  const load = clamp01(throttle);
  return { rpm: Math.max(clamp01(speedFrac), 0.5 * load), load, pitch };
}

/** The engine's fundamental (Hz) for a state. */
export function engineHz(e: EngineSound): number {
  return e.pitch * (ENGINE_IDLE_HZ + (ENGINE_MAX_HZ - ENGINE_IDLE_HZ) * e.rpm);
}

export interface IAudio {
  /** Fire a sound event (optionally scaled 0..1). */
  play(ev: SoundEvent, gain?: number): void;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
  /**
   * The continuous voices, updated once per frame: the engine (null = off,
   * e.g. on the menus, paused or after the finish) and tyre squeal (0..1).
   * Optional, so a bare test double needn't implement them.
   */
  setEngine?(engine: EngineSound | null): void;
  setSkid?(amount: number): void;
}

/** The looping voices' audio graph, built on first use. */
interface Loops {
  /** Everything continuous runs through here, so mute is one gain. */
  master: GainNode;
  engine: GainNode;
  engineOsc: OscillatorNode[];
  engineTone: BiquadFilterNode;
  skid: GainNode;
  skidTone: BiquadFilterNode;
}

/**
 * Default impl. In a browser it lazily creates a WebAudio context and plays a
 * short oscillator per event; headless (no AudioContext) it degrades to a no-op
 * so the simulation is never affected.
 */
export class WebAudio implements IAudio {
  private ctx: AudioContext | null = null;
  private loops: Loops | null = null;
  private engineOn = false;
  private skidOn = false;
  muted = false;

  private ensure(): AudioContext | null {
    if (this.ctx !== null) {
      // A context made (or re-suspended, e.g. by Safari) outside a user
      // gesture stays silent until resumed.
      if (this.ctx.state === "suspended")
        void this.ctx.resume().catch(() => {});
      return this.ctx;
    }
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
    count: 523, // C5 ...
    go: 1047, // ... and C6, an octave up, like real start lights
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
    const unmuting = this.muted && !muted;
    this.muted = muted;
    const L = this.loops;
    if (L !== null && this.ctx !== null)
      L.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.02);
    // Unmuting is the player's click: the moment to create (or wake) the
    // context, since browsers only start audio inside a user gesture. A game
    // that booted muted has none yet, and the engine loop would otherwise
    // create it later from a frame callback, where Safari keeps it silent.
    if (unmuting) this.ensure();
  }

  setEngine(e: EngineSound | null): void {
    if (e === null) {
      if (this.engineOn) this.fade(this.loops?.engine, 0);
      this.engineOn = false;
      return;
    }
    const L = this.ensureLoops();
    if (L === null || this.ctx === null) return;
    const t = this.ctx.currentTime;
    const hz = engineHz(e);
    L.engineOsc[0].frequency.setTargetAtTime(hz, t, 0.03);
    L.engineOsc[1].frequency.setTargetAtTime(hz * 2, t, 0.03);
    // Throttle opens the filter: a loaded motor snarls, a coasting one hums.
    L.engineTone.frequency.setTargetAtTime(
      350 + 2600 * (0.2 + 0.8 * e.load) * (0.35 + 0.65 * e.rpm),
      t,
      0.05,
    );
    L.engine.gain.setTargetAtTime(
      0.035 + 0.05 * e.load + 0.03 * e.rpm,
      t,
      0.05,
    );
    this.engineOn = true;
  }

  setSkid(amount: number): void {
    const a = Math.max(0, Math.min(1, amount));
    if (a === 0) {
      if (this.skidOn) this.fade(this.loops?.skid, 0);
      this.skidOn = false;
      return;
    }
    const L = this.ensureLoops();
    if (L === null || this.ctx === null) return;
    const t = this.ctx.currentTime;
    L.skid.gain.setTargetAtTime(0.09 * a, t, 0.03);
    L.skidTone.frequency.setTargetAtTime(1200 + 500 * a, t, 0.05);
    this.skidOn = true;
  }

  private fade(g: GainNode | undefined, to: number): void {
    if (g === undefined || this.ctx === null) return;
    g.gain.setTargetAtTime(to, this.ctx.currentTime, 0.06);
  }

  /** Build the looping voices once; null headless or while muted-and-idle. */
  private ensureLoops(): Loops | null {
    if (this.loops !== null) return this.loops;
    // No context just to be silent: a muted game never needs one.
    if (this.muted && this.ctx === null) return null;
    const ctx = this.ensure();
    if (ctx === null) return null;
    try {
      this.loops = buildLoops(ctx, this.muted);
    } catch {
      return null; // an exotic/limited implementation: stay silent
    }
    return this.loops;
  }
}

/**
 * The continuous voices. Engine: an RC motor's whine — a sawtooth plus a
 * slightly detuned square an octave up, through a low-pass the throttle
 * opens. Squeal: looped white noise through a resonant band-pass.
 */
function buildLoops(ctx: AudioContext, muted: boolean): Loops {
  const master = ctx.createGain();
  master.gain.value = muted ? 0 : 1;
  master.connect(ctx.destination);

  const engine = ctx.createGain();
  engine.gain.value = 0;
  const engineTone = ctx.createBiquadFilter();
  engineTone.type = "lowpass";
  engineTone.Q.value = 3;
  engineTone.connect(engine).connect(master);
  const saw = ctx.createOscillator();
  saw.type = "sawtooth";
  saw.connect(engineTone);
  const square = ctx.createOscillator();
  square.type = "square";
  square.detune.value = 8; // cents: a little beating, less synthetic
  const squareLevel = ctx.createGain();
  squareLevel.gain.value = 0.3;
  square.connect(squareLevel).connect(engineTone);
  saw.frequency.value = ENGINE_IDLE_HZ;
  square.frequency.value = ENGINE_IDLE_HZ * 2;
  saw.start();
  square.start();

  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  const hiss = ctx.createBufferSource();
  hiss.buffer = noise;
  hiss.loop = true;
  const skidTone = ctx.createBiquadFilter();
  skidTone.type = "bandpass";
  skidTone.frequency.value = 1300;
  skidTone.Q.value = 7;
  const skid = ctx.createGain();
  skid.gain.value = 0;
  hiss.connect(skidTone).connect(skid).connect(master);
  hiss.start();

  return {
    master,
    engine,
    engineOsc: [saw, square],
    engineTone,
    skid,
    skidTone,
  };
}

/** Records every event (no sound) — handy for tests and the headless default. */
export class NullAudio implements IAudio {
  readonly log: { ev: SoundEvent; gain: number }[] = [];
  /** The last engine state / squeal set (what a real impl would be playing). */
  engine: EngineSound | null = null;
  skid = 0;
  muted = false;
  play(ev: SoundEvent, gain = 0.25): void {
    if (this.muted) return;
    this.log.push({ ev, gain });
  }
  setMuted(muted: boolean): void {
    this.muted = muted;
  }
  setEngine(engine: EngineSound | null): void {
    this.engine = engine;
  }
  setSkid(amount: number): void {
    this.skid = amount;
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
