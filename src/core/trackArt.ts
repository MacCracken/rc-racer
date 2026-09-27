/**
 * Static track art: the road, curbs, start grid and trackside scenery. It is
 * painted once per track into an offscreen canvas (see Canvas2DRenderer), so
 * it can be as detailed as we like at no per-frame cost. Scenery *placement*
 * is pure and deterministic per track (and unit-tested to stay off the road);
 * only the `paint*` functions touch a canvas.
 */
import type { Vec2 } from "./vec.ts";
import { CAR_LENGTH, CAR_WIDTH } from "./tuning.ts";
import { shade } from "./theme.ts";
import { gridSlot, type BuiltTrack } from "../track/Track.ts";

const TAU = Math.PI * 2;

/** Curb width (world px), centred on each road edge. */
export const CURB_WIDTH = 14;

/** Grid slots painted behind the line (the pole sits on the line itself). */
const GRID_BOXES = 5;

/** Small, fast, seedable PRNG (mulberry32): same seed, same scenery. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of a string, for seeding `rng` from an id or colour. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Distance from `p` to the closed centerline polyline. */
export function distToCenterLine(cl: Vec2[], p: Vec2): number {
  let best = Infinity;
  for (let i = 0; i < cl.length; i++) {
    const a = cl[i];
    const b = cl[(i + 1) % cl.length];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    const t =
      len2 === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2),
          );
    best = Math.min(best, Math.hypot(p.x - a.x - abx * t, p.y - a.y - aby * t));
  }
  return best;
}

export type SceneryKind = "tires" | "cone" | "bush";

export interface SceneryItem {
  kind: SceneryKind;
  x: number;
  y: number;
  /** Footprint radius (world px), used for spacing and road clearance. */
  r: number;
  /** Orientation (rad): tyre stacks line up with the road. */
  angle: number;
  /** Bush clumps: offsets + radii of the leafy blobs that make one up. */
  blobs?: { dx: number; dy: number; r: number }[];
}

/**
 * Scatter scenery around a track: tyre stacks just outside the curbs, cones,
 * and bushes further out. Deterministic per track id, and every item is clear
 * of the road (anywhere along it, not just where it was placed) and of each
 * other.
 */
export function sceneryFor(track: BuiltTrack): SceneryItem[] {
  const rand = rng(hashString(track.def.id));
  const cl = track.centerLine;
  const n = cl.length;
  const half = track.width / 2;
  const roadEdge = half + CURB_WIDTH / 2;
  const items: SceneryItem[] = [];
  for (let i = 0; i < n; i += 2) {
    const a = cl[(i - 1 + n) % n];
    const b = cl[(i + 1) % n];
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    // Unit normal from the centerline toward the `outer` offset.
    const nx = (track.outer[i].x - cl[i].x) / half;
    const ny = (track.outer[i].y - cl[i].y) / half;
    for (const side of [1, -1]) {
      if (rand() < 0.42) continue;
      const roll = rand();
      const kind: SceneryKind =
        roll < 0.34 ? "tires" : roll < 0.48 ? "cone" : "bush";
      const r = kind === "tires" ? 7 : kind === "cone" ? 4 : 10 + rand() * 12;
      const gap =
        kind === "tires"
          ? 14 + rand() * 10
          : kind === "cone"
            ? 10 + rand() * 30
            : 36 + rand() * 120;
      const off = roadEdge + gap + r;
      const x = cl[i].x + nx * side * off;
      const y = cl[i].y + ny * side * off;
      // A tyre stack is three tyres in a row: clear its whole length.
      const reach = kind === "tires" ? r * 3 : r;
      if (distToCenterLine(cl, { x, y }) < roadEdge + reach + 6) continue;
      if (items.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + r + 10))
        continue;
      const item: SceneryItem = { kind, x, y, r, angle };
      if (kind === "bush") {
        const count = 3 + Math.floor(rand() * 3);
        item.blobs = Array.from({ length: count }, () => {
          const t = rand() * TAU;
          const d = rand() * r * 0.45;
          return {
            dx: Math.cos(t) * d,
            dy: Math.sin(t) * d,
            r: r * (0.45 + rand() * 0.3),
          };
        });
      }
      items.push(item);
    }
  }
  return items;
}

