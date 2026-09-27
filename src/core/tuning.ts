// Fixed timestep — a physics/logic frame is always this many seconds.
export const FIXED_DT = 1 / 120;

// Max real time consumed per render frame, to avoid the "spiral of death".
export const MAX_FRAME_TIME = 0.25;

// Max simulation steps applied per render frame (safety valve).
export const MAX_STEPS_PER_FRAME = 8;

// Camera & follow tuning
export const CAMERA_LERP_RATE = 14; // 1/s exponential smoothing
export const CAMERA_LOOKAHEAD = 0.35; // fraction of velocity to look ahead
// Speed zoom (screen px per world px): close in when slow, pull out at top
// speed to show more of the road ahead. Eased so it breathes, not jitters.
export const CAMERA_ZOOM_SLOW = 0.8;
export const CAMERA_ZOOM_FAST = 0.55;
export const CAMERA_ZOOM_RATE = 2; // 1/s exponential smoothing
/** Wide shot for the menus' live backdrop. */
export const CAMERA_ZOOM_MENU = 0.55;

// Race start: a 3-2-1 countdown holds the whole field on the grid, then GO.
export const START_COUNTDOWN_MS = 3000;
/** How long the "GO!" flash stays up once the lights go green. */
export const GO_FLASH_MS = 800;

// Gate tunnel prevention
export const GATE_SUBSTEPS = 4; // sub-steps per fixed dt for gate checks
export const GATE_TOLERANCE = 6; // px tolerance for gate crossing

// Wall contact. The speed driving *into* a wall is cancelled, bouncing back
// WALL_BOUNCE of it; the speed sliding *along* the wall loses WALL_FRICTION x
// the into-wall speed. So a graze costs a little and a head-on hit a lot.
export const WALL_BOUNCE = 0.3;
export const WALL_FRICTION = 0.5;

/**
 * Drivability of a single car. Phase 1 hardcodes `defaultCarStats`. Phase 2
 * turns these into a data-driven upgrade model (the upgrade tree mutates a
 * copy of a car's stats). Keep *feel* tunable: every knob here maps directly
 * to a line in `physics/MatterCar.ts`.
 */
export interface CarStats {
  // Longitudinal
  maxSpeed: number; // px/s forward cap
  accel: number; // px/s^2 under full throttle
  braking: number; // px/s^2 under full brake
  reverseAccel: number; // px/s^2 when reversing
  drag: number; // per-second exponential velocity loss when coasting
  // Steering / lateral
  turnRate: number; // rad/s of yaw authority at full speed
  grip: number; // lateral velocity damped by this fraction per step (0..1)
  handbrakeGrip: number; // grip fraction while handbraking (lower = more slide)
}

export const defaultCarStats: CarStats = {
  maxSpeed: 180,
  accel: 130,
  braking: 240,
  reverseAccel: 70,
  drag: 0.35,
  turnRate: 3.4,
  grip: 0.16,
  handbrakeGrip: 0.02,
};

// Body geometry (world px). Car length runs along local +x.
export const CAR_LENGTH = 30;
export const CAR_WIDTH = 16;

/** Display km/h per px/s of speed (HUD speedometer + garage top speed). */
export const KMH_PER_PX_S = 0.6;
