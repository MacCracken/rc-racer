import type Matter from "matter-js";
import type { Camera } from "./Camera.ts";
import type { CarControls, IRenderer, RenderScene } from "./types.ts";
import type { BuiltTrack } from "../track/Track.ts";
import type { RaceState } from "../race/RaceState.ts";
import type { SkidMark } from "./SkidMarks.ts";
import type { Ghost } from "../race/Ghost.ts";
import {
  CAMERA_ZOOM_SLOW,
  CAR_LENGTH,
  CAR_WIDTH,
  GO_FLASH_MS,
  KMH_PER_PX_S,
} from "./tuning.ts";
import { formatLap, currentLapTimeMs } from "../race/RaceState.ts";
import {
  carPalette,
  hudScaleOf,
  shade,
  type CarLook,
  type ColorMode,
  type HudSize,
} from "./theme.ts";
import {
  paintAsphaltTile,
  paintGroundTile,
  paintTrackArt,
  sceneryFor,
} from "./trackArt.ts";
import { paintCar, traceCarShadow } from "./carArt.ts";

/** World px of margin around the track art for scenery + shadows. */
const ART_MARGIN = 220;
/** Cap on the cached track art's size, in canvas pixels (~36 MB RGBA). */
const ART_MAX_PIXELS = 9_000_000;
/** Ground texture tile size (world px). */
const GROUND_TILE = 256;

const IDLE: CarControls = { steer: 0, braking: false };

/** The static track, pre-painted at a fixed world->pixel scale. */
interface TrackArt {
  /** Which track (id + width) it was painted for. */
  id: string;
  canvas: HTMLCanvasElement;
  /** World position of the canvas's top-left corner. */
  x: number;
  y: number;
  /** Canvas pixels per world px. */
  scale: number;
}

/**
 * Canvas2D top-down renderer. Draws the world in world-space via the camera,
 * then overlays screen-space HUD text. Everything static about a track (road,
 * curbs, grid, scenery) is painted once into an offscreen canvas and blitted
 * each frame, so it can be detailed without costing frame time; the cars are
 * vectors, crisp at any zoom.
 */
