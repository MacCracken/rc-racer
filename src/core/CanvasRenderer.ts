import type Matter from "matter-js";
import type { Camera } from "./Camera.ts";
import type { IRenderer, RenderScene } from "./types.ts";
import type { BuiltTrack, TrackDef } from "../track/Track.ts";
import type { RaceState } from "../race/RaceState.ts";
import type { SkidMark } from "./SkidMarks.ts";
import type { Ghost } from "../race/Ghost.ts";
import { CAR_LENGTH, CAR_WIDTH } from "./tuning.ts";
import { formatLap, currentLapTimeMs } from "../race/RaceState.ts";

/**
 * Canvas2D top-down renderer. Draws the world in world-space via the camera,
 * then overlays screen-space HUD text. Intentionally small and dependency-free;
 * it's the one Phase-1 class that may be swapped for PixiJS later.
 */
export class Canvas2DRenderer implements IRenderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("2D context unavailable");
    this.ctx = ctx;
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

    // Asphalt annulus = outer loop + inner loop, filled with even-odd.
    ctx.beginPath();
    this.tracePolygon(track.outer, cam, true);
    this.tracePolygon(track.inner, cam, true);
    ctx.fillStyle = surface;
    ctx.fill("evenodd");

    // Curb stripe along the outer wall (thick red base + dashed white).
    this.strokeCurb(track.outer, cam);

    // Curb stripe along the inner island.
    this.strokeCurb(track.inner, cam);

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

  private strokeCurb(pts: { x: number; y: number }[], cam: Camera): void {
    const { ctx } = this;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = 10;
    ctx.strokeStyle = "#b23a3a";
    this.tracePolygon(pts, cam, true);
    ctx.stroke();
    ctx.lineWidth = 5;
    ctx.setLineDash([18, 18]);
    ctx.lineDashOffset = 0;
    ctx.strokeStyle = "#f4f4f4";
    this.tracePolygon(pts, cam, true);
    ctx.stroke();
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
    for (const r of rivals) {
      const p = cam.toScreen({ x: r.position.x, y: r.position.y });
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(r.angle);
      ctx.fillStyle = "#4aa3ff";
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
    ctx.fillStyle = "#e33b3b";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    this.roundRect(-l / 2, -w / 2, l, w, 3 * cam.zoom);
    ctx.fill();
    ctx.stroke();
    // nose marker (fore)
    ctx.fillStyle = "#ffe9a8";
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
  ): void {
    const { ctx } = this;
    ctx.save();
    ctx.font = "16px system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, w, 42);
    ctx.fillStyle = "#fff";

    const kmh = Math.round(Math.abs(speed) * 0.6);
    const laps = `${race.lap}/${track.laps}`;
    const cur = currentLapTimeMs(race, nowMs);
    const best =
      race.bestLapMs === Infinity ? "--:--.---" : formatLap(race.bestLapMs);
    const last = race.lastLapMs === 0 ? "--:--.---" : formatLap(race.lastLapMs);

    ctx.fillText(`LAP ${laps}`, 12, 10);
    ctx.fillText(`BEST ${best}`, 130, 10);
    ctx.fillText(`LAST ${last}`, 300, 10);
    ctx.fillText(`NOW ${formatLap(cur)}`, 460, 10);
    if (position !== undefined && total !== undefined) {
      ctx.fillText("P " + position + "/" + total, w - 150, 10);
    }
    if (fps !== undefined) {
      ctx.fillText(`FPS ${Math.round(fps)}`, w - 80, 30);
    }
    ctx.fillText(trackName, 12, 30);

    // speed bar, lower-right
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(w - 200, h - 52, 190, 42);
    ctx.fillStyle = "#fff";
    ctx.fillText(`SPD ${kmh} km/h`, w - 190, h - 40);

    // minimap top-right
    if (car) this.drawMinimap(ctx, track, car, w, h);

    ctx.restore();
  }

  private drawMinimap(
    ctx: CanvasRenderingContext2D,
    track: BuiltTrack,
    car: Matter.Body,
    w: number,
    h: number,
  ): void {
    const pad = 12;
    const mapW = 160;
    const mapH = 100;
    const mapX = w - mapW - pad;
    const mapY = pad;

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

    // player dot
    const px = offX + car.position.x * scale;
    const py = offY + car.position.y * scale;
    ctx.fillStyle = "#e33b3b";
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawConfetti(ctx: CanvasRenderingContext2D, w: number, h: number, ageMs: number): void {
    const duration = 1200;
    if (ageMs > duration) return;
    const t = ageMs / duration;
    ctx.save();
    ctx.globalAlpha = 1 - t;
    const count = 80;
    for (let i = 0; i < count; i++) {
      const x = w * 0.5 + (Math.random() - 0.5) * w * 0.8 * t;
      const y = h * 0.3 + Math.random() * h * 0.5 * t;
      const size = 4 + Math.random() * 4;
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
