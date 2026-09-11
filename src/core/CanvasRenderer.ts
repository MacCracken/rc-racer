import type { IRenderer } from "./types.ts";
import type { RenderScene } from "./types.ts";
import type { Vehicle } from "./Vehicle.ts";
import type { Camera } from "./Camera.ts";

/**
 * Minimal Canvas2D renderer: a tiled grass background, an asphalt grid, and
 * the car. This is intentionally tiny — Phase 0 exit = "a box moves." It
 * already implements the IRenderer seam so Phase 1 can grow it or swap it for
 * PixiJS without touching physics/loop.
 */
export class Canvas2DRenderer implements IRenderer {
  private ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      throw new Error("2D canvas context unavailable");
    }
    this.ctx = ctx;
  }

  resize(
    width: number,
    height: number,
    dpr = window.devicePixelRatio || 1,
  ): void {
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  render(scene: RenderScene, alpha: number): void {
    const cam: Camera = scene.camera;
    const car: Vehicle = scene.car;
    const { width, height } = this.cssSize(cam);

    this.drawGround(cam, width, height);
    this.drawCar(car, cam, alpha);
    this.drawHUD(car, width, height);
    this.drawGrid(cam, width, height);
  }

  private cssSize(cam: Camera): { width: number; height: number } {
    return {
      width: cam.width,
      height: cam.height,
    };
  }

  private drawGround(cam: Camera, w: number, h: number): void {
    const { ctx } = this;
    ctx.fillStyle = "#10251a";
    ctx.fillRect(0, 0, w, h);
  }

  private drawGrid(cam: Camera, w: number, h: number): void {
    const { ctx } = this;
    const step = 100 * cam.zoom;
    const offX = (((-cam.view.x * cam.zoom + w / 2) % step) + step) % step;
    const offY = (((-cam.view.y * cam.zoom + h / 2) % step) + step) % step;
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = offX; x < w; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = offY; y < h; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
  }

  private drawCar(car: Vehicle, cam: Camera, alpha: number): void {
    const { pos, heading } = car.interpolated(alpha);
    const p = cam.toScreen(pos);
    const { ctx } = this;
    const w = 26 * cam.zoom;
    const l = 44 * cam.zoom;
    ctx.save();
    ctx.translate(p.x, p.y);
    // heading 0 = up; canvas 0 = +x. Rotate by heading + pi/2.
    ctx.rotate(heading);
    ctx.fillStyle = "#e53935";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Nose points up (-Y) after rotation.
    ctx.roundRect(-w / 2, -l / 2, w, l, 4);
    ctx.fill();
    ctx.stroke();
    // Cabin / direction marker.
    ctx.fillStyle = "#1b3a1b";
    ctx.fillRect(-w / 4, -l / 4, w / 2, l / 5);
    ctx.restore();
  }

  private drawHUD(car: Vehicle, w: number, h: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, h - 40, w, 40);
    ctx.fillStyle = "#fff";
    ctx.font = "14px monospace";
    ctx.textBaseline = "middle";
    const kmh = Math.round(Math.abs(car.speed) * 0.6);
    ctx.fillText(`SPD ${kmh}`, 12, h - 20);
    ctx.fillText(
      `THR ${Math.round(car.stats.maxSpeed * 0.6)} max`,
      120,
      h - 20,
    );
    ctx.fillText(
      `H ${(car.heading * (180 / Math.PI)).toFixed(0)}°`,
      260,
      h - 20,
    );
    ctx.restore();
  }
}