/** Leaf colour that suits the ground: green on grass, olive on dirt. */
export function foliageFor(background: string): string {
  const n = parseInt(background.slice(1, 7), 16);
  if (Number.isNaN(n)) return "#3e7d3a";
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  return r > g ? "#77803f" : "#3e7d3a";
}

/** A 96px asphalt tile: the surface colour flecked with aggregate. */
export function paintAsphaltTile(
  g: CanvasRenderingContext2D,
  size: number,
  surface: string,
): void {
  const rand = rng(hashString(surface));
  g.fillStyle = surface;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size * 0.1; i++) {
    const v = rand();
    g.fillStyle =
      v < 0.45
        ? "rgba(255,255,255,0.06)"
        : v < 0.9
          ? "rgba(0,0,0,0.14)"
          : "rgba(255,255,255,0.14)";
    g.fillRect(rand() * size, rand() * size, rand() < 0.3 ? 1.6 : 1, 1);
  }
}

/** A seamless ground tile: soft blotches + fine speckle over `color`. */
export function paintGroundTile(
  g: CanvasRenderingContext2D,
  size: number,
  color: string,
): void {
  const rand = rng(hashString(color));
  g.fillStyle = color;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 16; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 18 + rand() * 46;
    const tint = rand() < 0.5 ? "255,255,255" : "0,0,0";
    const alpha = tint === "0,0,0" ? 0.1 : 0.04;
    // Drawn at every wrapped position so the tile repeats seamlessly.
    for (const ox of [-size, 0, size])
      for (const oy of [-size, 0, size]) {
        const cx = x + ox;
        const cy = y + oy;
        if (cx + r < 0 || cx - r > size || cy + r < 0 || cy - r > size)
          continue;
        const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, `rgba(${tint},${alpha})`);
        grad.addColorStop(1, `rgba(${tint},0)`);
        g.fillStyle = grad;
        g.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
  }
  for (let i = 0; i < size * size * 0.035; i++) {
    g.fillStyle = rand() < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.13)";
    g.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 1, 1);
  }
}

/**
 * Paint the whole static track into `g`, whose transform maps world px to the
 * target: raised-road shadow, curbs, textured asphalt, start line, grid boxes
 * and scenery. The road is drawn by stroking the centerline, so it is exactly
 * the band the physics keeps cars in (and never folds at tight corners).
 */
export function paintTrackArt(
  g: CanvasRenderingContext2D,
  track: BuiltTrack,
  asphalt: CanvasPattern | string,
  scenery: SceneryItem[],
): void {
  const road = track.width;
  const trace = (): void => {
    g.beginPath();
    track.centerLine.forEach((p, i) =>
      i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y),
    );
    g.closePath();
  };
  g.save();
  g.lineJoin = "round";

  // The road sits a touch proud of the ground: a soft shadow down-right.
  g.save();
  g.translate(5, 7);
  trace();
  g.strokeStyle = "rgba(0,0,0,0.2)";
  g.lineWidth = road + CURB_WIDTH + 12;
  g.stroke();
  g.strokeStyle = "rgba(0,0,0,0.25)";
  g.lineWidth = road + CURB_WIDTH + 2;
  g.stroke();
  g.restore();

  trace();
  // Dark rim, then red/white curb blocks across the full curb band...
  g.strokeStyle = "#151515";
  g.lineWidth = road + CURB_WIDTH + 3;
  g.stroke();
  g.strokeStyle = "#c0392b";
  g.lineWidth = road + CURB_WIDTH;
  g.stroke();
  g.setLineDash([14, 14]);
  g.strokeStyle = "#f2efe6";
  g.stroke();
  g.setLineDash([]);
  // ...a shadow line where curb meets asphalt, then the asphalt itself.
  g.strokeStyle = "rgba(0,0,0,0.45)";
  g.lineWidth = road - CURB_WIDTH + 3;
  g.stroke();
  g.strokeStyle = asphalt;
  g.lineWidth = road - CURB_WIDTH;
  g.stroke();
  // Rubbered-in racing groove down the middle.
  g.strokeStyle = "rgba(0,0,0,0.06)";
  g.lineWidth = road * 0.45;
  g.stroke();
  g.lineWidth = road * 0.22;
  g.stroke();

  paintStartLine(g, track);
  paintGridBoxes(g, track);
  const foliage = foliageFor(track.def.background ?? "#0d1f14");
  for (const it of scenery) paintScenery(g, it, foliage);
  g.restore();
}