export class Canvas2DRenderer implements IRenderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  /** Presentation theme, driven by the persisted Settings. */
  private colorMode: ColorMode = "std";
  private hudScale = 1;
  private art: TrackArt | null = null;
  private ground: { color: string; pattern: CanvasPattern } | null = null;
  private vignette: { w: number; h: number; fill: CanvasGradient } | null =
    null;

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
      look = "sedan",
      rivalLook = look,
      controls = IDLE,
      rivalControls = [],
      startClockMs,
    } = scene;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.drawGround(track, camera, w, h);
    this.drawTrackArt(track, camera);
    this.drawSkidMarks(skidMarks, camera);
    this.drawGhost(ghost, camera);
    if (hud) this.drawNextGate(track, camera, race);
    this.drawCars(
      car,
      rivals ?? [],
      look,
      rivalLook,
      controls,
      rivalControls,
      camera,
    );
    this.drawVignette(w, h);
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
    if (startClockMs !== undefined) this.drawStartLights(w, h, startClockMs);
  }

  // --- world-space rendering ---

  private makeCanvas(w: number, h: number): HTMLCanvasElement {
    const c = this.canvas.ownerDocument.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  /** Textured ground, locked to world space so it scrolls with the track. */
  private drawGround(
    track: BuiltTrack,
    cam: Camera,
    w: number,
    h: number,
  ): void {
    const { ctx } = this;
    const color = track.def.background ?? "#0d1f14";
    if (this.ground?.color !== color) {
      const tile = this.makeCanvas(GROUND_TILE, GROUND_TILE);
      const g = tile.getContext("2d");
      if (g !== null) paintGroundTile(g, GROUND_TILE, color);
      const pattern = g === null ? null : ctx.createPattern(tile, "repeat");
      this.ground = pattern === null ? null : { color, pattern };
    }
    if (this.ground === null) {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, w, h);
      return;
    }
    const z = cam.zoom;
    this.ground.pattern.setTransform(
      new DOMMatrix([
        z,
        0,
        0,
        z,
        w / 2 - cam.view.x * z,
        h / 2 - cam.view.y * z,
      ]),
    );
    ctx.fillStyle = this.ground.pattern;
    ctx.fillRect(0, 0, w, h);
  }

  /**
   * Blit the pre-painted track. It is painted once per track, at about one
   * canvas pixel per device pixel for the *closest* zoom the camera reaches,
   * so the per-frame speed zoom never triggers a repaint. It only repaints
   * for a new track or when it needs more resolution (e.g. a sharper screen).
   */
  private drawTrackArt(track: BuiltTrack, cam: Camera): void {
    const b = track.bounds;
    const worldW = b.maxX - b.minX + ART_MARGIN * 2;
    const worldH = b.maxY - b.minY + ART_MARGIN * 2;
    const cap = Math.min(1.5, Math.sqrt(ART_MAX_PIXELS / (worldW * worldH)));
    const want = Math.min(
      cap,
      Math.max(0.5, Math.max(cam.zoom, CAMERA_ZOOM_SLOW) * this.dpr),
    );
    const id = `${track.def.id}|${track.width}`;
    if (
      this.art === null ||
      this.art.id !== id ||
      this.art.scale < want * 0.97
    ) {
      const scale = Math.min(cap, Math.ceil(want * 4) / 4);
      this.art = this.paintArt(track, id, scale, worldW, worldH);
    }
    const art = this.art;
    if (art === null) return;
    const p = cam.toScreen({ x: art.x, y: art.y });
    this.ctx.drawImage(
      art.canvas,
      p.x,
      p.y,
      (art.canvas.width / art.scale) * cam.zoom,
      (art.canvas.height / art.scale) * cam.zoom,
    );
  }

  private paintArt(
    track: BuiltTrack,
    id: string,
    scale: number,
    worldW: number,
    worldH: number,
  ): TrackArt | null {
    const x = track.bounds.minX - ART_MARGIN;
    const y = track.bounds.minY - ART_MARGIN;
    const canvas = this.makeCanvas(
      Math.ceil(worldW * scale),
      Math.ceil(worldH * scale),
    );
    const g = canvas.getContext("2d");
    if (g === null) return null;
    const tile = this.makeCanvas(96, 96);
    const tg = tile.getContext("2d");
    const surface = track.def.surface ?? "#39404a";
    if (tg !== null) paintAsphaltTile(tg, 96, surface);
    const asphalt = (tg && g.createPattern(tile, "repeat")) ?? surface;
    g.setTransform(scale, 0, 0, scale, -x * scale, -y * scale);
    paintTrackArt(g, track, asphalt, sceneryFor(track));
    return { id, canvas, x, y, scale };
  }

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

  /**
   * Draw the skid trail on the asphalt, under the cars. Each mark is a short
   * dark segment oriented with the car's heading, fading with its alpha.
   */
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

  /** Shadows first (so no car's shadow lands on another), then bodies. */
  private drawCars(
    player: Matter.Body,
    rivals: Matter.Body[],
    look: CarLook,
    rivalLook: CarLook,
    controls: CarControls,
    rivalControls: CarControls[],
    cam: Camera,
  ): void {
    const { ctx } = this;
    const pal = carPalette(this.colorMode);
    const all: [Matter.Body, CarLook][] = [
      ...rivals.map((b): [Matter.Body, CarLook] => [b, rivalLook]),
      [player, look],
    ];
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    for (const [b, bodyLook] of all) {
      const p = cam.toScreen(b.position);
      ctx.save();
      // Offset in screen space: the light doesn't turn with the car.
      ctx.translate(p.x + 3 * cam.zoom, p.y + 4.5 * cam.zoom);
      ctx.rotate(b.angle);
      ctx.scale(cam.zoom, cam.zoom);
      traceCarShadow(ctx, bodyLook);
      ctx.fill();
      ctx.restore();
    }
    // Rivals get their own pale trim, not the player's accent.
    const rivalTrim = shade(pal.rival, 0.6);
    rivals.forEach((b, i) =>
      this.drawCarBody(
        b,
        rivalLook,
        pal.rival,
        rivalTrim,
        rivalControls[i] ?? IDLE,
        cam,
      ),
    );
    this.drawCarBody(player, look, pal.player, pal.nose, controls, cam);
    ctx.restore();
  }

  private drawCarBody(
    b: Matter.Body,
    look: CarLook,
    body: string,
    accent: string,
    c: CarControls,
    cam: Camera,
  ): void {
    const { ctx } = this;
    const p = cam.toScreen(b.position);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(b.angle); // Matter.js angle: 0 = facing +x, which is forward.
    ctx.scale(cam.zoom, cam.zoom);
    paintCar(ctx, look, { body, accent, steer: c.steer, braking: c.braking });
    ctx.restore();
  }

  /** Darken the screen edges a touch, pulling the eye to the action. */
  private drawVignette(w: number, h: number): void {
    const { ctx } = this;
    if (this.vignette?.w !== w || this.vignette.h !== h) {
      const fill = ctx.createRadialGradient(
        w / 2,
        h / 2,
        Math.min(w, h) * 0.35,
        w / 2,
        h / 2,
        Math.hypot(w, h) * 0.62,
      );
      fill.addColorStop(0, "rgba(0,0,0,0)");
      fill.addColorStop(1, "rgba(0,0,0,0.4)");
      this.vignette = { w, h, fill };
    }
    ctx.fillStyle = this.vignette.fill;
    ctx.fillRect(0, 0, w, h);
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

    const kmh = Math.round(Math.abs(speed) * KMH_PER_PX_S);
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

    // fit the road (centerline +/- half width) into the box
    const half = track.width / 2;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const p of track.centerLine) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const rangeX = Math.max(1, maxX - minX + 2 * half);
    const rangeY = Math.max(1, maxY - minY + 2 * half);
    const scale = Math.min(mapW / rangeX, mapH / rangeY) * 0.92;
    const offX = mapX + (mapW - rangeX * scale) / 2 - (minX - half) * scale;
    const offY = mapY + (mapH - rangeY * scale) / 2 - (minY - half) * scale;

    // The road as a band, like the track itself: dark edge, light surface.
    ctx.save();
    ctx.lineJoin = "round";
    ctx.beginPath();
    track.centerLine.forEach((p, i) => {
      const x = offX + p.x * scale;
      const y = offY + p.y * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    const road = Math.max(3, track.width * scale);
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = road + 2;
    ctx.stroke();
    ctx.strokeStyle = "rgba(170,182,192,0.75)";
    ctx.lineWidth = road;
    ctx.stroke();
    ctx.restore();

    // start/finish tick
    const s0 = track.start.pos;
    const nx = -Math.sin(track.start.heading) * (road / 2 + 1);
    const ny = Math.cos(track.start.heading) * (road / 2 + 1);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(offX + s0.x * scale - nx, offY + s0.y * scale - ny);
    ctx.lineTo(offX + s0.x * scale + nx, offY + s0.y * scale + ny);
    ctx.stroke();

    // Car dots in the same (colour-blind aware) palette as the cars on track.
    const pal = carPalette(this.colorMode);
    const dot = (b: Matter.Body, color: string, r: number): void => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(
        offX + b.position.x * scale,
        offY + b.position.y * scale,
        r,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.stroke();
    };
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    for (const r of rivals ?? []) dot(r, pal.rival, 2.5);
    dot(car, pal.player, 3.5);
  }

  /**
   * Start lights over the grid: three red lamps light one per second of the
   * countdown under a big numeral, then all go green with a "GO!" that fades.
   * `t` is ms relative to GO (negative while counting down).
   */
  private drawStartLights(w: number, h: number, t: number): void {
    if (t >= GO_FLASH_MS) return;
    const { ctx } = this;
    const s = this.hudScale;
    const go = t >= 0;
    const n = go ? 0 : Math.ceil(-t / 1000); // 3, 2, 1
    // 0..1 through the current second (or through the GO flash).
    const e = go ? t / GO_FLASH_MS : (n * 1000 + t) / 1000;
    const lit = go ? 3 : 4 - n;
    const cx = w / 2;
    const cy = h * 0.28;
    const r = 13 * s;
    const gap = 38 * s;
    ctx.save();
    ctx.globalAlpha = go ? Math.min(1, (GO_FLASH_MS - t) / 300) : 1;

    ctx.fillStyle = "rgba(10,12,14,0.85)";
    ctx.beginPath();
    const pw = gap * 2 + r * 2 + 20 * s;
    const ph = r * 2 + 16 * s;
    if (typeof ctx.roundRect === "function")
      ctx.roundRect(cx - pw / 2, cy - ph / 2, pw, ph, 10 * s);
    else ctx.rect(cx - pw / 2, cy - ph / 2, pw, ph);
    ctx.fill();
    for (let i = 0; i < 3; i++) {
      const on = i < lit;
      const color = go ? "#3dff7a" : on ? "#ff3b30" : "#3a1512";
      ctx.shadowColor = color;
      ctx.shadowBlur = on ? 18 * s : 0;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx + (i - 1) * gap, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    // The numeral bursts in big and settles each second.
    const text = go ? "GO!" : String(n);
    const size = 72 * s * (1 + 0.5 * Math.pow(1 - e, 3));
    const ty = cy + ph / 2 + 52 * s;
    ctx.font = `800 ${size}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 8 * s;
    ctx.strokeStyle = "rgba(0,0,0,0.65)";
    ctx.strokeText(text, cx, ty);
    ctx.fillStyle = go ? "#7dff9b" : "#ffe9a8";
    ctx.fillText(text, cx, ty);
    ctx.restore();
  }

  private drawConfetti(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    ageMs: number,
  ): void {
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
}
