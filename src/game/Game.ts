/**
 * Game — the director that ties the seam layers together and drives the screen
 * flow: menu -> garage -> race -> results. It owns one RaceState for the player
 * and one per AI rival, advances them on the fixed-timestep loop, and hands off
 * to the UI when a race ends. No DOM lives in the simulation; the UI is the only
 * thing that touches the screen.
 */
import { FixedTimestepLoop } from "../core/FixedTimestepLoop.ts";
import { Camera, speedZoom } from "../core/Camera.ts";
import { GamepadInput } from "../core/Gamepad.ts";
import { TouchInput } from "../core/TouchInput.ts";
import {
  CompositeInput,
  KeyboardInput,
  KEY_ACTIONS,
  neutralInput,
  type IInput,
  type InputState,
  type KeyAction,
} from "../core/Input.ts";
import {
  createArena,
  stepCar,
  forwardSpeed,
  type Arena,
  type ArenaCar,
} from "../physics/MatterCar.ts";
import { currentLapTimeMs, formatLap, RaceState } from "../race/RaceState.ts";
import { makeDriver } from "../race/AiDriver.ts";
import { tracks as DEFAULT_TRACKS } from "../track/tracks.ts";
import type { TrackDef } from "../track/Track.ts";
import { buildTrack } from "../track/Track.ts";
import { carById, carClasses as DEFAULT_CARS, type CarClass } from "./cars.ts";
import { Progression } from "./progression.ts";
import { rivalCarFor, rivalField, rivalLabel } from "./rivals.ts";
import {
  UPGRADE_TREE,
  nextTier,
  statBars,
  type SlotId,
  type OwnedUpgrades,
} from "./upgrades.ts";
import { browserStorage, LocalSaveStore, MemorySaveStore } from "./save.ts";
import type { ISaveStore } from "./save.ts";
import type { IRenderer, RenderScene } from "../core/types.ts";
import { createAudio, engineFor, type IAudio } from "../core/Audio.ts";
import {
  createSkid,
  sampleDrift,
  slipAmount,
  ageMarks,
  type SkidState,
} from "../core/SkidMarks.ts";
import { sampleGhost, type Ghost } from "../race/Ghost.ts";
import { buildSplits, ghostTimeAt, type Splits } from "../race/Split.ts";
import {
  CAR_LENGTH,
  CAR_WIDTH,
  CAMERA_LERP_RATE,
  CAMERA_LOOKAHEAD,
  CAMERA_ZOOM_FAST,
  CAMERA_ZOOM_MENU,
  CAMERA_ZOOM_RATE,
  CAMERA_ZOOM_SLOW,
  START_COUNTDOWN_MS,
} from "../core/tuning.ts";
import {
  menuHtml,
  garageHtml,
  resultsHtml,
  raceOverlay,
  pauseHtml,
  onboardingHtml,
  settingsHtml,
  formatPar,
  type Screen,
  type UiModel,
  type CarRow,
  type TrackRow,
  type UpgradeRow,
  type ResultsView,
} from "../ui/ui.ts";
import type { Vec2 } from "../core/vec.ts";
import { ACTION_LABELS, keyLabel, type CarLook } from "../core/theme.ts";
import {
  defaultSettings,
  isReservedCode,
  nextHudSize,
  rebindSetting,
  toggleColorMode,
  type Settings,
} from "./settings.ts";
import type { SettingsView } from "../ui/ui.ts";

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
  /** Last input the autopilot gave, for the rival's wheels + brake lights. */
  input: InputState;
}

/** Camera zoom multiplier for a `w` x `h` css-px viewport (see `viewScale`). */
export function viewScaleFor(w: number, h: number): number {
  return Math.max(0.5, Math.min(1, Math.min(w, h) / 600));
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
  /** Start countdown length (ms); 0 skips it. Defaults to START_COUNTDOWN_MS. */
  countdownMs?: number;
}

