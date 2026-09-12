import "./style.css";
import { FIXED_DT, defaultCarStats } from "./core/tuning.ts";
import { FixedTimestepLoop } from "./core/FixedTimestepLoop.ts";
import { Camera } from "./core/Camera.ts";
import { KeyboardInput } from "./core/Input.ts";
import { Canvas2DRenderer } from "./core/CanvasRenderer.ts";
import {
  createCarWorld,
  stepCar,
  forwardSpeed,
  type CarWorld,
} from "./physics/MatterCar.ts";
import { RaceState, formatLap } from "./race/RaceState.ts";
import { buildTrack } from "./track/Track.ts";
import { overture } from "./track/tracks.ts";
import type { Vec2 } from "./core/vec.ts";

// ms clock for race lap timing + HUD.
const now = (): number => performance.now();

const canvas = document.getElementById("game") as HTMLCanvasElement | null;
if (canvas === null) throw new Error("missing #game canvas");
const overlay = document.getElementById("overlay");

const track = buildTrack(overture);

const dpr = window.devicePixelRatio || 1;
const camera = new Camera(
  { x: track.start.pos.x, y: track.start.pos.y },
  window.innerWidth / dpr,
  window.innerHeight / dpr,
  0.55,
);
const renderer = new Canvas2DRenderer(canvas);

// Per-race state, rebuilt on restart.
let world: CarWorld;
let race: RaceState;
let stepping = true;

function startRace(): void {
  world = createCarWorld(track);
  race = new RaceState(track, now);
  stepping = true;
  camera.view = {
    x: world.car.position.x,
    y: world.car.position.y,
  };
  if (overlay) overlay.textContent = "";
}

function resize(): void {
  renderer.resize(window.innerWidth, window.innerHeight, dpr);
  camera.setViewport(window.innerWidth / dpr, window.innerHeight / dpr);
}

startRace();
resize();
window.addEventListener("resize", resize);

// Restart key.
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyR") startRace();
});

const input = new KeyboardInput();
input.attach(document.body);

function step(dt: number): void {
  if (!stepping) return;
  const pre: Vec2 = { x: world.car.position.x, y: world.car.position.y };
  stepCar(world.car, world.walls, track, input.sample(), defaultCarStats, dt);
  const post: Vec2 = { x: world.car.position.x, y: world.car.position.y };
  race.update(pre, post);
}

const loop = new FixedTimestepLoop(FIXED_DT, step);

// Render loop: rAF drives the accumulator; the accumulator drives the fixed
// simulation steps.
let last = performance.now();
const frame = (): void => {
  const nowMs = performance.now();
  const frameDt = Math.min(nowMs - last, 100) / 1000;
  last = nowMs;
  loop.update(frameDt);

  // Look-ahead camera: nudge toward velocity for a racing feel, then smooth.
  const desired = {
    x: world.car.position.x + world.car.velocity.x * 0.22,
    y: world.car.position.y + world.car.velocity.y * 0.22,
  };
  camera.lerpTo(desired, 6, frameDt);

  renderer.render({
    camera,
    track,
    car: world.car,
    race,
    speed: forwardSpeed(world.car),
    nowMs,
  });

  if (race.finished && overlay) {
    overlay.textContent = `FINISHED · best lap ${formatLap(race.bestLapMs)}\n[press R to restart]`;
  }
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
