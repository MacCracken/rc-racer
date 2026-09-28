import { type Vec2, add, perp, normalize, sub } from "../core/vec.ts";

/** What the cars drive on (see `track/conditions.ts` for what each does). */
export type Terrain = "tarmac" | "dirt";
/** The weather over the track. */
export type Weather = "clear" | "rain";
/** Day, or night by headlights and trackside lamps. */
export type Lighting = "day" | "night";

/**
 * A track, authored as a closed centerline loop + a width. Everything else
 * (walls, gates, start/finish, bounds) is *derived* from that, so a track is
 * content, not code. This is the "add level 10 without writing logic" payoff.
 */
export interface TrackDef {
  id: string;
  name: string;
  laps: number;
  /** Full drivable width in world px. */
  width: number;
  /** Closed loop of points; the car races in the annulus around it. */
  centerLine: Vec2[];
  /** Number of sequential gates (checkpoints); evenly distributed. */
  gateCount?: number;
  /** Hex background color. */
  background?: string;
  /** Hex asphalt color. */
  surface?: string;
  /** A "decent" single-lap time in ms for the economy reward curve. */
  parLapMs?: number;
  /** 0..1 autopilot target pace when there are no AI rivals / for one. */
  aiPace?: number;
  /** Short flavour + difficulty line shown near the track name in the menu. */
  vibe?: string;
  /** Rough difficulty 1..5 for menu display (does not affect the sim). */
  difficulty?: number;
  /**
   * Who you race here: the rivals' car class id, the upgrade tier (0-4) they
   * run in every slot, and an optional stat `factor` (e.g. < 1 to detune the
   * warm-up). Rival strength belongs to the track, not to the player's car.
   * Defaults to stock street sedans.
   */
  rivals?: { car: string; tier: number; factor?: number };
  /** Conditions: tarmac, clear and day unless a track says otherwise. */
  terrain?: Terrain;
  weather?: Weather;
  lighting?: Lighting;
}

export interface Gate {
  index: number;
  center: Vec2;
  tangent: Vec2; // normalized direction of travel
  normal: Vec2; // normalized, perpendicular to travel
  // The gate spans `a`..`b` across the full track width.
  a: Vec2;
  b: Vec2;
}

export interface TrackBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface BuiltTrack {
  def: TrackDef;
  laps: number;
  centerLine: Vec2[];
  /** Offset outline, +width/2 along the normal. */
  outer: Vec2[];
  inner: Vec2[];
  gates: Gate[];
  start: { pos: Vec2; heading: number };
  bounds: TrackBounds;
  width: number;
}

/**
 * Derive the drivable annulus, walls, and gates from an authored centerline.
 *
 * We offset each centerline point by +/-width/2 along that point's local
 * inward/outward normal (the left of the tangent). Works for any smooth loop;
 * for tightly kinked loops the offset can self-intersect — fine for now, a
 * concern only if we hand-author hairpins later.
 */
export function buildTrack(def: TrackDef): BuiltTrack {
  const cl = def.centerLine;
  const n = cl.length;
  const half = def.width / 2;

  const tangents: Vec2[] = [];
  const normals: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = cl[(i - 1 + n) % n];
    const next = cl[(i + 1) % n];
    const t = normalize(sub(next, prev));
    tangents.push(t);
    normals.push(perp(t));
  }

  const outer = cl.map((p, i) => add(p, scaleNormal(normals[i], half)));
  const inner = cl.map((p, i) => add(p, scaleNormal(normals[i], -half)));

  // Gates: evenly spaced around the loop, gate 0 = start/finish. A gate in a
  // bend tighter than half the road would sit where its inside edge folds
  // over itself, and a car hugging that apex could slip round the gate's end
  // and have to drive a whole extra lap to it: each is nudged a few points to
  // where the road is open.
  const gateCount = def.gateCount ?? Math.max(4, Math.round(n / 6));
  const gates: Gate[] = [];
  for (let k = 0; k < gateCount; k++) {
    const even = Math.floor((k / gateCount) * n) % n;
    const i = k === 0 ? even : openSpot(cl, even, half * GATE_OPEN_BEND);
    const center = cl[i];
    const normal = normals[i];
    const tangent = tangents[i];
    gates.push({
      index: k,
      center,
      tangent,
      normal,
      a: add(center, scaleNormal(normal, half)),
      b: add(center, scaleNormal(normal, -half)),
    });
  }

  const start = gates[0];
  const heading = Math.atan2(start.tangent.y, start.tangent.x);
  const startPos = start.center;

  const all = [...outer, ...inner];
  const bounds = all.reduce<TrackBounds>(
    (acc, p) => {
      acc.minX = Math.min(acc.minX, p.x);
      acc.minY = Math.min(acc.minY, p.y);
      acc.maxX = Math.max(acc.maxX, p.x);
      acc.maxY = Math.max(acc.maxY, p.y);
      return acc;
    },
    {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
    },
  );

  return {
    def,
    laps: def.laps,
    centerLine: cl,
    outer,
    inner,
    gates,
    start: { pos: startPos, heading },
    bounds: {
      ...bounds,
      // pad a little so the camera doesn't clip the very edge
      minX: bounds.minX - half,
      minY: bounds.minY - half,
      maxX: bounds.maxX + half,
      maxY: bounds.maxY + half,
    },
    width: def.width,
  };
}

