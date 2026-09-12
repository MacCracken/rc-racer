/**
 * Game — the director that ties the seam layers together and drives the screen
 * flow: menu -> garage -> race -> results. It owns one RaceState for the player
 * and one per AI rival, advances them on the fixed-timestep loop, and hands off
 * to the UI when a race ends. No DOM lives in the simulation; the UI is the only
 * thing that touches the screen.
 */
import { FixedTimestepLoop } from "../core/FixedTimestepLoop.ts";
import { Camera } from "../core/Camera.ts";
import { KeyboardInput, type IInput, type InputState } from "../core/Input.ts";
import {
  createArena,
  stepCar,
  forwardSpeed,
  type Arena,
  type ArenaCar,
} from "../physics/MatterCar.ts";
import { RaceState, currentLapTimeMs } from "../race/RaceState.ts";
import { makeDriver } from "../race/AiDriver.ts";
import { tracks as DEFAULT_TRACKS } from "../track/tracks.ts";
import type { TrackDef } from "../track/Track.ts";
import { buildTrack } from "../track/Track.ts";
import { carClasses as DEFAULT_CARS, type CarClass } from "./cars.ts";
import { Progression } from "./progression.ts";
import {
  UPGRADE_TREE,
  nextTier,
  statBars,
  type SlotId,
  type OwnedUpgrades,
} from "./upgrades.ts";
import type { ISaveStore, SaveData } from "./save.ts";
import type { IRenderer, RenderScene } from "../core/types.ts";
import { createAudio, type IAudio } from "../core/Audio.ts";
import {
  createSkid,
  sampleDrift,
  ageMarks,
  type SkidState,
} from "../core/SkidMarks.ts";
import type { Ghost } from "../race/Ghost.ts";
import { CAR_LENGTH, CAR_WIDTH } from "../core/tuning.ts";
import {
  menuHtml,
  garageHtml,
  resultsHtml,
  formatPar,
  type Screen,
  type UiModel,
  type CarRow,
  type TrackRow,
  type UpgradeRow,
  type ResultsView,
} from "../ui/ui.ts";
import type { Vec2 } from "../core/vec.ts";

/** The driver closure's input: a readable snapshot of the body. */
interface BodyState {
  position: Vec2;
  velocity: Vec2;
  angle: number;
}

/** A rival: its body + the race/driver/prev-frame state the autopilot feeds it. */
interface Racer {
  car: ArenaCar;
  race: RaceState;
  driver: (d: BodyState) => InputState;
  prev: Vec2;
}

export interface GameDeps {
  renderer: IRenderer;
  uiRoot: HTMLElement;
  store?: ISaveStore;
  /** Number of AI rivals per race. */
  rivals?: number;
  /** Audio seam; defaults to an environment-aware impl (silent headless). */
  audio?: IAudio;
  carClasses?: CarClass[];
  tracks?: TrackDef[];
}

export class Game {
  private readonly renderer: IRenderer;
  private readonly uiRoot: HTMLElement;
  private readonly loop: FixedTimestepLoop;
  private readonly store: ISaveStore;
  private readonly rivals: number;
  private readonly carClasses: CarClass[];
  private readonly trackDefs: TrackDef[];

  private camera: Camera;
  private input: IInput;
  private clockMs = 0;
  private lastFrameMs = 0;
  private frameHandle: number | null = null;

  private arena: Arena;
  private playerRace: RaceState;
  private racers: Racer[] = [];
  private finished = false;
  private lastResults: ResultsView | null = null;
  public screen: Screen = "menu";

  private onClickBound: (e: Event) => void;
  private prevMap = new Map<object, Vec2>();
  private skid: SkidState;
  private audio: IAudio;
  private prevLap = 0;
  private ghost: Ghost = [];

