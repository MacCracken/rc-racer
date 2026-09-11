/**
 * Top-down camera that follows the car with a small look-ahead based on
 * velocity so the car sits slightly off-center in the direction it's going.
 *
 * Pure math; no rendering. The renderer consumes `toWorld/toScreen` to map
 * coordinates.
 */
export interface Vec2 {
  x: number;
  y: number;
}

export class Camera {
  view: Vec2;
  /** Pixels of world per screen pixel (zoom). 1 = 1:1. */
  zoom: number;
  /** Seconds of velocity to look ahead. */
  lookAhead: number;

  width: number;
  height: number;

  constructor(
    start: Vec2,
    width: number,
    height: number,
    zoom = 1,
    lookAhead = 0.12,
  ) {
    this.view = { ...start };
    this.width = width;
    this.height = height;
    this.zoom = zoom;
    this.lookAhead = lookAhead;
  }

  setViewport(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  /** Center on a target point with a look-ahead offset. */
  follow(target: Vec2, lookAheadOffset: Vec2): void {
    this.view = {
      x: target.x + lookAheadOffset.x,
      y: target.y + lookAheadOffset.y,
    };
  }

  /** Screen pixel for a world point. */
  toScreen(p: Vec2): Vec2 {
    return {
      x: (p.x - this.view.x) * this.zoom + this.width / 2,
      y: (p.y - this.view.y) * this.zoom + this.height / 2,
    };
  }
}