/** A two-row chequered band across the asphalt at the start/finish. */
function paintStartLine(g: CanvasRenderingContext2D, track: BuiltTrack): void {
  const { pos, heading } = track.start;
  const across = track.width - CURB_WIDTH;
  const cols = 10;
  const cell = across / cols;
  g.save();
  g.translate(pos.x, pos.y);
  g.rotate(heading);
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < cols; c++) {
      g.fillStyle = (r + c) % 2 === 0 ? "#f4f4f4" : "#141414";
      g.fillRect((r - 1) * cell, -across / 2 + c * cell, cell, cell);
    }
  g.restore();
}

/** Painted grid boxes (open at the front) for the slots behind the pole. */
function paintGridBoxes(g: CanvasRenderingContext2D, track: BuiltTrack): void {
  const len = CAR_LENGTH + 8;
  const wid = CAR_WIDTH + 8;
  g.save();
  g.strokeStyle = "rgba(255,255,255,0.5)";
  g.lineWidth = 2;
  for (let slot = 1; slot <= GRID_BOXES; slot++) {
    const s = gridSlot(track, slot);
    g.save();
    g.translate(s.x, s.y);
    g.rotate(s.heading);
    g.beginPath();
    g.moveTo(len / 2, -wid / 2);
    g.lineTo(-len / 2, -wid / 2);
    g.lineTo(-len / 2, wid / 2);
    g.lineTo(len / 2, wid / 2);
    g.stroke();
    g.restore();
  }
  g.restore();
}

function paintScenery(
  g: CanvasRenderingContext2D,
  it: SceneryItem,
  foliage: string,
): void {
  if (it.kind === "tires") {
    // Three tyres in a row along the road, each with a drop shadow.
    const dx = Math.cos(it.angle) * it.r * 2;
    const dy = Math.sin(it.angle) * it.r * 2;
    for (let k = -1; k <= 1; k++) {
      const x = it.x + dx * k;
      const y = it.y + dy * k;
      shadow(g, x, y, it.r);
      g.fillStyle = k === 0 ? "#b8322f" : "#1b1b1b";
      circle(g, x, y, it.r);
      g.strokeStyle = "rgba(255,255,255,0.14)";
      g.lineWidth = 1;
      g.beginPath();
      g.arc(x, y, it.r - 1.8, Math.PI * 0.9, Math.PI * 1.7);
      g.stroke();
      g.fillStyle = "#080808";
      circle(g, x, y, it.r * 0.42);
    }
  } else if (it.kind === "cone") {
    shadow(g, it.x, it.y, it.r);
    g.fillStyle = "#ff7a1a";
    circle(g, it.x, it.y, it.r);
    g.strokeStyle = "#f7f3ea";
    g.lineWidth = 1.3;
    g.beginPath();
    g.arc(it.x, it.y, it.r * 0.6, 0, TAU);
    g.stroke();
    g.fillStyle = "#ffb070";
    circle(g, it.x - 0.6, it.y - 0.6, it.r * 0.28);
  } else {
    shadow(g, it.x, it.y, it.r);
    for (const b of it.blobs ?? []) {
      const x = it.x + b.dx;
      const y = it.y + b.dy;
      // Lit from the top-left, like the road's shadow implies.
      const grad = g.createRadialGradient(
        x - b.r * 0.35,
        y - b.r * 0.35,
        b.r * 0.1,
        x,
        y,
        b.r,
      );
      grad.addColorStop(0, shade(foliage, 0.28));
      grad.addColorStop(0.7, foliage);
      grad.addColorStop(1, shade(foliage, -0.4));
      g.fillStyle = grad;
      circle(g, x, y, b.r);
    }
  }
}

function shadow(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
): void {
  g.fillStyle = "rgba(0,0,0,0.3)";
  g.beginPath();
  g.ellipse(x + 3, y + 4.5, r * 1.05, r * 0.95, 0, 0, TAU);
  g.fill();
}

function circle(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
): void {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
}