export class Game {
  private readonly renderer: IRenderer;
  private readonly uiRoot: HTMLElement;
  private readonly loop: FixedTimestepLoop;
  private readonly store: ISaveStore;
  private readonly rivals: number;
  private readonly carClasses: CarClass[];
  private readonly trackDefs: TrackDef[];
  /** Length of the start countdown (ms); 0 = none. */
  private readonly countdownTotalMs: number;

  private camera: Camera;
  private input: IInput;
  /** Also inside `input`; held here to poll its Start button for pause. */
  private gamepad: GamepadInput;
  private clockMs = 0;
  private lastFrameMs = 0;
  private frameHandle: number | null = null;
  private fps = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  /** Pixel density the canvas was last sized for (0 = not yet). */
  private dpr = 0;
  /**
   * Zoom multiplier for small screens (phones): below 600 css px on the short
   * side the camera pulls out, so as much track is visible as on a laptop.
   * 1 on anything bigger, leaving the tuned desktop framing alone.
   */
  private viewScale = 1;
  /** The player's input on the last step, for the car's wheels + lights. */
  private lastInput: InputState = neutralInput();

  private arena: Arena;
  private playerRace: RaceState;
  private racers: Racer[] = [];
  private finished = false;
  /** ms left before the lights go green; 0 once the race is running. */
  private countdownMs = 0;
  /** A race frozen by the player (Esc / P) or by the window losing focus. */
  private paused = false;
  private lastResults: ResultsView | null = null;
  public screen: Screen = "menu";

  private onClickBound: (e: Event) => void;
  private onKeyDownBound: (e: KeyboardEvent) => void;
  private onResizeBound: () => void;
  private onFocusLostBound: () => void;
  private onVisibilityBound: () => void;
  private skid: SkidState;
  private audio: IAudio;
  private prevLap = 0;
  /** The saved best-lap ghost for the current track (empty if none yet). */
  private ghost: Ghost = [];
  /** `splits` indexes this ghost by distance; rebuilt when the chase changes. */
  private splitsFor: Ghost | null = null;
  private splits: Splits = { s: [], t: [] };
  /**
   * Frame time (rAF ms) the finish confetti started, or null for none. Wall
   * clock, not the race clock: the sim (and its clock) stops at the finish.
   */
  private confettiStartFrameMs: number | null = null;
  private settings: Settings;
  /** The action awaiting a key capture, or null when not rebinding. */
  private rebinding: KeyAction | null = null;
  /** Why the last captured key was refused (e.g. a reserved key), if any. */
  private rebindNotice: string | null = null;
  private onRebindKeyBound: (e: KeyboardEvent) => void;

  constructor(
    public readonly prog: Progression,
    deps: GameDeps,
  ) {
    this.renderer = deps.renderer;
    this.uiRoot = deps.uiRoot;
    this.rivals = deps.rivals ?? 3;
    this.carClasses = deps.carClasses ?? DEFAULT_CARS;
    this.trackDefs = deps.tracks ?? DEFAULT_TRACKS;
    this.countdownTotalMs = Math.max(0, deps.countdownMs ?? START_COUNTDOWN_MS);
    this.store =
      deps.store ??
      (browserStorage() !== null
        ? new LocalSaveStore()
        : new MemorySaveStore());
    const w = typeof window !== "undefined" ? window.innerWidth : 800;
    const h = typeof window !== "undefined" ? window.innerHeight : 600;
    this.camera = new Camera({ x: 0, y: 0 }, w, h, 0.55);
    this.viewScale = viewScaleFor(w, h);
    // Keyboard, gamepad and touch all drive at once: use whichever you like.
    this.gamepad = new GamepadInput();
    this.input = new CompositeInput([
      new KeyboardInput(),
      this.gamepad,
      new TouchInput(),
    ]);
    this.loop = new FixedTimestepLoop(1 / 120, (dt) => this.onStep(dt));

    this.onClickBound = (e: Event) => this.onClick(e);
    this.onKeyDownBound = (e: KeyboardEvent) => this.onKeyDown(e);
    this.onResizeBound = () => this.onResize();
    this.onRebindKeyBound = (e: KeyboardEvent) => this.onRebindKey(e);
    // Alt-tab, a click into devtools or a hidden tab freezes a race rather
    // than letting it run on with every key released.
    this.onFocusLostBound = () => this.pause();
    this.onVisibilityBound = () => {
      if (document.hidden) this.pause();
    };

    this.skid = createSkid();
    this.audio = deps.audio ?? createAudio();

    // Load persisted UI prefs, or start from defaults, and seed the sim seams.
    this.settings = this.prog.settings ?? defaultSettings();
    // A save from before the onboarding flag, with races in it, has clearly
    // been played: don't greet that player with How to Play.
    if (!this.settings.onboarded && this.prog.data.clearedTracks.length > 0)
      this.settings = { ...this.settings, onboarded: true };
    this.prog.setSettings(this.settings);
    this.input.setKeyMap(this.settings.keyMap);
    this.applyTheme();
    this.audio.setMuted(this.settings.muted);

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
    document.addEventListener("keydown", this.onRebindKeyBound, true);
    window.addEventListener("resize", this.onResizeBound);
    window.addEventListener("keydown", this.onKeyDownBound);
    window.addEventListener("blur", this.onFocusLostBound);
    document.addEventListener("visibilitychange", this.onVisibilityBound);
    this.showOpeningScreen();
    this.lastFrameMs = performance.now();
    this.frameHandle = requestAnimationFrame((t) => this.frame(t));
  }

