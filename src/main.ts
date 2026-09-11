import "./style.css";
import { FIXED_DT } from "./core/tuning.ts";
import { FixedTimestepLoop } from "./core/FixedTimestepLoop.ts";
import { KeyboardInput } from "./core/Input.ts";
import { Camera } from "./core/Camera.ts";
import { Vehicle, defaultCarStats, defaultCarTuning } from "./core/Vehicle.ts";
import { Canvas2DRenderer } from "./core/CanvasRenderer.ts";

/**
 * Phase 0 wiring: a single drivable car on an open field. No track yet (that
 * is Phase 1), but every seam the game will need is live: input -> loop ->
 * simulation -> interpolation -> render.
 */
export function main(): void {
  const canvas = document.getElementById("game") as HTMLCanvasElement | null;
  if (canvas === null) {
    throw new Error("missing #game canvas");
  }

  const dpr = window.devicePixelRatio || 1;
  const cssW = window.innerWidth;
  const cssH = window.innerHeight;
  const camera = new Camera({ x: 0, y: 0 }, cssW / dpr, cssH / dpr, 1);

  const renderer = new Canvas2DRenderer(canvas);
  renderer.resize(cssW, cssH);

  const input = new KeyboardInput();
  input.attach(document.body);

  const car = new Vehicle(defaultCarStats, defaultCarTuning, { x: 0, y: 0 }, 0);

  const loop = new FixedTimestepLoop(FIXED_DT, (dt) => {
    car.step(dt, input.sample());
  });

  // rAF drives the accumulator; the accumulator drives fixed simulation
  // steps; interpolation feeds the renderer.
  let last = performance.now() / 1000;
  const frame = () => {
    const now = performance.now() / 1000;
    const delta = now - last;
    last = now;
    const alpha = loop.update(delta);

    camera.follow(car.pos, car.cameraLookAhead());
    renderer.render({ camera, car }, alpha);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Keep the camera view size correct through resizes.
  window.addEventListener("resize", () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.setViewport(w / dpr, h / dpr);
    renderer.resize(w, h);
  });
}

main();