  constructor(
    public readonly prog: Progression,
    deps: GameDeps,
  ) {
    this.renderer = deps.renderer;
    this.uiRoot = deps.uiRoot;
    this.rivals = deps.rivals ?? 3;
    this.carClasses = deps.carClasses ?? DEFAULT_CARS;
    this.trackDefs = deps.tracks ?? DEFAULT_TRACKS;
    const hasStorage = typeof localStorage !== "undefined";
    this.store = hasStorage ? new LocalStore("rc-racer-save") : new NullStore();
    const dpr =
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const w = (typeof window !== "undefined" ? window.innerWidth : 800) / dpr;
    const h = (typeof window !== "undefined" ? window.innerHeight : 600) / dpr;
    this.camera = new Camera({ x: 0, y: 0 }, w, h, 0.55);
    this.input = new KeyboardInput();
    this.loop = new FixedTimestepLoop(1 / 120, (dt) => this.onStep(dt));

    this.onClickBound = (e: Event) => this.onClick(e);

    this.skid = createSkid();
    this.audio = deps.audio ?? createAudio();

    // Preview arena so the first render has something to draw.
    this.arena = createArena(
      buildTrack(this.currentTrack()),
      this.currentStats(),
      [],
    );
    this.playerRace = new RaceState(this.arena.track, () => this.clockMs);

    this.uiRoot.addEventListener("click", this.onClickBound);
  }

  // --- lifecycle ---------------------------------------------------------

