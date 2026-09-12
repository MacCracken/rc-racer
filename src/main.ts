import "./style.css";
import { Canvas2DRenderer } from "./core/CanvasRenderer.ts";
import { Game } from "./game/Game.ts";
import { Progression } from "./game/progression.ts";
import { LocalSaveStore } from "./game/save.ts";

// --- DOM wiring (the only place that touches the screen) -------------------

const canvas = document.getElementById("game") as HTMLCanvasElement | null;
if (canvas === null) throw new Error("missing #game canvas");
const uiRoot = document.getElementById("ui") as HTMLElement | null;
if (uiRoot === null) throw new Error("missing #ui root");

// Size the renderer to the viewport; Game drives everything else.
const renderer = new Canvas2DRenderer(canvas);
renderer.resize(
  window.innerWidth,
  window.innerHeight,
  window.devicePixelRatio || 1,
);

// One store, shared: loads saved progress on boot, saves after every race.
const store = new LocalSaveStore();
const prog = Progression.fromStore(store);

// The Game director wires input + UI + the fixed-timestep loop and shows the menu.
const game = new Game(prog, { renderer, uiRoot, store, rivals: 3 });
game.start();

// Expose for console debugging (handy while tuning by hand).
Object.assign(window, { game, prog, renderer });
