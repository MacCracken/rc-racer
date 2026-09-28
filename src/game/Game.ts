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
  forwardSpeed,
  stepField,
  type Arena,
  type ArenaCar,
  type FieldStep,
} from "../physics/MatterCar.ts";
import { currentLapTimeMs, formatLap, RaceState } from "../race/RaceState.ts";
import { makeDriver } from "../race/AiDriver.ts";
import { tracks as DEFAULT_TRACKS } from "../track/tracks.ts";
import type { TrackDef } from "../track/Track.ts";
import { buildTrack } from "../track/Track.ts";
import { conditionsOf, conditionTags } from "../track/conditions.ts";
import { outlineOf } from "../track/outline.ts";
import {
  carById,
  carClasses as DEFAULT_CARS,
  freshBase,
  type CarClass,
} from "./cars.ts";
import { CLEAR_POSITION, Progression } from "./progression.ts";
import { rivalCarFor, rivalField, rivalLabel } from "./rivals.ts";
import {
  UPGRADE_TREE,
  applyBuild,
  nextTier,
  statBars,
  statGains,
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
import { ReplayRecorder, type CarPose } from "../race/Replay.ts";
import { ReplayPlayer } from "../race/ReplayPlayer.ts";
import { buildSplits, ghostTimeAt, type Splits } from "../race/Split.ts";
import {
  CALLOUT_MS,
  lapCallout,
  WrongWay,
  type Callout,
} from "../race/Callouts.ts";
import {
  CAR_LENGTH,
  CAR_WIDTH,
  CAMERA_FRAME_PX,
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
  recordsHtml,
  resultsHtml,
  raceOverlay,
  pauseHtml,
  replayHtml,
  onboardingHtml,
  settingsHtml,
  formatPar,
  THUMB_H,
  THUMB_W,
  type Screen,
  type UiModel,
  type CarRow,
  type TrackRow,
  type UpgradeRow,
  type ResultsView,
  type StandingRow,
} from "../ui/ui.ts";
import type { Vec2 } from "../core/vec.ts";
import { MenuNav } from "../ui/MenuNav.ts";
import { backStep, MenuInput } from "../ui/MenuInput.ts";
import { Records } from "./records.ts";
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

/** A rival: its body + the race and driver state the autopilot feeds it. */
interface Racer {
  car: ArenaCar;
  race: RaceState;
  driver: (d: BodyState, traffic: readonly BodyState[]) => InputState;
  /** Every other car on the road, for the autopilot to race around. */
  traffic: BodyState[];
  /** Last input the autopilot gave, for the rival's wheels + brake lights. */
  input: InputState;
}

/** Slowest knock (px/s into a wall or car) worth a sound… */
const KNOCK_MIN_SPEED = 30;
/** …and the least time between two (race ms), so a scrape isn't a drumroll. */
const KNOCK_GAP_MS = 140;

/**
 * Camera zoom multiplier for a `w` x `h` css-px viewport (see `viewScale`):
 * the short side over `CAMERA_FRAME_PX`, within [0.5, 3].
 */
export function viewScaleFor(w: number, h: number): number {
  return Math.max(0.5, Math.min(3, Math.min(w, h) / CAMERA_FRAME_PX));
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
  /** Also inside `input`; held here to poll its buttons (pause, menus). */
  private gamepad: GamepadInput;
  /** Menus by d-pad, stick or keys: focus movement and restoring… */
  private readonly nav: MenuNav;
  /** …and what the keys and pad do there (`menus` drives `nav`). */
  private readonly menus: MenuInput;
  /** Also inside `input`; held here to re-light buttons on a re-render. */
  private touch: TouchInput;
  private clockMs = 0;
  private lastFrameMs = 0;
  private frameHandle: number | null = null;
  private fps = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  /** Pixel density the canvas was last sized for (0 = not yet). */
  private dpr = 0;
  /**
   * Zoom multiplier for the screen: the camera's zooms are tuned for a short
   * side of `CAMERA_FRAME_PX`, and scale with it, so every screen frames the
   * same stretch of track. A phone pulls out; a big monitor closes in rather
   * than showing the whole circuit around a speck of a car.
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
  /** Records the race in progress, for the results' replay… */
  private recorder = new ReplayRecorder();
  /** …and plays the last finished one back. */
  private readonly replays = new ReplayPlayer();
  /** The Records screen's state (what was just copied). */
  private readonly records = new Records();

  private onClickBound: (e: Event) => void;
  private onKeyDownBound: (e: KeyboardEvent) => void;
  private onResizeBound: () => void;
  private onFocusLostBound: () => void;
  private onVisibilityBound: () => void;
  private skid: SkidState;
  private audio: IAudio;
  private prevLap = 0;
  /** Race clock (ms) of the last knock played (see `playImpacts`). */
  private lastKnockMs = -Infinity;
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
  /** The lap news across the middle of the screen (see `lapCallout`). */
  private callout: Callout | null = null;
  /** Heading the wrong way round, and what notices it. */
  private wrongWay = false;
  private wrongWayTracker = new WrongWay();
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
    this.touch = new TouchInput();
    this.input = new CompositeInput([
      new KeyboardInput(),
      this.gamepad,
      this.touch,
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
    // The main menu comes back to the button you left it by; other screens
    // open on their main action.
    this.nav = new MenuNav(this.uiRoot, { keepPlace: ["menu"] });
    this.menus = new MenuInput(this.nav);
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
    this.nav.attach();
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
    this.nav.detach();
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
  }

  /**
   * Global shortcuts. In a race R restarts and Esc / P pause (and resume);
   * Q / Backspace — or Esc on any other screen — go back to the menu. On a
   * menu (the pause menu too) the arrows, or the driving keys, move between
   * buttons and Enter / Space press the focused one.
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
      if (!e.repeat) this.togglePause();
      return;
    }
    if (this.onMenus() && this.menus.key(e, this.settings.keyMap)) return;
    // A fresh press only: a held Esc's auto-repeat would carry on from the
    // replay through the results it just returned to.
    const quitting =
      !e.repeat &&
      (e.code === "Escape" || e.code === "Backspace" || e.code === "KeyQ");
    if (quitting && this.screen === "replay") {
      this.audio.play("click");
      this.exitReplay();
      return;
    }
    if (quitting && this.screen !== "menu") {
      // Leaving How to Play by key counts as seen, as a click does.
      if (this.screen === "onboarding") this.markOnboarded();
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
    this.pollGamepad(nowMs);
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
    // A race re-frames itself every step; the menus' backdrop is set once,
    // so re-frame it now (e.g. a phone rotated on the menu).
    if (
      this.screen !== "race" &&
      this.screen !== "results" &&
      this.screen !== "replay"
    )
      this.syncPreviewCamera();
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
    this.render(menuHtml(this.uiModel()));
    this.syncPreviewCamera();
  }

  private showGarage(): void {
    this.screen = "garage";
    this.render(garageHtml(this.uiModel()));
    this.syncPreviewCamera();
  }

  private showRecords(): void {
    this.screen = "records";
    this.render(recordsHtml(this.records.view(this.prog, this.trackDefs)));
    this.syncPreviewCamera();
  }

  private showResults(): void {
    if (this.lastResults === null) return;
    this.screen = "results";
    this.render(resultsHtml(this.lastResults));
  }

  private showOnboarding(): void {
    this.screen = "onboarding";
    this.render(onboardingHtml(this.settings.keyMap));
  }

  private showSettings(): void {
    this.screen = "settings";
    this.render(settingsHtml(this.settingsView()));
  }

  /** Is a screen of menus up (anything but a race in progress)? */
  private onMenus(): boolean {
    return this.screen !== "race" || this.paused;
  }

  /**
   * Install a screen's HTML (`screen` already set), then let the menu input
   * latch what's still held from a race and hand focus back to a key or pad
   * player.
   */
  private render(html: string): void {
    this.uiRoot.innerHTML = html;
    this.menus.shown(this.screen, !this.onMenus(), this.gamepad);
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
      { mass: carById(this.prog.selectedCarId)?.mass },
    );
    this.ghost = this.prog.ghostFor(track.def.id);
    this.playerRace = new RaceState(this.arena.track, () => this.clockMs);
    // One racer per rival, in the arena's order (the player is cars[0]).
    const cars = this.arena.cars;
    this.racers = cars.slice(1).map((c) => ({
      car: c,
      race: new RaceState(this.arena.track, () => this.clockMs),
      driver: makeDriver(track, {
        pace: c.pace ?? 0.8,
        lookahead: 0.05,
        lane: c.lane,
        car: c.stats,
      }),
      traffic: cars.filter((o) => o !== c).map((o) => o.body),
      input: neutralInput(),
    }));
    this.finished = false;
    this.paused = false;
    this.lastResults = null;
    this.skid = createSkid();
    this.lastInput = neutralInput();
    this.prevLap = 0;
    this.lastKnockMs = -Infinity;
    this.callout = null;
    this.wrongWay = false;
    this.wrongWayTracker = new WrongWay();
    this.recorder = new ReplayRecorder();
    this.recorder.record(0, this.poses());
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

  /** The results' "Next: <track>": select the ladder's next track, race it. */
  private raceNextTrack(): void {
    const next = this.lastResults?.nextTrack;
    if (next === undefined) return;
    this.prog.selectTrack(next.id);
    this.save();
    this.startRace();
  }

  /**
   * The pad, once a frame. Racing, Start pauses (and resumes). On any menu —
   * the pause menu too — the d-pad or stick moves between buttons, A presses
   * the focused one, B backs out, and Start presses the screen's main action.
   */
  private pollGamepad(nowMs = performance.now()): void {
    const press = this.gamepad.poll(nowMs);
    if (this.screen === "race" && press.start) {
      this.togglePause();
      return;
    }
    if (this.onMenus() && this.menus.pad(press) === "back") this.padBack();
  }

  /** B on a menu: take the step back `backStep` names for this screen. */
  private padBack(): void {
    const step = backStep({
      screen: this.screen,
      paused: this.paused,
      rebinding: this.rebinding !== null,
    });
    if (step === "exit-replay") this.exitReplay();
    else if (step === "resume") this.togglePause();
    else if (step === "cancel-rebind") {
      this.rebinding = null;
      this.rebindNotice = null;
      this.showSettings();
    } else if (step === "to-menu") {
      if (this.screen === "onboarding") this.markOnboarded();
      this.audio.play("click");
      this.backToMenu();
    }
  }

  /** Esc / P / a gamepad's Start: pause a race, or resume a paused one. */
  private togglePause(): void {
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
    this.render(
      this.paused
        ? pauseHtml(this.settings.muted)
        : raceOverlay(this.settings.keyMap, this.settings.muted),
    );
    // New buttons: light the ones a finger is still holding.
    this.touch.refresh();
  }

  // --- simulation ------------------------------------------------------

  /** Fixed-timestep tick; `dt` is in seconds. */
  private onStep(dt: number): void {
    if (this.screen === "replay") {
      // Reaching the flag swaps Pause for "Watch again".
      if (this.replays.step(dt, this.arena.cars, this.skid)) this.showReplay();
      this.followCamera(dt);
      return;
    }
    if (this.screen !== "race" || this.finished || this.paused) return;
    if (this.countdownMs > 0) {
      this.stepCountdown(dt);
      return;
    }
    this.clockMs += dt * 1000;

    // The whole field moves at once, then contact settles between the cars.
    // Each car's pre-step pose is captured so its gate test sees this tick's
    // (prev -> cur) segment. (Feeding a stored older pose froze the segment
    // at [grid, now] forever, so no real start/finish crossing registered.)
    const cars = this.arena.cars;
    const p = cars[0]!;
    const prev: Vec2[] = cars.map((c) => ({
      x: c.body.position.x,
      y: c.body.position.y,
    }));
    this.lastInput = this.input.sample();
    for (const r of this.racers) r.input = r.driver(r.car.body, r.traffic);
    const hits = stepField(
      this.arena,
      [this.lastInput, ...this.racers.map((r) => r.input)],
      dt,
    );
    this.playerRace.update(prev[0], p.body.position, p.body.angle);
    this.racers.forEach((r, i) =>
      r.race.update(prev[i + 1], r.car.body.position),
    );
    this.playImpacts(hits);

    // Tire-smoke trail: lay skids while the player slides, fade them over time.
    sampleDrift(this.skid, p.body, {
      carLength: CAR_LENGTH,
      carWidth: CAR_WIDTH,
      maxSpeed: p.stats.maxSpeed,
    });
    ageMarks(this.skid, dt);

    if (this.recorder.due(this.clockMs))
      this.recorder.record(this.clockMs, this.poses());

    // Camera follows the player (look-ahead along heading) so the track stays framed.
    this.followCamera(dt);

    if (this.playerRace.lap > this.prevLap) {
      // The final lap gets the finish chime instead (not both at once).
      if (!this.playerRace.finished) this.audio.play("lap");
      this.prevLap = this.playerRace.lap;
      this.callout =
        lapCallout(
          this.playerRace,
          this.arena.track.laps,
          this.prog.bestLap(this.currentTrack().id),
          this.clockMs,
        ) ?? this.callout;
    }
    this.wrongWay = this.wrongWayTracker.update(
      this.playerRace.arcOf(p.body.position),
      this.playerRace.lapLength,
      dt * 1000,
      forwardSpeed(p.body),
    );
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

  /**
   * A knock for the player's own contacts — a wall, or another car — louder
   * the harder the hit. Rivals knocking each other stay quiet, and scraping
   * along a wall doesn't re-trigger it every step.
   */
  private playImpacts(hits: FieldStep): void {
    const wall = hits.walls[0] ?? 0;
    let car = 0;
    for (const c of hits.contacts)
      if (c.a === 0 || c.b === 0) car = Math.max(car, c.speed);
    const speed = Math.max(wall, car);
    if (
      speed < KNOCK_MIN_SPEED ||
      this.clockMs - this.lastKnockMs < KNOCK_GAP_MS
    )
      return;
    this.lastKnockMs = this.clockMs;
    this.audio.play(
      car >= wall ? "bump" : "hit",
      Math.min(0.45, 0.08 + speed / 500),
    );
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
    this.recorder.record(this.clockMs, this.poses()); // the flag itself
    this.replays.load(this.recorder.finish());
    this.audio.play("finish");
    const position = this.playerPosition();
    // Confetti for a podium: the finish that counts.
    this.confettiStartFrameMs =
      position <= CLEAR_POSITION ? this.lastFrameMs : null;
    const outcome = this.prog.recordRace({
      trackId: this.currentTrack().id,
      carId: this.prog.selectedCarId,
      laps: this.playerRace.lap,
      bestLapMs: this.playerRace.bestLapMs,
      bestLapGhost: this.playerRace.bestGhost,
      finished: true,
      position,
      fieldSize: this.arena.cars.length,
      at: Date.now(),
    });
    // A new record replaces the ghost: show (and next time chase) that one.
    this.ghost = this.prog.ghostFor(this.currentTrack().id);
    const i = this.trackDefs.findIndex((t) => t.id === this.currentTrack().id);
    const next = this.trackDefs[i + 1];
    const nextOpen = next !== undefined && this.prog.isTrackUnlocked(i + 1);
    this.lastResults = {
      standings: this.standings(),
      lockedNext: next !== undefined && !nextOpen ? next.name : undefined,
      position,
      total: this.arena.cars.length,
      bestLapMs: this.playerRace.bestLapMs,
      outcome,
      parMs: outcome.parMs,
      unlockedCarName:
        outcome.unlockedCar === null
          ? undefined
          : (carById(outcome.unlockedCar)?.name ?? outcome.unlockedCar),
      nextTrack: nextOpen ? { id: next.id, name: next.name } : undefined,
      canReplay: this.replays.ready,
      trackName: this.currentTrack().name,
    };
    this.save();
    this.showResults();
  }

  /**
   * The finishing order at the player's flag, with each car's gap to the
   * winner. A rival already home has its finish time; one still out on the
   * track is timed home at its average speed so far (at the flag, a few
   * tenths either way), so the order matches the position the HUD read.
   */
  private standings(): StandingRow[] {
    const now = this.clockMs;
    const total = this.playerRace.lapLength * this.arena.track.laps;
    const timed = this.arena.cars.map((c, i) => {
      const race = i === 0 ? this.playerRace : this.racers[i - 1].race;
      let ms = race.finishMs;
      if (!race.finished) {
        const done = race.progress(c.body.position);
        ms = done > 0 ? now + ((total - done) * now) / done : Infinity;
      }
      return { name: i === 0 ? "You" : c.label, you: i === 0, ms };
    });
    timed.sort((a, b) => a.ms - b.ms || (a.you ? -1 : b.you ? 1 : 0));
    const winner = timed[0].ms;
    return timed.map((t, k) => ({
      place: k + 1,
      name: t.name,
      you: t.you,
      time:
        k === 0
          ? formatLap(t.ms)
          : isFinite(t.ms)
            ? `+${((t.ms - winner) / 1000).toFixed(2)}s`
            : "–",
    }));
  }

  /** Every car's pose right now, player first, as the replay records it. */
  private poses(): CarPose[] {
    const inputs = [this.lastInput, ...this.racers.map((r) => r.input)];
    return this.arena.cars.map((c, i) => ({
      x: c.body.position.x,
      y: c.body.position.y,
      angle: c.body.angle,
      steer: inputs[i]?.steer ?? 0,
      braking: (inputs[i]?.brake ?? 0) > 0,
    }));
  }

  // --- replay ----------------------------------------------------------

  /** The results' "Replay": watch the race just run, from the green light. */
  private watchReplay(): void {
    if (!this.replays.ready) return;
    this.screen = "replay";
    this.skid = createSkid();
    this.replays.watch(this.arena.cars, this.skid);
    const p = this.arena.cars[0]!.body;
    this.camera.view = { x: p.position.x, y: p.position.y };
    this.showReplay();
  }

  private showReplay(): void {
    this.render(replayHtml(this.replays.state()));
  }

  /** Back to the results, the field parked where the race finished. */
  private exitReplay(): void {
    this.replays.toEnd(this.arena.cars, this.skid);
    this.screen = "results";
    this.showResults();
  }

  /** Play / pause, or from the flag, watch again (with a fresh skid trail). */
  private toggleReplay(): void {
    if (this.replays.toggle()) this.skid = createSkid();
    this.showReplay();
  }

  private cycleReplaySpeed(): void {
    this.replays.cycleSpeed();
    this.showReplay();
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
    // A replay draws the wheels and brake lights it recorded.
    const replaying = this.screen === "replay";
    const scene: RenderScene = {
      camera: this.camera,
      track: this.arena.track,
      car: p.body,
      race: this.playerRace,
      speed: forwardSpeed(p.body),
      nowMs: this.clockMs,
      timeMs: this.lastFrameMs,
      rivals: this.arena.cars.filter((c) => !c.isPlayer).map((c) => c.body),
      position: this.playerPosition(),
      total: this.arena.cars.length,
      skidMarks: this.skid.marks,
      ghost: this.ghost,
      confettiAgeMs:
        this.confettiStartFrameMs === null
          ? undefined
          : this.lastFrameMs - this.confettiStartFrameMs,
      fps: this.settings.showFps ? this.fps : undefined,
      look: this.carLook(),
      rivalLook: rivalCarFor(this.arena.track.def).look,
      controls: replaying
        ? (this.replays.controls[0] ?? { steer: 0, braking: false })
        : { steer: this.lastInput.steer, braking: this.lastInput.brake > 0 },
      rivalControls: replaying
        ? this.replays.controls.slice(1)
        : this.racers.map((r) => ({
            steer: r.input.steer,
            braking: r.input.brake > 0,
          })),
      // The race HUD belongs to a race (and its results); on the menus it
      // just peeks out around the panels.
      hud: this.screen === "race" || this.screen === "results",
      startClockMs: this.startClock(),
      replay: replaying ? this.replays.badge() : undefined,
      artZoom: CAMERA_ZOOM_SLOW * this.viewScale,
      ...this.raceNews(),
      ...this.chaseView(),
    };
    this.renderer.render(scene);
  }

  /**
   * The continuous voices, once per frame: the player's engine while a race
   * is live (on the grid too — rev it at the lights), tyre squeal while
   * sliding, and rain on a wet track. Silent on the menus, while paused and
   * after the finish.
   */
  private presentAudio(): void {
    if (this.screen !== "race" || this.paused || this.finished) {
      this.audio.setEngine?.(null);
      this.audio.setSkid?.(0);
      this.audio.setRain?.(false);
      return;
    }
    this.audio.setRain?.(conditionsOf(this.arena.track.def).weather === "rain");
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
   * The race's callouts for the HUD: the latest lap news while it's fresh,
   * and the wrong-way warning — racing only, not over the results.
   */
  private raceNews(): Pick<RenderScene, "callout" | "wrongWay"> {
    if (this.screen !== "race" || this.finished) return {};
    const c = this.callout;
    const age = c === null ? Infinity : this.clockMs - c.atMs;
    return {
      callout:
        c !== null && age < CALLOUT_MS
          ? { title: c.title, detail: c.detail, tone: c.tone, ageMs: age }
          : undefined,
      wrongWay: this.wrongWay || undefined,
    };
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
      "[data-action],[data-selectcar],[data-selecttrack],[data-buy],[data-switchcar],[data-bind],[data-share]",
    ) as HTMLElement | null;
    if (el === null) return;
    this.audio.play("click");

    const action = el.getAttribute("data-action");
    // Leaving How to Play either way (to the menu, or straight into a race)
    // means it has been seen.
    if (this.screen === "onboarding") this.markOnboarded();
    if (action === "start" || action === "raceagain" || action === "restart")
      this.startRace();
    else if (action === "nexttrack") this.raceNextTrack();
    else if (action === "replay") this.watchReplay();
    else if (action === "replay-toggle") this.toggleReplay();
    else if (action === "replay-speed") this.cycleReplaySpeed();
    else if (action === "replay-exit") this.exitReplay();
    else if (action === "garage") this.showGarage();
    else if (action === "records") {
      this.records.reset();
      this.showRecords();
    }
    // From the results (or a garage visited from them) the backdrop is the
    // finished race: park a fresh preview car, as Esc does.
    else if (action === "menu" || action === "quit") this.backToMenu();
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
    else if (action === "toggle-fps")
      this.commitSettings({
        ...this.settings,
        showFps: !this.settings.showFps,
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

    const share = el.getAttribute("data-share");
    if (share !== null)
      this.records.share(
        this.prog,
        this.trackDefs,
        share,
        () => this.screen === "records",
        () => this.showRecords(),
      );

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
      lockHint:
        i > 0
          ? `Finish top 3 at ${this.trackDefs[i - 1].name} to unlock`
          : undefined,
      tags: conditionTags(conditionsOf(t)),
      outline: outlineOf(t, THUMB_W, THUMB_H),
    }));

    const carId = this.prog.selectedCarId;
    const carOwned: OwnedUpgrades = this.prog.upgradesFor(carId);
    const stats = this.currentStats();
    const upgrades: UpgradeRow[] = UPGRADE_TREE.map((s) => {
      const next = nextTier(s.id, carOwned);
      const level = carOwned[s.id] ?? 0;
      return {
        slot: s.id,
        name: s.name,
        level,
        maxLevel: s.tiers.length,
        nextCost: next?.cost ?? 0,
        maxed: next === null,
        canAfford: next !== null && credits >= next.cost,
        nextName: next?.name,
        nextDesc: next?.description,
        // What the next tier would do to the bars, before it's bought.
        gains:
          next === null
            ? []
            : statGains(
                stats,
                applyBuild(freshBase(carId), {
                  ...carOwned,
                  [s.id]: level + 1,
                }),
              ),
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
      showFps: this.settings.showFps,
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
