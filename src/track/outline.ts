/**
 * A track's shape as a small outline for the menu: its centerline fitted into
 * a `w` x `h` box as an SVG path, with the road's width scaled to match and
 * where the start line sits. Pure geometry; the UI turns it into markup.
 */
import type { TrackDef } from "./Track.ts";

export interface TrackOutline {
  /** SVG path data for the closed centerline, in box coordinates. */
  d: string;
  /** The road's width at this scale (a stroke width), clamped to stay legible. */
  road: number;
  /** The start line's position in the box. */
  start: { x: number; y: number };
}

/** Points kept in an outline: plenty for a thumbnail, small for the page. */
const MAX_POINTS = 60;

export function outlineOf(def: TrackDef, w: number, h: number): TrackOutline {
  const cl = def.centerLine;
  if (cl.length === 0) return { d: "", road: 0, start: { x: w / 2, y: h / 2 } };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of cl) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  // Fit the road itself (the centerline plus half its width) in the box.
  const scale = Math.min(
    w / Math.max(1, maxX - minX + def.width),
    h / Math.max(1, maxY - minY + def.width),
  );
  const ox = (w - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = (h - (maxY - minY) * scale) / 2 - minY * scale;
  const at = (i: number) => ({
    x: +(ox + cl[i].x * scale).toFixed(1),
    y: +(oy + cl[i].y * scale).toFixed(1),
  });
  const step = Math.max(1, Math.ceil(cl.length / MAX_POINTS));
  const pts: string[] = [];
  for (let i = 0; i < cl.length; i += step) {
    const p = at(i);
    pts.push(`${pts.length === 0 ? "M" : "L"}${p.x} ${p.y}`);
  }
  return {
    d: `${pts.join(" ")} Z`,
    road: Math.max(2.5, Math.min(7, def.width * scale)),
    start: at(0),
  };
}