  stop(): void {
    this.input.detach();
    document.removeEventListener("keydown", this.onRebindKeyBound, true);
    window.removeEventListener("resize", this.onResizeBound);
    window.removeEventListener("keydown", this.onKeyDownBound);
    window.removeEventListener("blur", this.onFocusLostBound);
    document.removeEventListener("visibilitychange", this.onVisibilityBound);
    this.uiRoot.removeEventListener("click", this.onClickBound);
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
  }

  /**
   * Global shortcuts. In a race R restarts and Esc / P pause (and resume);
   * Q / Backspace — or Esc on any other screen — go back to the menu.
   */
  private onKeyDown(e: KeyboardEvent): void {
    // Leave browser/OS chords (⌘R reload, Ctrl+Q…) to the browser.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === "KeyR" && this.screen === "race") {
      // Holding R auto-repeats keydown; restart once per press.
      if (!e.repeat) this.startRace();
      return;
    }
    if ((e.code === "Escape" || e.code === "KeyP") && this.screen === "race") {
      if (!e.repeat) {
        this.audio.play("click");
        if (this.paused) this.resume();
        else this.pause();
      }
      return;
    }
    const quitting =
      e.code === "Escape" || e.code === "Backspace" || e.code === "KeyQ";
    if (quitting && this.screen !== "menu") {
      this.audio.play("click");
      this.backToMenu();
    }
  }

  private frame(nowMs: number): void {
    // Dragging the window to a screen with another pixel density fires no
    // resize event; re-size the canvas so it doesn't render blurry.
    if ((window.devicePixelRatio || 1) !== this.dpr) this.onResize();
    const delta = (nowMs - this.lastFrameMs) / 1000;
    this.lastFrameMs = nowMs;
    this.pollGamepad();
    this.loop.update(delta);
    this.fpsAcc += delta;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    this.renderScene();
    this.presentAudio();
    this.frameHandle = requestAnimationFrame((t) => this.frame(t));
  }

  private onResize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    this.renderer.resize(window.innerWidth, window.innerHeight, dpr);
    this.camera.setViewport(window.innerWidth, window.innerHeight);
    this.viewScale = viewScaleFor(window.innerWidth, window.innerHeight);
  }

  // --- screen flow -----------------------------------------------------

  /** First launch opens on How to Play; after that, straight to the menu. */
  private showOpeningScreen(): void {
    if (this.settings.onboarded) this.showMenu();
    else this.showOnboarding();
  }

  /** How to Play has been seen: don't open on it again. */
  private markOnboarded(): void {
    if (!this.settings.onboarded)
      this.commitSettings({ ...this.settings, onboarded: true });
  }

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

  private showOnboarding(): void {
    this.screen = "onboarding";
    this.uiRoot.innerHTML = onboardingHtml(this.settings.keyMap);
  }

  private showSettings(): void {
    this.screen = "settings";
    this.uiRoot.innerHTML = settingsHtml(this.settingsView());
  }

  private currentTrack = (): TrackDef =>
    this.trackDefs.find((t) => t.id === this.prog.selectedTrackId) ??
    this.trackDefs[0];

  private currentStats = () => this.prog.resolveStats(this.prog.selectedCarId);

  /** Engine pitch of the selected car class (1 = the sedan's). */
  private enginePitch = (): number =>
    this.carClasses.find((c) => c.id === this.prog.selectedCarId)
      ?.enginePitch ?? 1;

  /** Body style of the selected car (rivals race the same class). */
  private carLook = (): CarLook =>
    this.carClasses.find((c) => c.id === this.prog.selectedCarId)?.look ??
    "sedan";

  private syncPreviewCamera(): void {
    const p = this.arena.cars[0];
    if (p === undefined) return;
    this.camera.view = {
      x: p.body.position.x,
      y: p.body.position.y,
    };
    this.camera.zoom = CAMERA_ZOOM_MENU * this.viewScale;
  }

  // Quit to the menu from a race or results screen (Esc/Q/Backspace or the
  // on-screen Menu control). Resets to the single-car preview arena.
  private backToMenu(): void {
    this.resetPreview();
    this.showMenu();
  }

  /**
   * Park a single car on the selected track: the live backdrop behind the
   * menus. Clears every trace of the last race (clock, rivals, skids,
   * confetti) so none of it leaks into the menu or the next race.
   */
  private resetPreview(): void {
    this.finished = false;
    this.paused = false;
    this.countdownMs = 0;
    this.clockMs = 0;
    this.confettiStartFrameMs = null;
    this.arena = createArena(
      buildTrack(this.currentTrack()),
      this.currentStats(),
      [],
    );
    this.racers = [];
    this.playerRace = new RaceState(this.arena.track, () => this.clockMs);
    this.skid = createSkid();
    this.lastInput = neutralInput();
    this.ghost = this.prog.ghostFor(this.currentTrack().id);
    this.lastResults = null;
  }

  /**
   * Release focus from the button just clicked so the keyboard goes straight
   * to driving instead of re-activating a focused control (e.g. Space would
   * otherwise double-fire the Start or Resume button).
   */
  private releaseFocus(): void {
    if (
      typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
    )
      document.activeElement.blur();
  }

  private startRace(): void {
    this.releaseFocus();
    // Reset the race clock *before* building any RaceState: each stamps its
    // lap start from this clock, so a stale one (Race again, R restart) made
    // the first lap time negative and saved it as an unbeatable record.
    this.clockMs = 0;
    this.confettiStartFrameMs = null;
    const track = buildTrack(this.currentTrack());
    // The field comes from the track (its rival car + tier), never from the
    // player's garage: upgrading your car genuinely pulls you ahead of it.
    this.arena = createArena(
      track,
      this.currentStats(),
      rivalField(track.def, this.rivals),
    );
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
        input: neutralInput(),
      });
    }
    this.finished = false;
    this.paused = false;
    this.lastResults = null;
    this.skid = createSkid();
    this.lastInput = neutralInput();
    this.prevLap = 0;
    // The field waits on the grid for the lights; the first beep is "3".
    this.countdownMs = this.countdownTotalMs;
    if (this.countdownMs > 0) this.audio.play("count");
    this.screen = "race";
    this.showRaceOverlay();
    const p = this.arena.cars[0]!;
    this.camera.view = { x: p.body.position.x, y: p.body.position.y };
    // Parked on the grid: close in.
    this.camera.zoom = CAMERA_ZOOM_SLOW * this.viewScale;
  }

  /** A gamepad's Start button pauses and resumes a race, like Esc / P. */
  private pollGamepad(): void {
    if (!this.gamepad.startPressed() || this.screen !== "race") return;
    this.audio.play("click");
    if (this.paused) this.resume();
    else this.pause();
  }

  /** Freeze a race in progress (Esc / P, the Pause button, or lost focus). */
  private pause(): void {
    if (this.screen !== "race" || this.finished || this.paused) return;
    this.paused = true;
    // Now, not next frame: a hidden tab gets no frames, and the engine
    // would drone on in the background.
    this.presentAudio();
    this.showRaceOverlay();
  }

  private resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.releaseFocus();
    this.showRaceOverlay();
  }

  /** The race's DOM layer: the pause menu while paused, else the thin overlay. */
  private showRaceOverlay(): void {
    this.uiRoot.innerHTML = this.paused
      ? pauseHtml(this.settings.muted)
      : raceOverlay(this.settings.keyMap, this.settings.muted);
  }

  // --- simulation ------------------------------------------------------

  /** Fixed-timestep tick; `dt` is in seconds. */
  private onStep(dt: number): void {
    if (this.screen !== "race" || this.finished || this.paused) return;
    if (this.countdownMs > 0) {
      this.stepCountdown(dt);
      return;
    }
    this.clockMs += dt * 1000;

    // Player.
    const p = this.arena.cars[0]!;
    // Capture the pre-step pose so the gate test sees this tick's
    // (prev -> cur) segment. Feeding the *previous* stored pose (the old
    // prevMap) frozen the segment at [grid, now] forever, so no real
    // start/finish crossing ever registered.
    const prevP: Vec2 = { x: p.body.position.x, y: p.body.position.y };
    this.lastInput = this.input.sample();
    this.stepBody(p, this.lastInput, dt);
    this.playerRace.update(prevP, p.body.position, p.body.angle);

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
      r.input = inp;
      this.stepBody(r.car, inp, dt);
      r.race.update(r.prev, r.car.body.position);
      r.prev = { x: r.car.body.position.x, y: r.car.body.position.y };
    }

    // Camera follows the player (look-ahead along heading) so the track stays framed.
    this.followCamera(dt);

    if (this.playerRace.lap > this.prevLap) {
      // The final lap gets the finish chime instead (not both at once).
      if (!this.playerRace.finished) this.audio.play("lap");
      this.prevLap = this.playerRace.lap;
    }
    if (this.playerRace.finished) this.finalizeRace();
  }

  /**
   * The start countdown. Every car is held on the grid and the race clock
   * waits, so nobody — rival or player — gets a jump on the field; the player
   * can still turn the wheels and blip the brakes. A beep marks each second,
   * a higher one the green light.
   */
  private stepCountdown(dt: number): void {
    this.lastInput = this.input.sample();
    const shown = Math.ceil(this.countdownMs / 1000);
    this.countdownMs -= dt * 1000;
    // Snap float residue from the repeated subtraction, so GO lands on time.
    if (this.countdownMs < 1e-6) this.countdownMs = 0;
    if (this.countdownMs === 0) this.audio.play("go");
    else if (Math.ceil(this.countdownMs / 1000) < shown)
      this.audio.play("count");
  }

  private stepBody(c: ArenaCar, input: InputState, dtS: number): void {
    stepCar(c.body, this.arena.walls, this.arena.track, input, c.stats, dtS);
  }

  private followCamera(dt: number): void {
    const player = this.arena.cars[0]!;
    const pb = player.body;
    this.camera.lerpTo(
      {
        x: pb.position.x + pb.velocity.x * CAMERA_LOOKAHEAD,
        y: pb.position.y + pb.velocity.y * CAMERA_LOOKAHEAD,
      },
      CAMERA_LERP_RATE,
      dt,
    );
    // Speed zoom: close in when slow, pull out at speed to see further ahead.
    const speedFrac =
      Math.abs(forwardSpeed(pb)) / Math.max(1, player.stats.maxSpeed);
    this.camera.zoomTo(
      speedZoom(speedFrac, CAMERA_ZOOM_SLOW, CAMERA_ZOOM_FAST) * this.viewScale,
      CAMERA_ZOOM_RATE,
      dt,
    );
  }

  private finalizeRace(): void {
    this.finished = true;
    this.audio.play("finish");
    this.confettiStartFrameMs = this.lastFrameMs;
    const position = this.playerPosition();
    const outcome = this.prog.recordRace({
      trackId: this.currentTrack().id,
      carId: this.prog.selectedCarId,
      laps: this.playerRace.lap,
      bestLapMs: this.playerRace.bestLapMs,
      bestLapGhost: this.playerRace.bestGhost,
      finished: true,
      position,
      fieldSize: this.arena.cars.length,
    });
    // A new record replaces the ghost: show (and next time chase) that one.
    this.ghost = this.prog.ghostFor(this.currentTrack().id);
    this.lastResults = {
      position,
      total: this.arena.cars.length,
      bestLapMs: this.playerRace.bestLapMs,
      outcome,
      parMs: this.currentTrack().parLapMs,
      unlockedCarName:
        outcome.unlockedCar === null
          ? undefined
          : (carById(outcome.unlockedCar)?.name ?? outcome.unlockedCar),
    };
    this.save();
    this.showResults();
  }

  /**
   * Live Pn for the HUD: count rivals ahead on the road. Finished cars rank by
   * finish time; everyone else by distance raced (lap count alone left the
   * whole first lap a tie, which always read P1).
   */
  private playerPosition(): number {
    const me = this.playerRace;
    const mine = me.progress(this.arena.cars[0]!.body.position);
    let ahead = 0;
    for (const r of this.racers) {
      const theirs = r.race;
      if (me.finished) {
        if (theirs.finished && theirs.finishMs < me.finishMs) ahead += 1;
      } else if (
        theirs.finished ||
        theirs.progress(r.car.body.position) > mine
      ) {
        ahead += 1;
      }
    }
    return ahead + 1;
  }

  // --- rendering -------------------------------------------------------

  private renderScene(): void {
    const p = this.arena.cars[0]!;
    const scene: RenderScene = {
      camera: this.camera,
      track: this.arena.track,
      car: p.body,
      race: this.playerRace,
      speed: forwardSpeed(p.body),
      nowMs: this.clockMs,
      rivals: this.arena.cars.filter((c) => !c.isPlayer).map((c) => c.body),
      position: this.playerPosition(),
      total: this.arena.cars.length,
      skidMarks: this.skid.marks,
      ghost: this.ghost,
      confettiAgeMs:
        this.confettiStartFrameMs === null
          ? undefined
          : this.lastFrameMs - this.confettiStartFrameMs,
      fps: this.fps,
      look: this.carLook(),
      rivalLook: rivalCarFor(this.arena.track.def).look,
      controls: {
        steer: this.lastInput.steer,
        braking: this.lastInput.brake > 0,
      },
      rivalControls: this.racers.map((r) => ({
        steer: r.input.steer,
        braking: r.input.brake > 0,
      })),
      // The race HUD belongs to a race (and its results); on the menus it
      // just peeks out around the panels.
      hud: this.screen === "race" || this.screen === "results",
      startClockMs: this.startClock(),
      ...this.chaseView(),
    };
    this.renderer.render(scene);
  }

  /**
   * The continuous voices, once per frame: the player's engine while a race
   * is live (on the grid too — rev it at the lights) and tyre squeal while
   * sliding. Silent on the menus, while paused and after the finish.
   */
  private presentAudio(): void {
    if (this.screen !== "race" || this.paused || this.finished) {
      this.audio.setEngine?.(null);
      this.audio.setSkid?.(0);
      return;
    }
    const p = this.arena.cars[0]!;
    const top = Math.max(1, p.stats.maxSpeed);
    this.audio.setEngine?.(
      engineFor(
        Math.abs(forwardSpeed(p.body)) / top,
        this.lastInput.throttle,
        this.enginePitch(),
      ),
    );
    this.audio.setSkid?.(slipAmount(p.body, { maxSpeed: top }));
  }

  /**
   * The lap to chase: this race's best once it beats the saved record, else
   * the saved record's ghost (empty until there is one).
   */
  private chaseGhost(): Ghost {
    const live = this.playerRace;
    if (
      live.bestGhost.length > 1 &&
      live.bestLapMs < this.prog.bestLap(this.currentTrack().id)
    )
      return live.bestGhost;
    return this.ghost;
  }

  /**
   * The ghost car (replaying the chased lap in step with the player's lap
   * clock) and the live split vs it — racing only, once the lights are green.
   * The ghost waits on the line until the player moves, and fades out once
   * its lap is done.
   */
  private chaseView(): Pick<RenderScene, "ghostCar" | "splitMs"> {
    if (this.screen !== "race" || this.countdownMs > 0) return {};
    const ghost = this.chaseGhost();
    const lapMs = currentLapTimeMs(this.playerRace, this.clockMs);
    const pose = sampleGhost(ghost, lapMs);
    if (ghost.length < 2 || pose === null) return {};
    const over = lapMs - ghost[ghost.length - 1].t;
    const alpha = Math.max(0, Math.min(1, 1 - over / 1000));
    if (this.splitsFor !== ghost) {
      const race = this.playerRace;
      this.splits = buildSplits(ghost, (q) => race.arcOf(q), race.lapLength);
      this.splitsFor = ghost;
    }
    const at = ghostTimeAt(
      this.splits,
      this.playerRace.lapProgress(this.arena.cars[0]!.body.position),
    );
    return {
      ghostCar: { ...pose, alpha },
      splitMs: lapMs > 0 && at !== null ? lapMs - at : undefined,
    };
  }

  /**
   * Time relative to the start signal, for the start lights: negative while
   * counting down, then the race clock after GO. Undefined off a race (or
   * with the countdown disabled), so no lights are drawn.
   */
  private startClock(): number | undefined {
    if (this.screen !== "race" || this.countdownTotalMs === 0) return undefined;
    return this.countdownMs > 0 ? -this.countdownMs : this.clockMs;
  }

  // --- UI plumbing -----------------------------------------------------

  private onClick(e: Event): void {
    const target = e.target as HTMLElement | null;
    if (target === null) return;
    const el = target.closest(
      "[data-action],[data-selectcar],[data-selecttrack],[data-buy],[data-switchcar],[data-bind]",
    ) as HTMLElement | null;
    if (el === null) return;
    this.audio.play("click");

    const action = el.getAttribute("data-action");
    // Leaving How to Play either way (to the menu, or straight into a race)
    // means it has been seen.
    if (this.screen === "onboarding") this.markOnboarded();
    if (action === "start" || action === "raceagain" || action === "restart")
      this.startRace();
    else if (action === "garage") this.showGarage();
    else if (action === "menu") this.showMenu();
    else if (action === "quit") this.backToMenu();
    else if (action === "pause") this.pause();
    else if (action === "resume") this.resume();
    else if (action === "howto") this.showOnboarding();
    else if (action === "close-onboarding") this.showMenu();
    else if (action === "settings") this.showSettings();
    else if (action === "close-settings") this.showMenu();
    else if (action === "toggle-colorblind")
      this.commitSettings({
        ...this.settings,
        colorMode: toggleColorMode(this.settings.colorMode),
      });
    else if (action === "cycle-hud")
      this.commitSettings({
        ...this.settings,
        hudSize: nextHudSize(this.settings.hudSize),
      });
    else if (action === "reset-settings")
      this.commitSettings({
        ...this.settings,
        keyMap: defaultSettings().keyMap,
      });
    else if (action === "toggle-sound") {
      this.commitSettings({ ...this.settings, muted: !this.settings.muted });
      // Mid-race the overlay's button shows the state; redraw it (which
      // also drops its focus, so Space/Enter can't re-toggle it).
      if (this.screen === "race") this.showRaceOverlay();
    }

    // Selections and purchases are saved as they happen, not at the next
    // race's end — closing the tab must not undo a purchase.
    let changed = false;
    const selCar = el.getAttribute("data-selectcar");
    if (selCar !== null) {
      // An owned car is just selected; an unowned one is bought (which also
      // selects it) only if affordable — never raced for free.
      changed = this.prog.isCarOwned(selCar)
        ? this.prog.selectCar(selCar)
        : this.prog.unlockCar(selCar);
    }

    const selTrack = el.getAttribute("data-selecttrack");
    if (selTrack !== null) {
      const i = this.trackDefs.findIndex((t) => t.id === selTrack);
      if (i >= 0 && this.prog.isTrackUnlocked(i)) {
        this.prog.selectTrack(selTrack);
        changed = true;
      }
    }

    const sw = el.getAttribute("data-switchcar");
    if (sw !== null) changed = this.prog.selectCar(sw) || changed;

    const buySlot = el.getAttribute("data-buy");
    if (buySlot !== null)
      changed =
        this.prog.buyUpgrade(this.prog.selectedCarId, buySlot as SlotId) ||
        changed;

    if (changed) {
      this.save();
      // Show the chosen car/track (and its stats) behind the menus.
      this.resetPreview();
      this.syncPreviewCamera();
    }

    // Re-render whatever screen we're on so a just-made purchase shows up.
    // A "rebind" button arms a capture; onRebindKey binds the next key. Any
    // other click cancels a pending capture so a stray key can't remap.
    const bind = el.getAttribute("data-bind");
    if (bind !== null) {
      this.rebinding = bind as KeyAction;
      this.rebindNotice = null;
      this.showSettings();
      return;
    }
    this.rebinding = null;
    this.rebindNotice = null;

    if (this.screen === "menu") this.showMenu();
    else if (this.screen === "garage") this.showGarage();
    else if (this.screen === "settings") this.showSettings();
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
      bestLabel: isFinite(this.prog.bestLap(t.id))
        ? formatLap(this.prog.bestLap(t.id))
        : undefined,
      cleared: this.prog.isTrackCleared(t.id),
      unlocked: this.prog.isTrackUnlocked(i),
      selected: t.id === this.prog.selectedTrackId,
      vibe: t.vibe,
      difficulty: t.difficulty,
      rivals: rivalLabel(t),
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
        nextName: next?.name,
        nextDesc: next?.description,
      };
    });

    return {
      credits,
      cars,
      tracks: trackRows,
      statBars: statBars(this.currentStats()),
      upgrades,
      keyMap: this.settings.keyMap,
    };
  }

  // --- persistence -------------------------------------------------------

  /** Push the current theme to the renderer (palette + HUD size). */
  private applyTheme(): void {
    this.renderer.setSettings?.(this.settings.colorMode, this.settings.hudSize);
  }

  /** Build the settings UI view model from live prefs + capture state. */
  private settingsView(): SettingsView {
    return {
      colorMode: this.settings.colorMode,
      hudSize: this.settings.hudSize,
      muted: this.settings.muted,
      bindings: KEY_ACTIONS.map((a) => ({
        action: a,
        label: ACTION_LABELS[a],
        keys: this.settings.keyMap[a],
      })),
      rebinding: this.rebinding !== null,
      rebindingAction: this.rebinding,
      notice: this.rebindNotice ?? undefined,
    };
  }

  /** Persist a settings change, then refresh the input + renderer seams. */
  private commitSettings(next: Settings): void {
    this.settings = next;
    this.prog.setSettings(next);
    this.input.setKeyMap(next.keyMap);
    this.applyTheme();
    this.audio.setMuted(next.muted);
    this.save();
  }

  /**
   * Capture-phase keydown, active only while rebinding: the next plain key
   * codes a new binding (modifier combos are ignored; Escape cancels). The
   * event is swallowed so the driver input never sees a key we just assigned.
   */
  private onRebindKey(e: KeyboardEvent): void {
    if (this.rebinding === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code === "Escape") {
      this.rebinding = null;
      this.rebindNotice = null;
      this.showSettings();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // R / P / Q / Backspace already restart, pause or quit; keep capturing
    // and say why.
    if (isReservedCode(e.code)) {
      this.rebindNotice = `${keyLabel(e.code)} is reserved — press another key`;
      this.showSettings();
      return;
    }
    const action = this.rebinding;
    this.rebinding = null;
    this.rebindNotice = null;
    if (action === null) return;
    this.commitSettings(rebindSetting(this.settings, action, e.code));
    this.showSettings();
  }

  private save(): void {
    this.store.save(this.prog.snapshot());
  }
}
