import type Matter from "matter-js";
import type { Camera } from "./Camera.ts";
import type { BuiltTrack } from "../track/Track.ts";
import type { SkidMark } from "./SkidMarks.ts";
import type { RaceState } from "../race/RaceState.ts";

/**
 * The renderer seam. Phase 0: Canvas2D. Swap `Canvas2DRenderer` for a PixiJS /
 * WebGL renderer by implementing `IRenderer` — the loop, physics, and race
 * logic never see it.
 */
export interface RenderScene {
  camera: Camera;
  track: BuiltTrack;
  /** The live player car body (Matter.js); the renderer reads position + angle. */
  car: Matter.Body;
  race: RaceState;
  /** Forward speed (px/s, signed) for the HUD. */
  speed: number;
  /** ms clock, for the live lap timer. */
  nowMs: number;
  /** Optional AI rival bodies to draw around the player. */
  rivals?: Matter.Body[];
  /** Live position (1 = P1) + field size for the HUD when racing a field. */
  position?: number;
  total?: number;
  /** Decaying tire-skid trail drawn on the asphalt under the cars. */
  skidMarks?: SkidMark[];
  /** The player's previous best-lap ghost, to chase. */
  ghost?: import("../race/Ghost.ts").Ghost;
}

export interface IRenderer {
  resize(width: number, height: number, dpr?: number): void;
  render(scene: RenderScene): void;
}
