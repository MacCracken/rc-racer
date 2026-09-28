import type Matter from "matter-js";
import type { Camera } from "./Camera.ts";
import type { CarControls, IRenderer, RenderScene } from "./types.ts";
import { CALLOUT_MS } from "../race/Callouts.ts";
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
import { formatLap, formatSplit, currentLapTimeMs } from "../race/RaceState.ts";
import {
  carPalette,
  hudScaleOf,
  shade,
  splitColors,
  type CarLook,
  type ColorMode,
  type HudSize,
} from "./theme.ts";
import {
  lampsFor,
  NIGHT_AMBIENT,
  paintAsphaltTile,
  paintDirtTile,
  paintGroundTile,
  paintLamp,
  paintLightMap,
  paintTrackArt,
  roadColor,
  sceneryFor,
} from "./trackArt.ts";
import { paintCar, traceCarShadow } from "./carArt.ts";
import {
  conditionsOf,
  conditionTags,
  type Conditions,
} from "../track/conditions.ts";

/** World px of margin around the track art for scenery + shadows. */
const ART_MARGIN = 220;
/**
 * Cap on the cached track art's size, in canvas pixels (~64 MB RGBA): just
 * under Safari's 16.7M-pixel limit on a single canvas. Only a close camera on
 * a high-density screen asks for this much.
 */
const ART_MAX_PIXELS = 16_000_000;
/** Most canvas pixels per world px the art is ever painted at. */
const ART_MAX_SCALE = 3;
/** Ground texture tile size (world px). */
const GROUND_TILE = 256;
/** A night light map's resolution, relative to the art (light is soft). */
const LIGHT_MAP_SCALE = 0.25;
/** How far (world px) a headlight beam reaches, and its half-angle. */
const BEAM_REACH = 150;
const BEAM_SPREAD = 0.42;

const TAU = Math.PI * 2;
const IDLE: CarControls = { steer: 0, braking: false };

