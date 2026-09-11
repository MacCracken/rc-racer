/**
 * Core framework interfaces. These are the *seams* we never want to rewrite:
 *   - IRenderer  -> swap Canvas2D for PixiJS/WebGL without touching the sim
 *   - IInput     -> swap keyboard for touch/gamepad without touching the loop
 *   - The simulation (Vehicle, tracks) is pure and independent of both.
 */
import type { Camera } from "./Camera.ts";
import type { Vehicle } from "./Vehicle.ts";

/** A static-ish description of something renderable on the track. */
export interface RenderScene {
  camera: Camera;
  car: Vehicle;
  /** Free-form extras for later phases (skid marks, AI cars, HUD props). */
  extras?: readonly Renderable[];
}

export interface Renderable {
  kind: string;
  [key: string]: unknown;
}

export interface IRenderer {
  /** Adjust the backing store to a new CSS size (call on resize). */
  resize(width: number, height: number, dpr?: number): void;
  /** Draw one frame. `alpha` is the interpolation factor in [0,1). */
  render(scene: RenderScene, alpha: number): void;
}
