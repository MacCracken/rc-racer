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

/**
 * `loop`, but with the `n` points spaced evenly by distance along the track.
 * Shapes with long straights and tight corners (a squircle) bunch points up
 * in the corners when sampled evenly in `t`; gates, scenery and the AI's
 * look-ahead all count in points, so they want even spacing.
 */
function evenLoop(fn: (t: number) => Vec2, n: number): Vec2[] {
  const fine = loop(fn, n * 40);
  const at = [0]; // distance along `fine` to each point
  for (let i = 1; i <= fine.length; i++) {
    const a = fine[i - 1];
    const b = fine[i % fine.length];
    at.push(at[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = at[fine.length];
  const out: Vec2[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = (k / n) * total;
    while (at[j + 1] < s) j++;
    const a = fine[j];
    const b = fine[(j + 1) % fine.length];
    const f = (s - at[j]) / (at[j + 1] - at[j] || 1);
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }
  return out;
}

/** A soft bump, 1 at `t0`, fading over ~`width` radians either side. */
const bump = (t: number, t0: number, width: number): number =>
  Math.exp(-(((t - t0) / width) ** 2));

/** A squircle coordinate: |cos|^p keeps sides straight and corners square. */
const squircle = (v: number, p: number): number =>
  Math.sign(v) * Math.abs(v) ** p;

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
  parLapMs: 17500,
  aiPace: 0.8,
  // Warm-up: stock sedans, detuned a touch.
  rivals: { car: "street-sedan", tier: 0, factor: 0.9 },
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
  aiPace: 0.8,
  rivals: { car: "street-sedan", tier: 0, factor: 0.94 },
};

// --- Dust Bowl: a rough, narrow dirt oval. ---
export const dustBowl: TrackDef = {
  id: "dust-bowl",
  vibe: "A brutal grind in the dirt",
  difficulty: 3,
  name: "Dust Bowl",
  laps: 5,
  width: 110,
  background: "#1a140a",
  surface: "#6b5636",
  terrain: "dirt",
  centerLine: loop(
    (t) => ({
      x: Math.cos(t) * 460,
      y: Math.sin(t) * 300 + Math.sin(4 * t) * 60,
    }),
    64,
  ),
  gateCount: 8,
  parLapMs: 15500,
  aiPace: 0.8,
  rivals: { car: "brawler", tier: 1, factor: 0.85 },
};

// --- Gravel Pit: a loose dirt triangle. Long slides into one tight apex. ---
export const gravelPit: TrackDef = {
  id: "gravel-pit",
  name: "Gravel Pit",
  laps: 3,
  width: 130,
  background: "#1d170c",
  surface: "#8a7050",
  terrain: "dirt",
  vibe: "Loose gravel, long slides",
  difficulty: 2,
  // Started half a turn round, so the grid sits on the long left straight.
  centerLine: evenLoop((u) => {
    const t = u + Math.PI;
    return {
      x: Math.cos(t) * 480 + Math.cos(2 * t) * 85 + Math.sin(4 * t) * 22,
      y: Math.sin(t) * 370 - Math.sin(2 * t) * 85 + Math.cos(4 * t) * 10,
    };
  }, 104),
  gateCount: 8,
  parLapMs: 17000,
  aiPace: 0.8,
  // Off-road buggies with a first upgrade, detuned: a stock sedan can scrape
  // a podium; winning wants a buggy or a few parts.
  rivals: { car: "buggy", tier: 1, factor: 0.84 },
};

// --- Monsoon: a square street circuit, soaked. Brake early for every corner. ---
export const monsoon: TrackDef = {
  id: "monsoon",
  name: "Monsoon",
  laps: 3,
  width: 130,
  background: "#0a1511",
  surface: "#2c343b",
  weather: "rain",
  vibe: "Standing water — brake early",
  difficulty: 3,
  centerLine: evenLoop((t) => {
    // A dip into the top straight, and an S across the bottom one.
    const s = (t - 0.5 * Math.PI) / 0.14;
    return {
      x: 560 * squircle(Math.cos(t), 0.42),
      y:
        340 * squircle(Math.sin(t), 0.42) +
        170 * bump(t, 1.5 * Math.PI, 0.2) +
        60 * s * Math.exp(-s * s),
    };
  }, 120),
  gateCount: 10,
  parLapMs: 20000,
  aiPace: 0.8,
  rivals: { car: "street-sedan", tier: 3, factor: 0.9 },
};

// --- Midnight: the finale, a flowing circuit with a hairpin, after dark. ---
export const midnight: TrackDef = {
  id: "midnight",
  name: "Midnight",
  laps: 4,
  width: 125,
  background: "#0c1d12",
  surface: "#39404a",
  lighting: "night",
  vibe: "Racing by headlight",
  difficulty: 5,
  // The hairpin on the left is kept round enough (a gentle 3rd harmonic) that
  // no line through it can cut the apex and miss its gate.
  centerLine: evenLoop(
    (t) => ({
      x: Math.cos(t) * 520 + Math.cos(3 * t) * 25 - Math.sin(2 * t) * 60,
      y: Math.sin(t) * 400 + Math.sin(2 * t) * 90 + Math.cos(5 * t) * 20,
    }),
    128,
  ),
  gateCount: 10,
  parLapMs: 16500,
  aiPace: 0.8,
  rivals: { car: "brawler", tier: 2, factor: 1.01 },
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
  parLapMs: 18000,
  aiPace: 0.8,
  rivals: { car: "street-sedan", tier: 1, factor: 1.01 },
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
  parLapMs: 17500,
  aiPace: 0.8,
  // Fast lobes suit buggies: the first wall in the ladder, where a podium
  // wants a buggy (or a well-built sedan).
  rivals: { car: "buggy", tier: 1, factor: 0.86 },
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
  parLapMs: 15500,
  aiPace: 0.8,
  rivals: { car: "buggy", tier: 2, factor: 0.91 },
};

/**
 * The ladder, in unlock order: a podium on one opens the next. Rival
 * strength climbs along it, a breather now and then (see `Rivals.test.ts`):
 * a stock sedan wins the warm-up, the finale takes a built car to win, and
 * the conditions tracks are spread through it. Tuned with the autopilot
 * racing each field (`npm run verify:tracks`).
 */
export const tracks: TrackDef[] = [
  overture,
  hairpin,
  riverbend,
  gravelPit,
  clover,
  dustBowl,
  monsoon,
  slalom,
  midnight,
];
