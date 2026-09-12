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
  vibe: "The warm-up circuit",
  difficulty: 1,
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
  parLapMs: 18000,
  aiPace: 0.82,
};

// --- Hairpin: a tight, fast little loop for tighter-cornering cars. ---
export const hairpin: TrackDef = {
  id: "hairpin",
  vibe: "Tight & quick",
  difficulty: 2,
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
  parLapMs: 12000,
  aiPace: 0.78,
};

// --- Dust Bowl: a rough, high-grip-needed oval. ---
export const dustBowl: TrackDef = {
  id: "dust-bowl",
  vibe: "A brutal grind",
  difficulty: 3,
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
  parLapMs: 14000,
  aiPace: 0.8,
};

// --- Riverbend: a big, flowing wavy oval. Wide, forgiving. ---
export const riverbend: TrackDef = {
  id: "riverbend",
  name: "Riverbend",
  laps: 3,
  width: 140,
  background: "#0a141f",
  surface: "#3a4652",
  vibe: "Fast & flowing",
  difficulty: 2,
  centerLine: loop(
    (t) => ({
      x: Math.cos(t) * 560 + Math.cos(2 * t) * 140,
      y: Math.sin(t) * 340 + Math.sin(3 * t) * 90,
    }),
    96,
  ),
  gateCount: 10,
  parLapMs: 17000,
  aiPace: 0.85,
};

// --- Clover: a three-lobe circuit. Mixed fast and tight. ---
export const clover: TrackDef = {
  id: "clover",
  name: "Clover",
  laps: 3,
  width: 130,
  background: "#15121a",
  surface: "#463a4a",
  vibe: "Three flowing lobes",
  difficulty: 3,
  centerLine: loop(
    (t) => ({
      x: Math.cos(t) * 480 + Math.cos(3 * t) * 120,
      y: Math.sin(t) * 420 + Math.sin(3 * t) * 120,
    }),
    96,
  ),
  gateCount: 9,
  parLapMs: 17000,
  aiPace: 0.8,
};

// --- Slalom: a tight, high-frequency weave that punishes understeer. ---
export const slalom: TrackDef = {
  id: "slalom",
  name: "Slalom",
  laps: 4,
  width: 120,
  background: "#1a0f0a",
  surface: "#5a3f36",
  vibe: "A tight, fast weave",
  difficulty: 4,
  centerLine: loop(
    (t) => ({
      x: Math.cos(t) * 400 + Math.sin(3 * t) * 70,
      y: Math.sin(t) * 360 + Math.cos(3 * t) * 60,
    }),
    128,
  ),
  gateCount: 10,
  parLapMs: 14000,
  aiPace: 0.78,
};

export const tracks: TrackDef[] = [
  overture,
  hairpin,
  riverbend,
  clover,
  dustBowl,
  slalom,
];
