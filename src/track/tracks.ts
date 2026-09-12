import type { TrackDef } from "./Track.ts";
import type { Vec2 } from "../core/vec.ts";

const TAU = Math.PI * 2;

/**
 * Generate a closed loop of `n` points from a shape function. The *authored*
 * part of a track is this shape (amplitudes + frequency); the point array is
 * derived deterministically. buildTrack() turns it into walls + gates.
 *
 * Using a smooth radial function keeps the offsets from self-intersecting,
 * which is what the annulus wall builder assumes.
 */
function loop(fn: (t: number) => Vec2, n: number): Vec2[] {
  return Array.from({ length: n }, (_, i) => fn((i / n) * TAU));
}

// --- Overture: a wide, wavy grand-prix style circuit. ---
export const overture: TrackDef = {
  id: "overture",
  name: "Overture",
  laps: 3,
  width: 150,
  background: "#0c1d12",
  surface: "#39404a",
  centerLine: loop(
    (t) => ({
      x: Math.cos(t) * 540 + Math.cos(3 * t) * 130,
      y: Math.sin(t) * 380 + Math.sin(3 * t) * 100,
    }),
    96,
  ),
  gateCount: 8,
  parLapMs: 5400,
  aiPace: 0.82,
};

// --- Hairpin: a tight, fast little loop for tighter-cornering cars. ---
export const hairpin: TrackDef = {
  id: "hairpin",
  name: "Hairpin",
  laps: 3,
  width: 120,
  background: "#16100c",
  surface: "#4a4038",
  centerLine: loop(
    (t) => ({
      x: Math.cos(t) * 420 + Math.cos(2 * t) * 80,
      y: Math.sin(t) * 240,
    }),
    72,
  ),
  gateCount: 6,
  parLapMs: 3600,
  aiPace: 0.78,
};

// --- Dust Bowl: a rough, high-grip-needed oval. ---
export const dustBowl: TrackDef = {
  id: "dust-bowl",
  name: "Dust Bowl",
  laps: 5,
  width: 110,
  background: "#1a140a",
  surface: "#6b5636",
  centerLine: loop(
    (t) => ({
      x: Math.cos(t) * 460,
      y: Math.sin(t) * 300 + Math.sin(4 * t) * 60,
    }),
    64,
  ),
  gateCount: 8,
  parLapMs: 3000,
  aiPace: 0.8,
};

export const tracks: TrackDef[] = [overture, hairpin, dustBowl];
