/** Fixed timestep — a physics/logic frame is always this many seconds. */
export const FIXED_DT = 1 / 120;

/** Max real time consumed per render frame, to avoid the "spiral of death". */
export const MAX_FRAME_TIME = 0.25;

/** Max simulation steps applied per render frame (safety valve). */
export const MAX_STEPS_PER_FRAME = 8;

/**
 * Central tuning table. Phase 0 uses a simple kinematic car; Phase 1 will
 * translate these + CarStats into Matter.js forces. Keep *feel* knobs here.
 */
export const TUNING = {
  // Kinematic car (Phase 0 placeholder, replaced by Matter.js in Phase 1).
  car: {
    maxSpeed: 220, // px/s
    accel: 260, // px/s^2
    braking: 420, // px/s^2
    drag: 0.9, // %/s exponential speed loss when coasting
    turnRate: 3.2, // rad/s at speed
    turnSpeedFactor: 0.35, // how much turning depends on speed
    handbrakeGrip: 0.25, // fraction of grip retained under handbrake
    handbrakeYaw: 2.2, // extra yaw kick per second while handbraking
  },
} as const;
