/**
 * Replay playback: the last finished race, watched back. Holds where the
 * replay is — how far in, how fast, whether it's held — and puts the cars
 * where the recording has them, with a velocity read off the next moment of
 * motion so the camera's look-ahead and speed zoom work as in the race, and
 * skid marks lay themselves again. Pure sim: no DOM. The Game routes the
 * screens, draws the controls and moves the camera.
 */
import type { Vec2 } from "../core/vec.ts";
import type { CarControls } from "../core/types.ts";
import { ageMarks, sampleDrift, type SkidState } from "../core/SkidMarks.ts";
import { CAR_LENGTH, CAR_WIDTH } from "../core/tuning.ts";
import {
  REPLAY_INTERVAL_MS,
  replayLength,
  sampleReplay,
  type Replay,
} from "./Replay.ts";

/** A car the replay can pose: its body, and its top speed (for skids). */
export interface PosableCar {
  body: { position: Vec2; velocity: Vec2; angle: number };
  stats: { maxSpeed: number };
}

/** Where playback is, as the replay screen's controls show it. */
export interface ReplayState {
  held: boolean;
  atEnd: boolean;
  speed: number;
}

export class ReplayPlayer {
  /** The last finished race (empty until one finishes). */
  replay: Replay = [];
  /** How far in (ms of race time), how fast it plays, and if it's held. */
  ms = 0;
  speed = 1;
  held = false;
  /** Every car's wheels and brake lights as last posed, player first. */
  controls: CarControls[] = [];

  /** Keep a finished race to watch. */
  load(replay: Replay): void {
    this.replay = replay;
  }

  /** Is there a race to watch? */
  get ready(): boolean {
    return this.replay.length > 1;
  }

  /** How long the replay runs (ms of race time). */
  get length(): number {
    return replayLength(this.replay);
  }

  get atEnd(): boolean {
    return this.ms >= this.length;
  }

  /** From the green light, at 1×: pose `cars` there, with a fresh `skid`. */
  watch(cars: readonly PosableCar[], skid: SkidState): void {
    this.ms = 0;
    this.speed = 1;
    this.held = false;
    this.pose(cars, skid, 0);
  }

  /**
   * Play / pause — or from the flag, from the top again. True when it went
   * back to the top (the caller clears the skid trail).
   */
  toggle(): boolean {
    if (this.atEnd) {
      this.ms = 0;
      this.held = false;
      return true;
    }
    this.held = !this.held;
    return false;
  }

  /** 1× -> 2× -> 4× -> 1×. */
  cycleSpeed(): void {
    this.speed = this.speed >= 4 ? 1 : this.speed * 2;
  }

  /** Park `cars` at the flag, where the race finished. */
  toEnd(cars: readonly PosableCar[], skid: SkidState): void {
    this.ms = this.length;
    this.pose(cars, skid, 0);
  }

  /**
   * One fixed step of `dt` seconds: run the replay on at its speed (unless
   * held or at the flag) and pose `cars` there, laying skids for the race
   * time run. True on the step that reaches the flag, so the caller can
   * offer to watch again.
   */
  step(dt: number, cars: readonly PosableCar[], skid: SkidState): boolean {
    let ran = 0;
    let ended = false;
    if (!this.held && !this.atEnd) {
      ran = dt * this.speed;
      this.ms = Math.min(this.length, this.ms + ran * 1000);
      ended = this.atEnd;
    }
    this.pose(cars, skid, ran);
    return ended;
  }

  /** The replay screen's controls. */
  state(): ReplayState {
    return { held: this.held, atEnd: this.atEnd, speed: this.speed };
  }

  /** The HUD's REPLAY badge: how far in, of how long, at what speed. */
  badge(): { ms: number; totalMs: number; speed: number } {
    return { ms: this.ms, totalMs: this.length, speed: this.speed };
  }

  /**
   * Put every car where the replay has it now, with a velocity from the next
   * moment of motion; set their `controls`; and lay the player's skid marks,
   * as in the race, over `ran` seconds of race time.
   */
  private pose(cars: readonly PosableCar[], skid: SkidState, ran: number) {
    const now = sampleReplay(this.replay, this.ms);
    if (now === null) return;
    const soon = sampleReplay(this.replay, this.ms + REPLAY_INTERVAL_MS) ?? now;
    const perSecond = 1000 / REPLAY_INTERVAL_MS;
    cars.forEach((c, i) => {
      const p = now[i];
      const q = soon[i] ?? p;
      if (p === undefined) return;
      c.body.position.x = p.x;
      c.body.position.y = p.y;
      c.body.angle = p.angle;
      c.body.velocity.x = (q.x - p.x) * perSecond;
      c.body.velocity.y = (q.y - p.y) * perSecond;
    });
    this.controls = now.map((p) => ({ steer: p.steer, braking: p.braking }));
    const player = cars[0];
    if (ran > 0 && player !== undefined) {
      sampleDrift(skid, player.body, {
        carLength: CAR_LENGTH,
        carWidth: CAR_WIDTH,
        maxSpeed: player.stats.maxSpeed,
      });
      ageMarks(skid, ran);
    }
  }
}
