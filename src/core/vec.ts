/** Shared 2D vector math. Pure. */
export interface Vec2 {
  x: number;
  y: number;
}

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });
export const normalize = (a: Vec2): Vec2 => {
  const l = len(a);
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};

/**
 * Do finite segments (p1->p2) and (p3->p4) intersect? Includes shared
 * endpoints (so a moving point that lands exactly on a gate counts as a cross).
 */
export function segmentsIntersect(
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  p4: Vec2,
): boolean {
  const cross = (a: Vec2, b: Vec2, c: Vec2): number =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  )
    return true;

  // Collinear / endpoint-touch cases.
  return (
    (d1 === 0 && onSegment(p3, p4, p1)) ||
    (d2 === 0 && onSegment(p3, p4, p2)) ||
    (d3 === 0 && onSegment(p1, p2, p3)) ||
    (d4 === 0 && onSegment(p1, p2, p4))
  );
}

function onSegment(a: Vec2, b: Vec2, p: Vec2): boolean {
  return (
    p.x <= Math.max(a.x, b.x) + 1e-9 &&
    p.x >= Math.min(a.x, b.x) - 1e-9 &&
    p.y <= Math.max(a.y, b.y) + 1e-9 &&
    p.y >= Math.min(a.y, b.y) - 1e-9
  );
}
