import { TUNING } from "./tuning.ts";
import type { Vec2 } from "./Camera.ts";
import type { InputState } from "./Input.ts";

/**
 * Per-run drivability. Phase 0 hardcodes a single balanced car. Phase 2 turns
 * this into the data-driven car/upgrade model (stat deltas per upgrade slot).
 */
export interface CarStats {
  maxSpeed: number;
  accel: number;
  braking: number;
  turnRate: number;
}

/** Physics knob table pulled from the central tuning source. */
export interface CarTuning {
  drag: number;
  handbrakeGrip: number;
}

/**
 * A kinematic top-down car (Phase 0). This is a *placeholder* for the
 * Matter.js rigid-body sim in Phase 1 — but it already models
 * throttle/brake/steer/handbrake/drag so the loop and renderer are real.
 *
 * Convention: heading 0 rad = facing "up" toward -Y. Forward vector =
 * (sin h, -cos h).
 */
export class Vehicle {
  pos: Vec2 = { x: 0, y: 0 };
  heading = 0; // radians
  speed = 0; // px/s along heading
  angularVel = 0; // rad/s

  // Two samples are kept so the renderer can interpolate at `alpha`.
  private prev: { pos: Vec2; heading: number } = {
    pos: { x: 0, y: 0 },
    heading: 0,
  };
  private curr = { pos: { x: 0, y: 0 }, heading: 0 };

  constructor(
    public readonly stats: CarStats,
    public readonly tuning: CarTuning,
    start: Vec2,
    heading = 0,
  ) {
    this.pos = { ...start };
    this.heading = heading;
    this.prev = { pos: { ...start }, heading };
    this.curr = { pos: { ...start }, heading };
  }

  /** Advance the car one fixed step. Pure wrt its own fields. */
  step(dt: number, input: InputState): void {
    this.prev = { pos: { ...this.pos }, heading: this.heading };

    const { accel, braking, maxSpeed, turnRate } = this.stats;
    const { drag, handbrakeGrip } = this.tuning;

    // Longitudinal motion: throttle, brake (stops without reversing), or drag.
    let speed = this.speed;
    if (input.throttle > 0) {
      speed += accel * input.throttle * dt;
    } else if (input.brake > 0) {
      speed -= braking * input.brake * dt;
      if (speed < 0) speed = 0; // brake to a stop, no reverse yet
    } else {
      speed *= 1 - drag * dt; // coast: exponential decay toward zero
    }

    // Handbrake robs longitudinal grip.
    if (input.handbrake && speed > 0) {
      speed *= 1 - handbrakeGrip * dt * 3;
    }

    speed = this.clampSpeed(speed, maxSpeed);
    this.speed = speed;

    // Steering authority scales with speed, so a parked car cannot spin.
    const speedFrac = Math.min(1, speed / Math.max(1, maxSpeed));
    this.angularVel = input.steer * turnRate * speedFrac;
    this.heading += this.angularVel * dt;

    // Integrate position along the heading. Forward = (sin, -cos).
    const fx = Math.sin(this.heading);
    const fy = -Math.cos(this.heading);
    this.pos = {
      x: this.pos.x + fx * speed * dt,
      y: this.pos.y + fy * speed * dt,
    };

    this.curr = { pos: { ...this.pos }, heading: this.heading };
  }

  private clampSpeed(s: number, max: number): number {
    return s > max ? max : s;
  }

  /** Render position/heading interpolated between the last two steps. */
  interpolated(alpha: number): { pos: Vec2; heading: number } {
    const a = this.prev;
    const b = this.curr;
    return {
      pos: {
        x: a.pos.x + (b.pos.x - a.pos.x) * alpha,
        y: a.pos.y + (b.pos.y - a.pos.y) * alpha,
      },
      heading: a.heading + (b.heading - a.heading) * alpha,
    };
  }

  /** Look-ahead offset for the camera, in world pixels. */
  cameraLookAhead(): Vec2 {
    const dist = 90;
    return {
      x: Math.sin(this.heading) * dist,
      y: -Math.cos(this.heading) * dist,
    };
  }
}

/** A single balanced car used in Phase 0. */
export const defaultCarStats: CarStats = {
  maxSpeed: TUNING.car.maxSpeed,
  accel: TUNING.car.accel,
  braking: TUNING.car.braking,
  turnRate: TUNING.car.turnRate,
};

export const defaultCarTuning: CarTuning = {
  drag: TUNING.car.drag,
  handbrakeGrip: TUNING.car.handbrakeGrip,
};
