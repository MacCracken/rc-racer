import type { Vec2 } from "./vec.ts";

/**
 * Top-down camera that follows a target with optional exponential smoothing so
 * it doesn't jitter. `toScreen` maps world -> screen; the renderer is the only
 * consumer.
 */
export class Camera {
  view: Vec2;
  /** World px per screen px. */
  zoom: number;
  width: number;
  height: number;

  constructor(start: Vec2, width: number, height: number, zoom = 0.55) {
    this.view = { ...start };
    this.width = width;
    this.height = height;
    this.zoom = zoom;
  }

  setViewport(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  /** Lerp the view toward a desired target (rate in 1/s). */
  lerpTo(desired: Vec2, rate: number, dt: number): void {
    const k = 1 - Math.exp(-rate * dt);
    this.view.x += (desired.x - this.view.x) * k;
    this.view.y += (desired.y - this.view.y) * k;
  }

  toScreen(p: Vec2): Vec2 {
    return {
      x: (p.x - this.view.x) * this.zoom + this.width / 2,
      y: (p.y - this.view.y) * this.zoom + this.height / 2,
    };
  }
}
