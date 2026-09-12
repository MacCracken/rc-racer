import type Matter from "matter-js";
import type { Camera } from "./Camera.ts";
import type { BuiltTrack } from "../track/Track.ts";
import type { RaceState } from "../race/RaceState.ts";

/**
 * The renderer seam. Phase 0: Canvas2D. Swap `Canvas2DRenderer` for a PixiJS /
 * WebGL renderer by implementing `IRenderer` — the loop, physics, and race
 * logic never see it.
 */
export interface RenderScene {
  camera: Camera;
  track: BuiltTrack;
  /** The live car body (Matter.js); the renderer reads position + angle. */
  car: Matter.Body;
  race: RaceState;
  /** Forward speed (px/s, signed) for the HUD. */
  speed: number;
  /** ms clock, for the live lap timer. */
  nowMs: number;
}

export interface IRenderer {
  resize(width: number, height: number, dpr?: number): void;
  render(scene: RenderScene): void;
}