  /** Wire input + resize and start the render loop on the menu screen. */
  start(): void {
    this.input.attach(document.body);
    window.addEventListener("resize", () => this.onResize());
    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyR" && this.screen === "race") this.startRace();
    });
    this.showMenu();
    this.lastFrameMs = performance.now();
    this.frameHandle = requestAnimationFrame((t) => this.frame(t));
  }

  stop(): void {
    this.input.detach();
    this.uiRoot.removeEventListener("click", this.onClickBound);
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
  }

  private frame(nowMs: number): void {
    const delta = (nowMs - this.lastFrameMs) / 1000;
    this.lastFrameMs = nowMs;
    this.loop.update(delta);
    this.renderScene(nowMs);
    this.frameHandle = requestAnimationFrame((t) => this.frame(t));
  }

  private onResize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.renderer.resize(window.innerWidth, window.innerHeight, dpr);
    this.camera.setViewport(window.innerWidth / dpr, window.innerHeight / dpr);
  }

  // --- screen flow -----------------------------------------------------

  private showMenu(): void {
    this.screen = "menu";
    this.uiRoot.innerHTML = menuHtml(this.uiModel());
    this.syncPreviewCamera();
  }

  private showGarage(): void {
    this.screen = "garage";
    this.uiRoot.innerHTML = garageHtml(this.uiModel());
    this.syncPreviewCamera();
  }

  private showResults(): void {
    if (this.lastResults === null) return;
    this.screen = "results";
    this.uiRoot.innerHTML = resultsHtml(this.lastResults);
  }

  private currentTrack = (): TrackDef =>
    this.trackDefs.find((t) => t.id === this.prog.selectedTrackId) ??
    this.trackDefs[0];

  private currentStats = () => this.prog.resolveStats(this.prog.selectedCarId);

  private syncPreviewCamera(): void {
    const p = this.arena.cars[0];
    if (p === undefined) return;
    this.camera.view = {
      x: p.body.position.x,
      y: p.body.position.y,
    };
  }

  private startRace(): void {
    const track = buildTrack(this.currentTrack());
    const stats = this.currentStats();
    const paces = Array.from({ length: this.rivals }, (_, i) => {
      const base = track.def.aiPace ?? 0.78;
      return Math.min(0.98, base + (i - 1) * 0.05);
    });
    this.arena = createArena(track, stats, paces);
    this.ghost = this.prog.ghostFor(track.def.id);
    this.playerRace = new RaceState(this.arena.track, () => this.clockMs);
    this.racers = [];
    for (const c of this.arena.cars) {
      if (c.isPlayer || c.pace === undefined) continue;
      this.racers.push({
        car: c,
        race: new RaceState(this.arena.track, () => this.clockMs),
        driver: makeDriver(track, { pace: c.pace, lookahead: 0.05 }),
        prev: { x: c.body.position.x, y: c.body.position.y },
      });
    }
    this.finished = false;
    this.lastResults = null;
    this.clockMs = 0;
    this.skid = createSkid();
    this.prevLap = 0;
    this.screen = "race";
    this.uiRoot.innerHTML = "";
    const p = this.arena.cars[0]!;
    this.camera.view = { x: p.body.position.x, y: p.body.position.y };
  }

  // --- simulation ------------------------------------------------------

  /** Fixed-timestep tick; `dt` is in seconds. */
  private onStep(dt: number): void {
    if (this.screen !== "race" || this.finished) return;
    this.clockMs += dt * 1000;

    // Player.
    const p = this.arena.cars[0]!;
    this.prevMap.set(p.body, this.prevOf(p.body));
    this.stepBody(p, this.input.sample(), dt);
    this.playerRace.update(this.prevOf(p.body), p.body.position);

    // Tire-smoke trail: lay skids while the player slides, fade them over time.
    sampleDrift(this.skid, p.body, {
      carLength: CAR_LENGTH,
      carWidth: CAR_WIDTH,
      maxSpeed: p.stats.maxSpeed,
    });
    ageMarks(this.skid, dt);

    // Rivals.
    for (const r of this.racers) {
      const inp = r.driver({
        position: r.car.body.position,
        velocity: r.car.body.velocity,
        angle: r.car.body.angle,
      });
      this.stepBody(r.car, inp, dt);
      r.race.update(r.prev, r.car.body.position);
      r.prev = { x: r.car.body.position.x, y: r.car.body.position.y };
    }

    if (this.playerRace.lap > this.prevLap) {
      this.audio.play("lap");
      this.prevLap = this.playerRace.lap;
    }
    if (this.playerRace.finished) this.finalizeRace();
  }

  private stepBody(c: ArenaCar, input: InputState, dtS: number): void {
    stepCar(c.body, this.arena.walls, this.arena.track, input, c.stats, dtS);
  }

  // Store the position *before* stepping so the 2-point gate test sees a
  // (prev, cur) pair across the tick.
  private prevOf(b: { position: Vec2 }): Vec2 {
    return (
      this.prevMap.get(b) ?? ({ x: b.position.x, y: b.position.y } as Vec2)
    );
  }

  private finalizeRace(): void {
    this.finished = true;
    this.audio.play("finish");
    const outcome = this.prog.recordRace({
      trackId: this.currentTrack().id,
      carId: this.prog.selectedCarId,
      laps: this.playerRace.lap,
      bestLapMs: this.playerRace.bestLapMs,
      bestLapGhost: this.playerRace.bestGhost,
      finished: true,
    });
    this.lastResults = {
      position: this.playerPosition(),
      total: this.arena.cars.length,
      bestLapMs: this.playerRace.bestLapMs,
      outcome,
    };
    this.save();
    this.showResults();
  }

  /** Live Pn for the HUD: count rivals further around the lap than us. */
  private playerPosition(): number {
    const progressOf = (race: RaceState): number =>
      race.lap * 10_000_000 + currentLapTimeMs(race, this.clockMs);
    const playerP = progressOf(this.playerRace);
    let ahead = 0;
    for (const r of this.racers) {
      if (progressOf(r.race) > playerP) ahead += 1;
    }
    return ahead + 1;
  }

  // --- rendering -------------------------------------------------------

  private renderScene(nowMs: number): void {
    const p = this.arena.cars[0]!;
    const scene: RenderScene = {
      camera: this.camera,
      track: this.arena.track,
      car: p.body,
      race: this.playerRace,
      speed: forwardSpeed(p.body),
      nowMs,
      rivals: this.arena.cars.filter((c) => !c.isPlayer).map((c) => c.body),
      position: this.playerPosition(),
      total: this.arena.cars.length,
      skidMarks: this.skid.marks,
      ghost: this.ghost,
    };
    this.renderer.render(scene);
  }

  // --- UI plumbing -----------------------------------------------------

  private onClick(e: Event): void {
    const target = e.target as HTMLElement | null;
    if (target === null) return;
    const el = target.closest(
      "[data-action],[data-selectcar],[data-selecttrack],[data-buy],[data-switchcar]",
    ) as HTMLElement | null;
    if (el === null) return;
    this.audio.play("click");

    const action = el.getAttribute("data-action");
    if (action === "start" || action === "raceagain") this.startRace();
    else if (action === "garage") this.showGarage();
    else if (action === "menu") this.showMenu();

    const selCar = el.getAttribute("data-selectcar");
    if (selCar !== null) {
      this.prog.selectCar(selCar);
      if (!this.prog.isCarOwned(selCar)) this.prog.unlockCar(selCar);
    }

    const selTrack = el.getAttribute("data-selecttrack");
    if (selTrack !== null) {
      this.prog.selectTrack(selTrack);
    }

    const sw = el.getAttribute("data-switchcar");
    if (sw !== null) this.prog.selectCar(sw);

    const buySlot = el.getAttribute("data-buy");
    if (buySlot !== null)
      this.prog.buyUpgrade(this.prog.selectedCarId, buySlot as SlotId);

    // Re-render whatever screen we're on so a just-made purchase shows up.
    if (this.screen === "menu") this.showMenu();
    else if (this.screen === "garage") this.showGarage();
  }

  private uiModel(): UiModel {
    const credits = this.prog.credits;
    const owned = new Set(this.prog.data.ownedCars);
    const cars: CarRow[] = this.carClasses.map((c) => ({
      id: c.id,
      name: c.name,
      blurb: c.blurb,
      classLabel: c.classLabel,
      cost: c.cost,
      owned: owned.has(c.id),
      selected: c.id === this.prog.selectedCarId,
    }));

    const trackRows: TrackRow[] = this.trackDefs.map((t, i) => ({
      id: t.id,
      name: t.name,
      laps: t.laps,
      parLabel: t.parLapMs !== undefined ? formatPar(t.parLapMs) : "–",
      cleared: this.prog.isTrackCleared(t.id),
      unlocked: this.prog.isTrackUnlocked(i),
      selected: t.id === this.prog.selectedTrackId,
      vibe: t.vibe,
      difficulty: t.difficulty,
    }));

    const carOwned: OwnedUpgrades = this.prog.upgradesFor(
      this.prog.selectedCarId,
    );
    const upgrades: UpgradeRow[] = UPGRADE_TREE.map((s) => {
      const next = nextTier(s.id, carOwned);
      return {
        slot: s.id,
        name: s.name,
        level: carOwned[s.id] ?? 0,
        maxLevel: s.tiers.length,
        nextCost: next?.cost ?? 0,
        maxed: next === null,
        canAfford: next !== null && credits >= next.cost,
      };
    });

    return {
      credits,
      cars,
      tracks: trackRows,
      statBars: statBars(this.currentStats()),
      upgrades,
    };
  }

  // --- persistence -------------------------------------------------------

  private save(): void {
    this.store.save(this.prog.snapshot());
  }
}

/** In-memory store for environments without localStorage (e.g. headless). */
class NullStore implements ISaveStore {
  save(): void {
    void 0;
  }
  load(): SaveData | null {
    return null;
  }
}

/**
 * LocalStorage-backed save. Guarded so a blocked/missing localStorage never
 * breaks the game.
 */
class LocalStore implements ISaveStore {
  constructor(private readonly key: string) {}
  save(d: SaveData): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(d));
    } catch {
      // storage full / disabled: keep playing
    }
  }
  load(): SaveData | null {
    try {
      const raw = localStorage.getItem(this.key);
      return raw === null ? null : (JSON.parse(raw) as SaveData);
    } catch {
      return null;
    }
  }
}
