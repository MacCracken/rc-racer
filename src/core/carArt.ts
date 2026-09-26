/**
 * Top-down car art, one body style per car class. Drawn as vectors in the
 * car's local frame (origin at its centre, +x forward, units = world px), so
 * it stays crisp at any zoom; the caller sets up translate/rotate/scale.
 * Paint shading is derived from a single palette colour via `shade`, so the
 * colour-blind palette gets the same lighting.
 */
import { CAR_LENGTH, CAR_WIDTH } from "./tuning.ts";
import { shade, type CarLook } from "./theme.ts";

const HL = CAR_LENGTH / 2; // 15
const HW = CAR_WIDTH / 2; // 8

/** Paint + live controls a car is drawn with. */
export interface CarPaint {
  body: string;
  accent: string;
  /** -1..1: turns the front wheels. */
  steer: number;
  /** Brake lights on. */
  braking: boolean;
}

/** Body shading across the car's width: lit crown, darker flanks. */
function bodyGradient(
  g: CanvasRenderingContext2D,
  base: string,
  half: number,
): CanvasGradient {
  const gr = g.createLinearGradient(0, -half, 0, half);
  gr.addColorStop(0, shade(base, -0.4));
  gr.addColorStop(0.28, shade(base, 0.1));
  gr.addColorStop(0.45, shade(base, 0.28));
  gr.addColorStop(0.7, base);
  gr.addColorStop(1, shade(base, -0.45));
  return gr;
}

function rrect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const k = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + k, y);
  g.arcTo(x + w, y, x + w, y + h, k);
  g.arcTo(x + w, y + h, x, y + h, k);
  g.arcTo(x, y + h, x, y, k);
  g.arcTo(x, y, x + w, y, k);
  g.closePath();
}

function wheel(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  len: number,
  wid: number,
  angle: number,
): void {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.fillStyle = "#141414";
  rrect(g, -len / 2, -wid / 2, len, wid, 1.4);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.13)"; // tread sheen
  g.fillRect(-len / 2 + 1, -wid / 2 + 0.6, len - 2, 0.8);
  g.restore();
}