// Local helper kept out of the hot map callback for readability.
function scaleNormal(normal: Vec2, s: number): Vec2 {
  return { x: normal.x * s, y: normal.y * s };
}

/** A gate goes where the bend's radius is at least this many half-widths. */
const GATE_OPEN_BEND = 1.3;
/** How far (in points) a gate may move from its evenly spaced spot. */
const GATE_NUDGE = 4;

/** Radius (px) of the bend at centerline point `i`, across ±2 points. */
function bendAt(cl: Vec2[], i: number): number {
  const n = cl.length;
  const a = cl[(i - 2 + n) % n];
  const b = cl[i];
  const c = cl[(i + 2) % n];
  const cross = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  if (cross < 1e-9) return Infinity;
  const ab = Math.hypot(b.x - a.x, b.y - a.y);
  const bc = Math.hypot(c.x - b.x, c.y - b.y);
  const ca = Math.hypot(a.x - c.x, a.y - c.y);
  return (ab * bc * ca) / (2 * cross);
}

/**
 * The nearest centerline point to `i` (within `GATE_NUDGE`) whose bend is
 * at least `radius` wide; `i` itself if none is.
 */
function openSpot(cl: Vec2[], i: number, radius: number): number {
  const n = cl.length;
  for (let d = 0; d <= GATE_NUDGE; d++)
    for (const j of d === 0 ? [i] : [i + d, i - d]) {
      const k = (j + n) % n;
      if (bendAt(cl, k) >= radius) return k;
    }
  return i;
}

/** Spacing between starting-grid rows (a car length plus a gap). */
const GRID_ROW = 42;

/**
 * Pose of starting-grid slot `slot`: slot 0 (pole) sits on the start line; the
 * rest fill a staggered two-wide grid behind it, walked back *along the
 * centerline* so every car starts on the asphalt even when the line is on a
 * bend. (Lateral offsets alone put the outer cars past the track edge.)
 */
export function gridSlot(
  track: BuiltTrack,
  slot: number,
): { x: number; y: number; heading: number } {
  const { pos, heading } = track.start;
  if (slot <= 0) return { x: pos.x, y: pos.y, heading };
  const cl = track.centerLine;
  const n = cl.length;
  const side = (slot % 2 === 1 ? 1 : -1) * track.width * 0.22;
  let back = Math.ceil(slot / 2) * GRID_ROW;
  // Walk backwards from the start (centerline point 0), segment by segment.
  for (let k = 0; k < n; k++) {
    const b = cl[(n - k) % n];
    const a = cl[(n - k - 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (back > len && k < n - 1) {
      back -= len;
      continue;
    }
    const f = len === 0 ? 0 : Math.min(1, back / len);
    const h = Math.atan2(b.y - a.y, b.x - a.x);
    return {
      x: b.x + (a.x - b.x) * f - Math.sin(h) * side,
      y: b.y + (a.y - b.y) * f + Math.cos(h) * side,
      heading: h,
    };
  }
  return { x: pos.x, y: pos.y, heading };
}
