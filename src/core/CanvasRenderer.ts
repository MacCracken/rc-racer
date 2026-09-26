import type Matter from "matter-js";
import type { Camera } from "./Camera.ts";
import type { IRenderer, RenderScene } from "./types.ts";
import type { BuiltTrack, TrackDef } from "../track/Track.ts";
import type { RaceState } from "../race/RaceState.ts";
import type { SkidMark } from "./SkidMarks.ts";
import type { Ghost } from "../race/Ghost.ts";
import { CAR_LENGTH, CAR_WIDTH } from "./tuning.ts";
import { formatLap, currentLapTimeMs } from "../race/RaceState.ts";
import {
  carPalette,
  hudScaleOf,
  type ColorMode,
  type HudSize,
} from "./theme.ts";

/**
 * Canvas2D top-down renderer. Draws the world in world-space via the camera,
 * then overlays screen-space HUD text. Intentionally small and dependency-free;
 * it's the one Phase-1 class that may be swapped for PixiJS later.
 */
export class Canvas2DRenderer implements IRenderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
   /** Presentation theme, driven by the persisted Settings. */
  private colorMode: ColorMode = "std";
  private hudScale = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("2D context unavailable");
    this.ctx = ctx;
  }

   /** Apply the persisted presentation theme (palette + HUD size). */
  setSettings(colorMode: ColorMode, hudSize: HudSize): void {
    this.colorMode = colorMode;
    this.hudScale = hudScaleOf(hudSize);
     }

  resize(
    width: number,
    height: number,
    dpr = window.devicePixelRatio || 1,
  ): void {
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  render(scene: RenderScene): void {
    const {
      camera,
      track,
      car,
      race,
      speed,
      nowMs,
      rivals,
      position,
      total,
      skidMarks,
      ghost,
      confettiAgeMs,
      fps,
      hud = true,
    } = scene;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.drawBackground(track.def, w, h);
    this.drawTrack(track, camera);
    this.drawSkidMarks(skidMarks, camera);
    this.drawGhost(ghost, camera);
    this.drawNextGate(track, camera, race);
    this.drawRivals(rivals, camera);
    this.drawCar(car, camera);
    if (hud)
      this.drawHUD(
        track.def.name,
        race,
        track,
        speed,
        nowMs,
        w,
        h,
        position,
        total,
        car,
        fps,
        rivals,
      );
    if (confettiAgeMs !== undefined && confettiAgeMs >= 0) {
      this.drawConfetti(this.ctx, w, h, confettiAgeMs);
    }
  }

  // --- world-space rendering ---

  private drawBackground(def: TrackDef, w: number, h: number): void {
    const { ctx } = this;
    ctx.fillStyle = def.background ?? "#0d1f14";
    ctx.fillRect(0, 0, w, h);
  }

  private drawTrack(track: BuiltTrack, cam: Camera): void {
    const { ctx } = this;
    const surface = track.def.surface ?? "#39404a";
    const road = track.width * cam.zoom;
    const curb = 10; // screen px, centred on each road edge

    // The road is every point within width/2 of the centerline, which is the
    // exact band the physics keeps cars in. Stroking the centerline draws
    // that, rounding the inside of corners tighter than the road is wide,
    // where the offset `inner`/`outer` outlines fold into little bowties.
    // Layered strokes (widest first) give the curbs: a red base, white dashes,
    // then red and asphalt again to trim each curb to a band on the edge.
    ctx.save();
    ctx.lineJoin = "round";
    ctx.beginPath();
    this.tracePolygon(track.centerLine, cam, true);
    ctx.strokeStyle = "#b23a3a";
    ctx.lineWidth = road + curb;
    ctx.stroke();
    ctx.setLineDash([18, 18]);
    ctx.strokeStyle = "#f4f4f4";
    ctx.lineWidth = road + curb / 2;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "#b23a3a";
    ctx.lineWidth = Math.max(0, road - curb / 2);
    ctx.stroke();
    ctx.strokeStyle = surface;
    ctx.lineWidth = Math.max(0, road - curb);
    ctx.stroke();
    ctx.restore();

    // Start / finish line at gate 0.
    this.drawStartLine(track, cam);
  }

  /**
   * Draw the skid trail on the asphalt, under the cars. Each mark is a short
   * dark segment oriented with the car's heading, fading with its alpha.
   */
  /** Faded best-line overlay the player can chase; cosmetic only. */
  private drawGhost(ghost: Ghost | undefined, cam: Camera): void {
    if (ghost === undefined || ghost.length < 2) return;
    const { ctx } = this;
    ctx.save();
    ctx.lineWidth = Math.max(2, 5 * cam.zoom);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(90, 200, 255, 0.45)";
    ctx.beginPath();
    let started = false;
    for (const g of ghost) {
      const sp = cam.toScreen({ x: g.x, y: g.y });
      if (!started) {
        ctx.moveTo(sp.x, sp.y);
        started = true;
      } else {
        ctx.lineTo(sp.x, sp.y);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawSkidMarks(marks: SkidMark[] | undefined, cam: Camera): void {
    if (marks === undefined || marks.length === 0) return;
    const { ctx } = this;
    const len = CAR_LENGTH * 0.55 * cam.zoom;
    const width = Math.max(2, CAR_WIDTH * 0.32 * cam.zoom);
    ctx.save();
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    for (const m of marks) {
      const p = cam.toScreen({ x: m.x, y: m.y });
      const dx = Math.cos(m.angle) * (len / 2);
      const dy = Math.sin(m.angle) * (len / 2);
      ctx.globalAlpha = m.alpha * 0.35;
      ctx.strokeStyle = "#0a0a0a";
      ctx.beginPath();
      ctx.moveTo(p.x - dx, p.y - dy);
      ctx.lineTo(p.x + dx, p.y + dy);
      ctx.stroke();

      // tire smoke puff
      if (m.alpha > 0.5) {
        ctx.globalAlpha = m.alpha * 0.12;
        ctx.fillStyle = "#222";
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, width * 2, width, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private drawStartLine(track: BuiltTrack, cam: Camera): void {
    const { ctx } = this;
    const gate = track.gates[0];
    if (gate === undefined) return;
    const a = cam.toScreen(gate.a);
    const b = cam.toScreen(gate.b);
    ctx.save();
    // A simple checkered band: two passes of alternating squares.
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const n = 8;
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      const p0 = { x: a.x + dx * t0, y: a.y + dy * t0 };
      const p1 = { x: a.x + dx * t1, y: a.y + dy * t1 };
      ctx.strokeStyle = i % 2 === 0 ? "#fff" : "#111";
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawNextGate(track: BuiltTrack, cam: Camera, race: RaceState): void {
    const { ctx } = this;
    const gate = track.gates[race.nextGate];
    if (gate === undefined) return;
    const a = cam.toScreen(gate.a);
    const b = cam.toScreen(gate.b);
    ctx.save();
    ctx.strokeStyle = "rgba(120,220,255,0.45)";
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  private drawRivals(rivals: Matter.Body[] | undefined, cam: Camera): void {
    if (rivals === undefined || rivals.length === 0) return;
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    const w = CAR_WIDTH * cam.zoom;
    const l = CAR_LENGTH * cam.zoom * 0.9;
    const rival = carPalette(this.colorMode).rival;
    for (const r of rivals) {
      const p = cam.toScreen({ x: r.position.x, y: r.position.y });
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(r.angle);
      ctx.fillStyle = rival;
      this.roundRect(-l / 2, -w / 2, l, w, 2 * cam.zoom);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  private drawCar(car: Matter.Body, cam: Camera): void {
    const { ctx } = this;
    const p = cam.toScreen({ x: car.position.x, y: car.position.y });
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(car.angle); // Matter.js angle: 0 = facing +x, which is forward.
    const w = CAR_WIDTH * cam.zoom;
    const l = CAR_LENGTH * cam.zoom;
    const pal = carPalette(this.colorMode);
    ctx.fillStyle = pal.player;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    this.roundRect(-l / 2, -w / 2, l, w, 3 * cam.zoom);
    ctx.fill();
    ctx.stroke();
    // nose marker (fore)
    ctx.fillStyle = pal.nose;
    ctx.fillRect(l * 0.1, -w * 0.3, l * 0.15, w * 0.6);
    ctx.restore();
  }

  // --- screen-space HUD ---

  private drawHUD(
    trackName: string,
    race: RaceState,
    track: BuiltTrack,
    speed: number,
    nowMs: number,
    w: number,
    h: number,
    position?: number,
    total?: number,
    car?: Matter.Body,
    fps?: number,
    rivals?: Matter.Body[],
  ): void {
    const { ctx } = this;
    const s = this.hudScale;
    const pad = 12;
    const barH = 48 * s;
    const row1 = 8 * s;
    const row2 = 28 * s;
    const font = `${16 * s}px system-ui, sans-serif`;
    ctx.save();
    ctx.font = font;
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, w, barH);
    ctx.fillStyle = "#fff";

    const kmh = Math.round(Math.abs(speed) * 0.6);
    // The lap being driven (1-based), not laps completed: the final lap
    // reads 3/3, not 2/3.
    const laps = `${Math.min(race.lap + 1, track.laps)}/${track.laps}`;
    const cur = currentLapTimeMs(race, nowMs);
    const best =
      race.bestLapMs === Infinity ? "--:--.---" : formatLap(race.bestLapMs);
    const last = race.lastLapMs === 0 ? "--:--.---" : formatLap(race.lastLapMs);

    // Columns sized from worst-case text, so they never overlap at any HUD
    // size and don't shuffle as the digits change.
    const cols: [text: string, widest: string][] = [
      [`LAP ${laps}`, "LAP 00/00"],
      [`BEST ${best}`, "BEST 00:00.000"],
      [`LAST ${last}`, "LAST 00:00.000"],
      [`NOW ${formatLap(cur)}`, "NOW 00:00.000"],
    ];
    let x = pad;
    for (const [text, widest] of cols) {
      ctx.fillText(text, x, row1);
      x += ctx.measureText(widest).width + 24 * s;
    }
    ctx.fillText(trackName, pad, row2);

    // Position + FPS, right-aligned in the bar (the minimap sits below it).
    ctx.textAlign = "right";
    if (position !== undefined && total !== undefined) {
      ctx.font = `bold ${18 * s}px system-ui, sans-serif`;
      ctx.fillText("P " + position + "/" + total, w - pad, row1);
      ctx.font = font;
    }
    if (fps !== undefined) {
      ctx.fillText(`FPS ${Math.round(fps)}`, w - pad, row2);
    }
    ctx.textAlign = "left";

    // speed box, lower-right
    const boxW = 190 * s;
    const boxH = 42 * s;
    const boxX = w - boxW - 10;
    const boxY = h - boxH - 10;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.fillStyle = "#fff";
    ctx.fillText(`SPD ${kmh} km/h`, boxX + 10 * s, boxY + 13 * s);

    // minimap top-right, under the bar
    if (car) this.drawMinimap(ctx, track, car, w, barH + pad, rivals);

    ctx.restore();
  }

  private drawMinimap(
    ctx: CanvasRenderingContext2D,
    track: BuiltTrack,
    car: Matter.Body,
    w: number,
    top: number,
    rivals?: Matter.Body[],
  ): void {
    const pad = 12;
    const mapW = Math.round(160 * this.hudScale);
    const mapH = Math.round(100 * this.hudScale);
    const mapX = w - mapW - pad;
    const mapY = top;

    // background
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(mapX - 4, mapY - 4, mapW + 8, mapH + 8);
    ctx.fillStyle = "rgba(10,20,12,0.85)";
    ctx.fillRect(mapX, mapY, mapW, mapH);

    // compute bounds from outer ring
    const pts = track.outer;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const rangeX = Math.max(1, maxX - minX);
    const rangeY = Math.max(1, maxY - minY);
    const scale = Math.min(mapW / rangeX, mapH / rangeY) * 0.9;
    const offX = mapX + (mapW - rangeX * scale) / 2 - minX * scale;
    const offY = mapY + (mapH - rangeY * scale) / 2 - minY * scale;

    const to = (p: { x: number; y: number }) => ({
      x: offX + p.x * scale,
      y: offY + p.y * scale,
    });

    // track outline
    ctx.strokeStyle = "#4a6b4a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const q = to(p);
      if (i === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    });
    ctx.closePath();
    ctx.stroke();

    // inner
    ctx.strokeStyle = "#2b3d2b";
    ctx.beginPath();
    track.inner.forEach((p, i) => {
      const q = to(p);
      if (i === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    });
    ctx.closePath();
    ctx.stroke();

    // Car dots in the same (colour-blind aware) palette as the cars on track.
    const pal = carPalette(this.colorMode);
    const dot = (b: Matter.Body, color: string, r: number): void => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(offX + b.position.x * scale, offY + b.position.y * scale, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    for (const r of rivals ?? []) dot(r, pal.rival, 2.5);
    dot(car, pal.player, 3.5);
  }

  private drawConfetti(ctx: CanvasRenderingContext2D, w: number, h: number, ageMs: number): void {
    const duration = 1600;
    if (ageMs > duration) return;
    const t = ageMs / 1000;
    // Fixed per-piece randoms (a cheap hash of the index), so each piece flies
    // a steady path instead of re-rolling its position every frame.
    const rnd = (i: number, k: number): number => {
      const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
      return v - Math.floor(v);
    };
    ctx.save();
    ctx.globalAlpha = 1 - ageMs / duration;
    const count = 80;
    const gravity = 1.2 * h; // px/s²
    for (let i = 0; i < count; i++) {
      // A fountain: pieces fly up into the open space above the results panel
      // (which covers the screen's middle), then fall back behind it.
      const vx = (rnd(i, 1) - 0.5) * w * 0.9;
      const vy = -(0.35 + 0.35 * rnd(i, 2)) * h;
      const x = w * 0.5 + vx * t;
      const y = h * 0.32 + vy * t + 0.5 * gravity * t * t;
      const size = 4 + rnd(i, 3) * 4;
      ctx.fillStyle = `hsl(${(i * 137.5) % 360}, 90%, 65%)`;
      ctx.fillRect(x, y, size, size * 0.6);
    }
    ctx.restore();
  }

  // --- geometry helpers ---

  private tracePolygon(
    pts: { x: number; y: number }[],
    cam: Camera,
    close: boolean,
  ): void {
    const { ctx } = this;
    for (let i = 0; i < pts.length; i++) {
      const p = cam.toScreen(pts[i]);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    if (close) ctx.closePath();
  }

  private roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