function lights(
  g: CanvasRenderingContext2D,
  front: number,
  rear: number,
  spread: number,
  braking: boolean,
): void {
  g.fillStyle = "#fff4c2";
  g.fillRect(front - 1.6, -spread - 1.3, 1.6, 2.6);
  g.fillRect(front - 1.6, spread - 1.3, 1.6, 2.6);
  if (braking) {
    g.fillStyle = "rgba(255,50,30,0.35)"; // glow
    g.beginPath();
    g.arc(rear, -spread, 3.2, 0, Math.PI * 2);
    g.arc(rear, spread, 3.2, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = braking ? "#ff3a2a" : "#7d1812";
  g.fillRect(rear, -spread - 1.2, 1.4, 2.4);
  g.fillRect(rear, spread - 1.2, 1.4, 2.4);
}

/** The ground shadow's footprint (the caller offsets + fills it). */
export function traceCarShadow(g: CanvasRenderingContext2D, look: CarLook): void {
  const halfW = look === "sedan" ? HW + 1 : HW + 3;
  rrect(g, -HL - 1, -halfW, CAR_LENGTH + 2, halfW * 2, 5);
}

export function paintCar(
  g: CanvasRenderingContext2D,
  look: CarLook,
  p: CarPaint,
): void {
  const steer = Math.max(-1, Math.min(1, p.steer)) * 0.45;
  g.lineJoin = "round";
  if (look === "buggy") paintBuggy(g, p, steer);
  else if (look === "brawler") paintBrawler(g, p, steer);
  else paintSedan(g, p, steer);
}

/** Street sedan: tucked-in wheels, glasshouse + roof, a centre stripe. */
function paintSedan(g: CanvasRenderingContext2D, p: CarPaint, steer: number): void {
  const wy = HW - 1.2;
  wheel(g, 9, -wy, 7, 3.6, steer);
  wheel(g, 9, wy, 7, 3.6, steer);
  wheel(g, -9, -wy, 7, 3.6, 0);
  wheel(g, -9, wy, 7, 3.6, 0);

  g.fillStyle = bodyGradient(g, p.body, HW - 0.8);
  rrect(g, -HL, -HW + 0.8, CAR_LENGTH, CAR_WIDTH - 1.6, 4.5);
  g.fill();
  g.strokeStyle = "rgba(0,0,0,0.6)";
  g.lineWidth = 0.8;
  g.stroke();

  g.fillStyle = p.accent; // stripe over hood + trunk
  g.fillRect(-HL + 1, -1.2, CAR_LENGTH - 2, 2.4);

  g.fillStyle = "#1c2631"; // glasshouse
  rrect(g, -8, -5.4, 14, 10.8, 3);
  g.fill();
  g.fillStyle = "rgba(170,210,235,0.35)"; // windscreen glint
  rrect(g, 3, -4.6, 2.4, 9.2, 1);
  g.fill();
  g.fillStyle = shade(p.body, 0.06); // roof
  rrect(g, -5.5, -4.2, 8.2, 8.4, 2);
  g.fill();
  g.fillStyle = p.accent;
  g.fillRect(-5.5, -1.2, 8.2, 2.4);

  g.fillStyle = shade(p.body, -0.35); // mirrors
  g.fillRect(2.5, -HW - 0.4, 1.4, 1.4);
  g.fillRect(2.5, HW - 1, 1.4, 1.4);
  lights(g, HL, -HL, HW - 3.2, p.braking);
}

/** 1/10 buggy: outboard wheels on arms, slim tub, cockpit, big rear wing. */
function paintBuggy(g: CanvasRenderingContext2D, p: CarPaint, steer: number): void {
  const wy = HW + 0.8;
  g.strokeStyle = "#262626"; // suspension arms
  g.lineWidth = 1.2;
  g.beginPath();
  for (const [x, s] of [
    [9.5, -1],
    [9.5, 1],
    [-9, -1],
    [-9, 1],
  ]) {
    g.moveTo(x, s * 2.5);
    g.lineTo(x, s * (wy - 1));
  }
  g.stroke();
  wheel(g, 9.5, -wy, 7, 3.6, steer);
  wheel(g, 9.5, wy, 7, 3.6, steer);
  wheel(g, -9, -wy, 7.6, 4.8, 0);
  wheel(g, -9, wy, 7.6, 4.8, 0);

  g.fillStyle = bodyGradient(g, p.body, 5.2); // tapered tub
  g.beginPath();
  g.moveTo(HL + 0.5, -2);
  g.lineTo(8, -4.2);
  g.lineTo(-2, -5.2);
  g.lineTo(-11, -5);
  g.lineTo(-14, -3.4);
  g.lineTo(-14, 3.4);
  g.lineTo(-11, 5);
  g.lineTo(-2, 5.2);
  g.lineTo(8, 4.2);
  g.lineTo(HL + 0.5, 2);
  g.closePath();
  g.fill();
  g.strokeStyle = "rgba(0,0,0,0.6)";
  g.lineWidth = 0.8;
  g.stroke();

  g.fillStyle = "#1a222b"; // cockpit
  g.beginPath();
  g.ellipse(0.5, 0, 5, 3.3, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = p.accent; // driver's helmet
  g.beginPath();
  g.arc(-0.3, 0, 2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.45)";
  g.beginPath();
  g.arc(-0.9, -0.7, 0.7, 0, Math.PI * 2);
  g.fill();

  g.fillStyle = shade(p.body, -0.45); // rear wing, with an accent stripe
  rrect(g, -HL - 1.5, -HW - 1.5, 3.6, CAR_WIDTH + 3, 1);
  g.fill();
  g.strokeStyle = "rgba(0,0,0,0.6)";
  g.stroke();
  g.fillStyle = p.accent;
  g.fillRect(-HL - 0.3, -HW - 0.5, 1.2, CAR_WIDTH + 1);
  g.fillStyle = "#2a2a2a"; // front bumper
  g.fillRect(HL + 0.2, -2.6, 1.3, 5.2);
  lights(g, HL - 1, -14.2, 1.7, p.braking);
}

/** 1/8 brawler: wide truck body, flared fenders, cab + bed, bull bar. */
function paintBrawler(g: CanvasRenderingContext2D, p: CarPaint, steer: number): void {
  const wy = HW + 1.2;
  wheel(g, 9.5, -wy, 8.6, 5, steer);
  wheel(g, 9.5, wy, 8.6, 5, steer);
  wheel(g, -9.5, -wy, 8.6, 5, 0);
  wheel(g, -9.5, wy, 8.6, 5, 0);

  g.fillStyle = shade(p.body, -0.5); // fender flares
  for (const x of [9.5, -9.5]) {
    rrect(g, x - 5.4, -HW - 0.6, 10.8, 3, 1.2);
    g.fill();
    rrect(g, x - 5.4, HW - 2.4, 10.8, 3, 1.2);
    g.fill();
  }

  g.fillStyle = bodyGradient(g, p.body, HW - 0.4);
  rrect(g, -HL, -HW + 0.4, CAR_LENGTH, CAR_WIDTH - 0.8, 3);
  g.fill();
  g.strokeStyle = "rgba(0,0,0,0.6)";
  g.lineWidth = 0.8;
  g.stroke();

  g.fillStyle = shade(p.body, -0.35); // bed + ribs
  rrect(g, -13.6, -5.8, 10.2, 11.6, 1.5);
  g.fill();
  g.strokeStyle = "rgba(0,0,0,0.3)";
  g.lineWidth = 0.6;
  g.beginPath();
  for (const y of [-2.6, 0, 2.6]) {
    g.moveTo(-12.8, y);
    g.lineTo(-4.2, y);
  }
  g.stroke();

  g.fillStyle = "#1c2631"; // cab glass
  rrect(g, -2, -5.8, 11, 11.6, 2.5);
  g.fill();
  g.fillStyle = "rgba(170,210,235,0.35)";
  rrect(g, 6.4, -5, 2.2, 10, 1);
  g.fill();
  g.fillStyle = shade(p.body, 0.08); // roof
  rrect(g, 0, -4.6, 6.2, 9.2, 1.8);
  g.fill();
  g.fillStyle = "#ffd36b"; // roof light bar
  g.fillRect(5.4, -3.6, 0.9, 7.2);
  g.fillStyle = p.accent;
  g.fillRect(0, -1, 6.2, 2);

  g.fillStyle = "#2b2b2b"; // bull bar
  rrect(g, HL - 0.2, -HW + 1.2, 2.2, CAR_WIDTH - 2.4, 0.8);
  g.fill();
  lights(g, HL - 0.4, -HL, HW - 2.6, p.braking);
}