/** A steady 0..1 random per (index, channel): a cheap hash, no state. */
function hash01(i: number, k: number): number {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

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
  /** Ground texture tiles by background colour (+ night), shared by the art. */
  private groundTiles = new Map<string, HTMLCanvasElement>();
  private ground: { key: string; pattern: CanvasPattern } | null = null;
  /** The vignette, pre-shaded once per canvas size (see `drawVignette`). */
  private vignette: { canvas: HTMLCanvasElement; strength: number } | null =
    null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    // Opaque: every frame paints every pixel, so the browser needn't blend
    // the canvas with the page behind it.
    const ctx = canvas.getContext("2d", { alpha: false });
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
      rivals,
      skidMarks,
      ghost,
      confettiAgeMs,
      hud = true,
      look = "sedan",
      rivalLook = look,
      controls = IDLE,
      rivalControls = [],
      ghostCar,
      startClockMs,
      timeMs = 0,
    } = scene;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const cond = conditionsOf(track.def);
    const night = cond.lighting === "night";
    const bodies = [car, ...(rivals ?? [])];

    const art = this.trackArt(track, camera, scene.artZoom ?? CAMERA_ZOOM_SLOW);
    this.drawGround(track, camera, w, h, art);
    this.drawTrackArt(art, camera);
    this.drawSkidMarks(skidMarks, camera, cond);
    this.drawGhost(ghost, camera);
    if (ghostCar !== undefined) this.drawGhostCar(ghostCar, look, camera);
    if (hud) this.drawNextGate(track, camera, race);
    // Light and water go down on the road, under the cars.
    if (night)
      this.drawHeadlights(bodies, [controls, ...rivalControls], camera);
    if (cond.weather === "rain") this.drawSpray(bodies, camera);
    this.drawCars(
      car,
      rivals ?? [],
      look,
      rivalLook,
      controls,
      rivalControls,
      camera,
      night,
    );
    if (cond.weather === "rain") this.drawRain(w, h, timeMs);
    this.drawVignette(w, h, night ? 0.62 : 0.4);
    if (hud) this.drawHUD(scene, w, h);
    if (scene.callout !== undefined) this.drawCallout(w, h, scene.callout);
    if (scene.wrongWay) this.drawWrongWay(w, h, timeMs);
    if (confettiAgeMs !== undefined && confettiAgeMs >= 0) {
      this.drawConfetti(this.ctx, w, h, confettiAgeMs);
    }
    if (startClockMs !== undefined) this.drawStartLights(w, h, startClockMs);
    if (scene.replay !== undefined) this.drawReplayBadge(w, scene.replay);
  }

  // --- world-space rendering ---

  private makeCanvas(w: number, h: number): HTMLCanvasElement {
    const c = this.canvas.ownerDocument.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  /**
   * The ground's texture tile for a background colour (cached). At night it
   * is darkened by the same moonlight as the track art, so the two meet
   * without a seam; the art itself is painted by day and darkened whole.
   */
  private groundTileFor(
    color: string,
    night: boolean,
  ): HTMLCanvasElement | null {
    const key = `${color}|${night}`;
    let tile = this.groundTiles.get(key);
    if (tile === undefined) {
      tile = this.makeCanvas(GROUND_TILE, GROUND_TILE);
      const g = tile.getContext("2d");
      if (g === null) return null;
      paintGroundTile(g, GROUND_TILE, color);
      if (night) {
        g.globalCompositeOperation = "multiply";
        g.fillStyle = NIGHT_AMBIENT;
        g.fillRect(0, 0, GROUND_TILE, GROUND_TILE);
      }
      this.groundTiles.set(key, tile);
    }
    return tile;
  }

  /**
   * Textured ground, locked to world space so it scrolls with the track. The
   * track art has this same ground baked in (see `paintArt`), so only the
   * screen outside the art's rectangle is filled here — usually none of it.
   * A full-screen pattern fill every frame was the costliest pass of all
   * when the browser rasterizes in software.
   */
  private drawGround(
    track: BuiltTrack,
    cam: Camera,
    w: number,
    h: number,
    art: TrackArt | null,
  ): void {
    const { ctx } = this;
    const color = track.def.background ?? "#0d1f14";
    const night = conditionsOf(track.def).lighting === "night";
    const key = `${color}|${night}`;
    if (this.ground?.key !== key) {
      const tile = this.groundTileFor(color, night);
      const pattern = tile === null ? null : ctx.createPattern(tile, "repeat");
      this.ground = pattern === null ? null : { key, pattern };
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
    const tl = art === null ? null : cam.toScreen({ x: art.x, y: art.y });
    if (art === null || tl === null) {
      ctx.fillRect(0, 0, w, h);
      return;
    }
    const aw = (art.canvas.width / art.scale) * cam.zoom;
    const ah = (art.canvas.height / art.scale) * cam.zoom;
    if (tl.x >= w || tl.y >= h || tl.x + aw <= 0 || tl.y + ah <= 0) {
      ctx.fillRect(0, 0, w, h);
      return;
    }
    // The bands around the art, reaching 1px under its edge so no hairline
    // can open up at the seam (the art is drawn over the overlap).
    const x0 = Math.max(0, Math.min(w, tl.x + 1));
    const y0 = Math.max(0, Math.min(h, tl.y + 1));
    const x1 = Math.max(0, Math.min(w, tl.x + aw - 1));
    const y1 = Math.max(0, Math.min(h, tl.y + ah - 1));
    if (y0 > 0) ctx.fillRect(0, 0, w, y0);
    if (y1 < h) ctx.fillRect(0, y1, w, h - y1);
    if (x0 > 0) ctx.fillRect(0, y0, x0, y1 - y0);
    if (x1 < w) ctx.fillRect(x1, y0, w - x1, y1 - y0);
  }

  /**
   * The pre-painted track (ground included). It is painted once per track,
   * at about one canvas pixel per device pixel for the *closest* zoom the
   * camera reaches (`closest`), so the per-frame speed zoom never triggers a
   * repaint. It only repaints for a new track or when it needs more
   * resolution (e.g. a sharper screen).
   */
  private trackArt(
    track: BuiltTrack,
    cam: Camera,
    closest: number,
  ): TrackArt | null {
    const b = track.bounds;
    const worldW = b.maxX - b.minX + ART_MARGIN * 2;
    const worldH = b.maxY - b.minY + ART_MARGIN * 2;
    const cap = Math.min(
      ART_MAX_SCALE,
      Math.sqrt(ART_MAX_PIXELS / (worldW * worldH)),
    );
    const want = Math.min(
      cap,
      Math.max(0.5, Math.max(cam.zoom, closest) * this.dpr),
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
    return this.art;
  }

  /** Blit the track art into place for this camera. */
  private drawTrackArt(art: TrackArt | null, cam: Camera): void {
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
    const g = canvas.getContext("2d", { alpha: false });
    if (g === null) return null;
    const cond = conditionsOf(track.def);
    const tile = this.makeCanvas(96, 96);
    const tg = tile.getContext("2d");
    const surface = roadColor(track.def);
    if (tg !== null)
      (cond.terrain === "dirt" ? paintDirtTile : paintAsphaltTile)(
        tg,
        96,
        surface,
      );
    const road = (tg && g.createPattern(tile, "repeat")) ?? surface;
    g.setTransform(scale, 0, 0, scale, -x * scale, -y * scale);
    // The ground first, anchored to the world like the live ground, so the
    // two meet seamlessly at the art's edge. Over-filled a little: the canvas
    // size was rounded up, and an unpainted opaque pixel is black.
    const color = track.def.background ?? "#0d1f14";
    const groundTile = this.groundTileFor(color, false);
    g.fillStyle =
      (groundTile && g.createPattern(groundTile, "repeat")) ?? color;
    g.fillRect(x, y, worldW + 2, worldH + 2);
    paintTrackArt(g, track, road, sceneryFor(track));
    if (cond.lighting === "night")
      this.paintNight(g, track, { x, y, w: worldW + 2, h: worldH + 2 }, scale);
    return { id, canvas, x, y, scale };
  }

  /**
   * Nightfall over freshly painted art: multiply it by a light map (moonlight,
   * plus a warm pool under each trackside lamp) so lit ground keeps its own
   * colour, then draw the lamps themselves at full brightness. The light map
   * is low-res — it's all soft gradients — to keep the paint cheap.
   */
  private paintNight(
    g: CanvasRenderingContext2D,
    track: BuiltTrack,
    rect: { x: number; y: number; w: number; h: number },
    scale: number,
  ): void {
    const lamps = lampsFor(track);
    const ls = scale * LIGHT_MAP_SCALE;
    const light = this.makeCanvas(
      Math.max(1, Math.ceil(rect.w * ls)),
      Math.max(1, Math.ceil(rect.h * ls)),
    );
    const lg = light.getContext("2d");
    if (lg === null) return;
    lg.setTransform(ls, 0, 0, ls, -rect.x * ls, -rect.y * ls);
    paintLightMap(lg, lamps);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "multiply";
    // Scaled back up exactly, so each light texel lands where it was lit.
    g.drawImage(
      light,
      0,
      0,
      light.width / LIGHT_MAP_SCALE,
      light.height / LIGHT_MAP_SCALE,
    );
    g.restore();
    for (const p of lamps) paintLamp(g, p);
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

  /** The chased lap's car: a pale, see-through copy of the player's car. */
  private drawGhostCar(
    g: { x: number; y: number; heading: number; alpha: number },
    look: CarLook,
    cam: Camera,
  ): void {
    if (g.alpha <= 0) return;
    const { ctx } = this;
    const p = cam.toScreen(g);
    ctx.save();
    ctx.globalAlpha = 0.55 * g.alpha;
    ctx.translate(p.x, p.y);
    ctx.rotate(g.heading);
    ctx.scale(cam.zoom, cam.zoom);
    paintCar(ctx, look, {
      body: "#dff4ff",
      accent: "#7fd3ff",
      steer: 0,
      braking: false,
    });
    ctx.restore();
  }

  /**
   * Draw the skid trail on the road, under the cars. Each mark is a short
   * segment oriented with the car's heading, fading with its alpha, with a
   * puff over fresh ones: tyre smoke on tarmac, a cloud of dust on dirt, and
   * spray (over fainter marks) on a wet road.
   */
  private drawSkidMarks(
    marks: SkidMark[] | undefined,
    cam: Camera,
    cond: Conditions,
  ): void {
    if (marks === undefined || marks.length === 0) return;
    const { ctx } = this;
    const dirt = cond.terrain === "dirt";
    const wet = cond.weather === "rain";
    const mark = dirt ? "#2b1d0e" : "#0a0a0a";
    const markAlpha = wet ? 0.2 : dirt ? 0.3 : 0.35;
    const puff = dirt ? "#b99c70" : wet ? "#c9d9e8" : "#222";
    const puffAlpha = dirt ? 0.2 : wet ? 0.14 : 0.12;
    const puffSize = dirt ? 1.6 : 1;
    const len = CAR_LENGTH * 0.55 * cam.zoom;
    const width = Math.max(2, CAR_WIDTH * 0.32 * cam.zoom);
    ctx.save();
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.strokeStyle = mark;
    ctx.fillStyle = puff;
    for (const m of marks) {
      const p = cam.toScreen({ x: m.x, y: m.y });
      const dx = Math.cos(m.angle) * (len / 2);
      const dy = Math.sin(m.angle) * (len / 2);
      ctx.globalAlpha = m.alpha * markAlpha;
      ctx.beginPath();
      ctx.moveTo(p.x - dx, p.y - dy);
      ctx.lineTo(p.x + dx, p.y + dy);
      ctx.stroke();

      if (m.alpha > 0.5) {
        ctx.globalAlpha = m.alpha * puffAlpha;
        ctx.beginPath();
        ctx.ellipse(
          p.x,
          p.y,
          width * 2 * puffSize,
          width * puffSize,
          0,
          0,
          TAU,
        );
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /**
   * Headlight beams ahead of every car on a night track, laid on the road
   * (under the bodies) with additive light, and a red glow behind each car —
   * brighter under braking.
   */
  private drawHeadlights(
    bodies: Matter.Body[],
    controls: CarControls[],
    cam: Camera,
  ): void {
    const { ctx } = this;
    const nose = CAR_LENGTH / 2 - 2;
    const tail = -CAR_LENGTH / 2;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    bodies.forEach((b, i) => {
      const p = cam.toScreen(b.position);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(b.angle);
      ctx.scale(cam.zoom, cam.zoom);
      const beam = ctx.createRadialGradient(nose, 0, 4, nose, 0, BEAM_REACH);
      beam.addColorStop(0, "rgba(255,246,214,0.3)");
      beam.addColorStop(0.5, "rgba(255,240,200,0.1)");
      beam.addColorStop(1, "rgba(255,236,190,0)");
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(nose, -CAR_WIDTH * 0.3);
      ctx.arc(nose, 0, BEAM_REACH, -BEAM_SPREAD, BEAM_SPREAD);
      ctx.lineTo(nose, CAR_WIDTH * 0.3);
      ctx.closePath();
      ctx.fill();
      const braking = controls[i]?.braking ?? false;
      const glow = ctx.createRadialGradient(tail, 0, 0, tail, 0, 20);
      glow.addColorStop(0, `rgba(255,40,20,${braking ? 0.55 : 0.25})`);
      glow.addColorStop(1, "rgba(255,40,20,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(tail - 20, -20, 40, 40);
      ctx.restore();
    });
    ctx.restore();
  }

  /** Spray thrown up behind every car on a wet track, growing with speed. */
  private drawSpray(bodies: Matter.Body[], cam: Camera): void {
    const { ctx } = this;
    ctx.save();
    for (const b of bodies) {
      const f = Math.min(1, Math.hypot(b.velocity.x, b.velocity.y) / 220);
      if (f < 0.15) continue;
      const p = cam.toScreen(b.position);
      ctx.save();
      ctx.translate(p.x, p.y);
      // Spray trails the way the car is travelling, even mid-slide.
      ctx.rotate(Math.atan2(b.velocity.y, b.velocity.x));
      ctx.scale(cam.zoom, cam.zoom);
      const len = 16 + 34 * f;
      for (const side of [-1, 1]) {
        const cx = -CAR_LENGTH / 2 - len / 2;
        const cy = side * CAR_WIDTH * 0.32;
        const mist = ctx.createRadialGradient(cx, cy, 0, cx, cy, len / 2);
        mist.addColorStop(0, `rgba(215,228,240,${0.32 * f})`);
        mist.addColorStop(1, "rgba(215,228,240,0)");
        ctx.fillStyle = mist;
        ctx.beginPath();
        ctx.ellipse(cx, cy, len / 2, 4 + 5 * f, 0, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * Rain over the whole screen: streaks falling on their own steady loops,
   * and short-lived splash rings that pop up somewhere new each cycle. `t` is
   * wall-clock ms, so it keeps falling on the menus and while paused.
   */
  private drawRain(w: number, h: number, t: number): void {
    const { ctx } = this;
    const count = Math.round(Math.min(260, (w * h) / 7000));
    ctx.save();
    ctx.strokeStyle = "rgba(200,218,240,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const f = ((t / 700) * (0.7 + 0.5 * hash01(i, 3)) + hash01(i, 2)) % 1;
      const x = hash01(i, 1) * (w + 60) - 30 + f * 40;
      const y = f * (h + 60) - 30;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 4, y - 14);
    }
    ctx.stroke();
    ctx.strokeStyle = "rgba(200,218,240,0.35)";
    for (let j = 0; j < count / 5; j++) {
      const life = t / 450 + hash01(j, 7);
      const cycle = Math.floor(life);
      const age = life - cycle;
      const k = j + cycle * 131;
      ctx.globalAlpha = 1 - age;
      ctx.beginPath();
      ctx.ellipse(
        hash01(k, 8) * w,
        hash01(k, 9) * h,
        1 + age * 5,
        0.6 + age * 3,
        0,
        0,
        TAU,
      );
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

  /**
   * Shadows first (so no car's shadow lands on another), then bodies. At
   * night the paint is dimmed to sit in the dark; headlights mark each car.
   */
  private drawCars(
    player: Matter.Body,
    rivals: Matter.Body[],
    look: CarLook,
    rivalLook: CarLook,
    controls: CarControls,
    rivalControls: CarControls[],
    cam: Camera,
    night: boolean,
  ): void {
    const { ctx } = this;
    const day = carPalette(this.colorMode);
    const pal = night
      ? {
          player: shade(day.player, -0.3),
          nose: shade(day.nose, -0.3),
          rival: shade(day.rival, -0.35),
        }
      : day;
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

  /**
   * Darken the screen edges a touch, pulling the eye to the action. Shading
   * a radial gradient across the screen every frame was a costly pass on a
   * software-rasterized canvas; it's shaded once per canvas size into an
   * offscreen canvas at device resolution and blitted 1:1.
   */
  private drawVignette(w: number, h: number, strength: number): void {
    const { width, height } = this.canvas;
    // A 0-px canvas (a hidden or minimised embed) has nothing to darken, and
    // drawImage throws on a 0-px source, which would stop the frame loop.
    if (width === 0 || height === 0) return;
    let v = this.vignette;
    if (
      v === null ||
      v.canvas.width !== width ||
      v.canvas.height !== height ||
      v.strength !== strength
    ) {
      const canvas = this.makeCanvas(width, height);
      const g = canvas.getContext("2d");
      if (g === null) return;
      const fill = g.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.35,
        width / 2,
        height / 2,
        Math.hypot(width, height) * 0.62,
      );
      fill.addColorStop(0, "rgba(0,0,0,0)");
      fill.addColorStop(1, `rgba(0,0,0,${strength})`);
      g.fillStyle = fill;
      g.fillRect(0, 0, width, height);
      v = { canvas, strength };
      this.vignette = v;
    }
    this.ctx.drawImage(v.canvas, 0, 0, w, h);
  }

  // --- screen-space HUD ---

  private drawHUD(scene: RenderScene, w: number, h: number): void {
    const { race, track, speed, nowMs, position, total, car, fps, rivals } =
      scene;
    const { ctx } = this;
    const pad = 12;
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
    let cols: [text: string, widest: string][] = [
      [`LAP ${laps}`, "LAP 00/00"],
      [`BEST ${best}`, "BEST 00:00.000"],
      [`LAST ${last}`, "LAST 00:00.000"],
      [`NOW ${formatLap(cur)}`, "NOW 00:00.000"],
    ];
    // A narrow screen (a phone) drops LAST, then shrinks the HUD until the
    // columns and the position readout fit across it.
    ctx.save();
    ctx.font = "16px system-ui, sans-serif";
    const widthAt1 = (cs: typeof cols): number =>
      cs.reduce(
        (sum, [, widest]) => sum + ctx.measureText(widest).width + 24,
        0,
      ) + 90; // "P 4/4" on the right
    let fit = (w - 2 * pad) / widthAt1(cols);
    if (fit < 0.8) {
      cols = cols.filter((_, i) => i !== 2);
      fit = (w - 2 * pad) / widthAt1(cols);
    }
    const s = Math.max(0.55, Math.min(this.hudScale, fit));
    const barH = 48 * s;
    const row1 = 8 * s;
    const row2 = 28 * s;
    const font = `${16 * s}px system-ui, sans-serif`;
    ctx.font = font;
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, w, barH);
    ctx.fillStyle = "#fff";

    let x = pad;
    let nowX = pad;
    for (const [text, widest] of cols) {
      nowX = x;
      ctx.fillText(text, x, row1);
      x += ctx.measureText(widest).width + 24 * s;
    }
    const tags = conditionTags(conditionsOf(track.def));
    ctx.fillText([track.def.name, ...tags].join(" · "), pad, row2);
    // Live split vs the ghost, under the lap timer it qualifies.
    if (scene.splitMs !== undefined) {
      const c = splitColors(this.colorMode);
      ctx.font = `bold ${16 * s}px system-ui, sans-serif`;
      ctx.fillStyle = scene.splitMs < 0 ? c.ahead : c.behind;
      ctx.fillText(formatSplit(scene.splitMs), nowX, row2);
      ctx.font = font;
      ctx.fillStyle = "#fff";
    }

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
    if (car)
      this.drawMinimap(
        ctx,
        track,
        car,
        w,
        barH + pad,
        s,
        rivals,
        scene.ghostCar,
      );

    ctx.restore();
  }

  private drawMinimap(
    ctx: CanvasRenderingContext2D,
    track: BuiltTrack,
    car: Matter.Body,
    w: number,
    top: number,
    hudScale: number,
    rivals?: Matter.Body[],
    ghost?: { x: number; y: number; alpha: number },
  ): void {
    const pad = 12;
    const mapW = Math.round(160 * hudScale);
    const mapH = Math.round(100 * hudScale);
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
    ctx.strokeStyle =
      conditionsOf(track.def).terrain === "dirt"
        ? "rgba(196,166,122,0.75)"
        : "rgba(170,182,192,0.75)";
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
    // The ghost: a hollow ring, so it never hides (or reads as) a car.
    if (ghost !== undefined && ghost.alpha > 0) {
      ctx.save();
      ctx.globalAlpha = ghost.alpha;
      ctx.strokeStyle = "#dff4ff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(
        offX + ghost.x * scale,
        offY + ghost.y * scale,
        3.5,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      ctx.restore();
    }
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

  /**
   * Lap news across the upper middle of the screen: the title bursts in and
   * settles, the line under it gives the lap time, and the pair fades out
   * over the callout's last half second. Coloured by the news (a record,
   * a best, the final lap), which the words say too.
   */
  private drawCallout(
    w: number,
    h: number,
    c: NonNullable<RenderScene["callout"]>,
  ): void {
    const { ctx } = this;
    const s = this.hudScale;
    const t = c.ageMs;
    const fade = Math.min(1, t / 150, (CALLOUT_MS - t) / 500);
    if (fade <= 0) return;
    const pop = 1 + 0.3 * Math.pow(Math.max(0, 1 - t / 300), 3);
    const tone = splitColors(this.colorMode);
    const color = {
      record: "#ffe9a8",
      best: tone.ahead,
      final: "#ffcf7a",
      lap: "#ffffff",
    }[c.tone];
    const cx = w / 2;
    const cy = h * 0.3;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.font = `800 ${40 * s * pop}px system-ui, sans-serif`;
    ctx.lineWidth = 6 * s;
    ctx.strokeText(c.title, cx, cy);
    ctx.fillStyle = color;
    ctx.fillText(c.title, cx, cy);
    if (c.detail !== undefined) {
      ctx.font = `600 ${20 * s}px system-ui, sans-serif`;
      ctx.lineWidth = 4 * s;
      ctx.strokeText(c.detail, cx, cy + 36 * s);
      ctx.fillStyle = "#fff";
      ctx.fillText(c.detail, cx, cy + 36 * s);
    }
    ctx.restore();
  }

  /** "WRONG WAY", pulsing, above the middle of the screen. */
  private drawWrongWay(w: number, h: number, timeMs: number): void {
    const { ctx } = this;
    const s = this.hudScale;
    const cx = w / 2;
    const cy = h * 0.2;
    ctx.save();
    ctx.globalAlpha = 0.65 + 0.35 * Math.sin(timeMs / 110);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.font = `800 ${34 * s}px system-ui, sans-serif`;
    ctx.lineWidth = 6 * s;
    ctx.strokeStyle = "rgba(0,0,0,0.65)";
    ctx.strokeText("WRONG WAY", cx, cy);
    ctx.fillStyle = splitColors(this.colorMode).behind;
    ctx.fillText("WRONG WAY", cx, cy);
    ctx.font = `600 ${16 * s}px system-ui, sans-serif`;
    ctx.lineWidth = 4 * s;
    ctx.strokeText("Turn around", cx, cy + 28 * s);
    ctx.fillStyle = "#fff";
    ctx.fillText("Turn around", cx, cy + 28 * s);
    ctx.restore();
  }

  /**
   * A replay's badge, top-centre: a blinking red dot, REPLAY, how far in of
   * how long, and the speed when it isn't 1×.
   */
  private drawReplayBadge(
    w: number,
    r: { ms: number; totalMs: number; speed: number },
  ): void {
    const { ctx } = this;
    const s = this.hudScale;
    const text = `REPLAY  ${formatLap(r.ms)} / ${formatLap(r.totalMs)}${r.speed !== 1 ? `  ${r.speed}×` : ""}`;
    ctx.save();
    ctx.font = `bold ${15 * s}px system-ui, sans-serif`;
    const tw = ctx.measureText(text).width;
    const bw = tw + 44 * s;
    const bh = 32 * s;
    const x = w / 2 - bw / 2;
    const y = 12 * s;
    ctx.fillStyle = "rgba(8,14,11,0.78)";
    ctx.beginPath();
    if (typeof ctx.roundRect === "function")
      ctx.roundRect(x, y, bw, bh, bh / 2);
    else ctx.rect(x, y, bw, bh);
    ctx.fill();
    // The dot blinks with the replay clock, so it stops when held.
    if (Math.floor(r.ms / 500) % 2 === 0 || r.ms >= r.totalMs) {
      ctx.fillStyle = "#ff3b30";
      ctx.beginPath();
      ctx.arc(x + 18 * s, y + bh / 2, 5 * s, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 32 * s, y + bh / 2 + 1);
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
