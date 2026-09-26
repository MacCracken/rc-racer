import { describe, it, expect } from "vitest";
import { Game } from "../../src/game/Game.ts";
import { Progression } from "../../src/game/progression.ts";
import { MemorySaveStore } from "../../src/game/save.ts";
import type { Settings } from "../../src/game/settings.ts";
import { makeDriver } from "../../src/race/AiDriver.ts";
import type { RaceState } from "../../src/race/RaceState.ts";
import type { Arena } from "../../src/physics/MatterCar.ts";
import {
  neutralInput,
  type IInput,
  type InputState,
} from "../../src/core/Input.ts";
import type { IRenderer, RenderScene } from "../../src/core/types.ts";
import {
  CAMERA_ZOOM_FAST,
  CAMERA_ZOOM_SLOW,
  FIXED_DT,
} from "../../src/core/tuning.ts";
import { speedZoom, type Camera } from "../../src/core/Camera.ts";
import { NullAudio } from "../../src/core/Audio.ts";
import { freshUpgrades, SLOTS } from "../../src/game/upgrades.ts";

/**
 * Director-level regressions: the Game wiring (screen flow, clicks, clock,
 * saving) driven headless. No DOM: a stub UI root, a recording renderer, and an
 * autopilot (or a fixed input) standing in for the keyboard.
 */

/** The private surface these tests drive. */
interface GameInternals {
  screen: string;
  clockMs: number;
  paused: boolean;
  camera: Camera;
  input: IInput;
  arena: Arena;
  playerRace: RaceState;
  settings: Settings;
  startRace(): void;
  onStep(dt: number): void;
  onClick(e: { target: unknown }): void;
  onKeyDown(e: Partial<KeyboardEvent>): void;
  onRebindKey(e: Partial<KeyboardEvent>): void;
  playerPosition(): number;
  renderScene(): void;
  pause(): void;
}

/**
 * A headless Game. The start countdown is off by default so a test's first
 * step is already racing; countdown tests turn it back on.
 */
function makeGame(
  credits = 0,
  prog = Progression.fresh(),
  opts: { countdownMs?: number } = {},
) {
  const store = new MemorySaveStore();
  const audio = new NullAudio();
  prog.setCredits(credits);
  const scenes: RenderScene[] = [];
  const renderer: IRenderer = {
    resize() {},
    render: (s) => void scenes.push(s),
  };
  const uiRoot = {
    innerHTML: "",
    addEventListener() {},
    removeEventListener() {},
  } as unknown as HTMLElement;
  const game = new Game(prog, {
    renderer,
    uiRoot,
    store,
    audio,
    rivals: 3,
    countdownMs: opts.countdownMs ?? 0,
  });
  const lastScene = (): RenderScene | undefined => scenes[scenes.length - 1];
  return {
    g: game as unknown as GameInternals,
    prog,
    store,
    audio,
    uiRoot,
    lastScene,
  };
}

/** Hold the throttle (and optionally a steer) — a stand-in for the keyboard. */
const floorIt =
  (steer = 0) =>
  (): InputState => ({ ...neutralInput(), throttle: 1, steer });

/** Step the sim for `seconds` of game time. */
function run(g: GameInternals, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) g.onStep(FIXED_DT);
}

/** Swap the keyboard for a scripted input. */
function drive(g: GameInternals, sample: () => InputState): void {
  g.input = { sample, attach() {}, detach() {}, setKeyMap() {} };
}

/** Let the rivals' autopilot drive the player's car too. */
function autopilot(g: GameInternals): void {
  const ai = makeDriver(g.arena.track, { pace: 0.85, lookahead: 0.05 });
  drive(g, () => ai(g.arena.cars[0]!.body));
}

function runToFinish(g: GameInternals, capS = 120): void {
  for (let i = 0; i < capS / FIXED_DT && g.screen === "race"; i++)
    g.onStep(FIXED_DT);
}

/** Click a stand-in element carrying `data-*` attributes. */
function click(g: GameInternals, attrs: Record<string, string>): void {
  const el = {
    closest: () => el,
    getAttribute: (k: string) => attrs[k] ?? null,
  };
  g.onClick({ target: el });
}

/** A keydown stand-in for the handlers under test. */
const keydown = (
  code: string,
  extra: Partial<KeyboardEvent> = {},
): Partial<KeyboardEvent> => ({
  code,
  key: code,
  repeat: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  preventDefault() {},
  stopPropagation() {},
  ...extra,
});

describe("Game — race clock", () => {
  it("'Race again' times the new race from zero (a stale clock made lap 1 negative)", () => {
    const { g, prog } = makeGame();
    g.startRace();
    autopilot(g);
    runToFinish(g);
    expect(g.screen).toBe("results");
    const record = prog.bestLap("overture");
    const ghostLength = prog.ghostFor("overture").length;
    expect(record).toBeGreaterThan(0);
    expect(ghostLength).toBeGreaterThan(1);

    click(g, { "data-action": "raceagain" });
    expect(g.playerRace.lapStartMs).toBe(0);
    autopilot(g);
    runToFinish(g);
    expect(g.screen).toBe("results");
    for (const t of g.playerRace.lapTimesMs) expect(t).toBeGreaterThan(0);
    // The saved record + ghost survive: no negative "record" overwrote them.
    expect(prog.bestLap("overture")).toBe(record);
    expect(prog.ghostFor("overture").length).toBe(ghostLength);
  });

  it("R restarts the race once per press, ignoring key auto-repeat", () => {
    const { g } = makeGame();
    g.startRace();
    drive(g, neutralInput);
    for (let i = 0; i < 60; i++) g.onStep(FIXED_DT);
    const clock = g.clockMs;
    expect(clock).toBeGreaterThan(0);
    g.onKeyDown(keydown("KeyR", { repeat: true }));
    expect(g.clockMs).toBe(clock);
    g.onKeyDown(keydown("KeyR"));
    expect(g.clockMs).toBe(0);
  });

  it("leaves browser chords alone: ⌘R / Ctrl+R don't restart the race", () => {
    const { g } = makeGame();
    g.startRace();
    drive(g, neutralInput);
    for (let i = 0; i < 60; i++) g.onStep(FIXED_DT);
    const clock = g.clockMs;
    g.onKeyDown(keydown("KeyR", { metaKey: true }));
    g.onKeyDown(keydown("KeyR", { ctrlKey: true }));
    expect(g.clockMs).toBe(clock);
  });
});

describe("Game — live race position", () => {
  it("ranks by distance raced: a player still on the grid runs last", () => {
    const { g } = makeGame();
    g.startRace();
    drive(g, neutralInput);
    for (let i = 0; i < 2 / FIXED_DT; i++) g.onStep(FIXED_DT);
    // Every rival has pulled away; the old lap-time proxy tied the whole
    // field on lap 1 and always read P1.
    expect(g.playerPosition()).toBe(4);
  });
});

describe("Game — rivals come from the track, not your garage", () => {
  it("the field is identical whether you drive a stock sedan or a maxed brawler", () => {
    const rivalStats = (prog: Progression): unknown => {
      const { g } = makeGame(0, prog);
      g.startRace();
      return g.arena.cars.filter((c) => !c.isPlayer).map((c) => c.stats);
    };
    const stock = rivalStats(Progression.fresh());

    const rich = Progression.fresh();
    rich.setCredits(1e6);
    rich.unlockCar("brawler");
    const maxed = freshUpgrades();
    for (const s of SLOTS) maxed[s] = 4;
    rich.data.upgrades.brawler = maxed;
    const { g } = makeGame(0, rich);
    g.startRace();
    expect(g.arena.cars[0].stats.maxSpeed).toBeGreaterThan(250); // really maxed
    expect(rivalStats(rich)).toEqual(stock);
  });
});

describe("Game — speed zoom", () => {
  it("starts close in on the grid and pulls out as the car gets up to speed", () => {
    const { g } = makeGame();
    g.startRace();
    expect(g.camera.zoom).toBe(CAMERA_ZOOM_SLOW);
    autopilot(g);
    for (let i = 0; i < 3 / FIXED_DT; i++) {
      g.onStep(FIXED_DT);
      expect(g.camera.zoom).toBeLessThanOrEqual(CAMERA_ZOOM_SLOW);
      expect(g.camera.zoom).toBeGreaterThanOrEqual(CAMERA_ZOOM_FAST);
    }
    expect(g.camera.zoom).toBeLessThan(CAMERA_ZOOM_SLOW - 0.1);
  });

  it("maps speed to zoom: close when parked, wide at top speed, clamped", () => {
    expect(speedZoom(0, 0.8, 0.55)).toBe(0.8);
    expect(speedZoom(1, 0.8, 0.55)).toBe(0.55);
    expect(speedZoom(0.5, 0.8, 0.55)).toBeCloseTo(0.675, 10);
    expect(speedZoom(3, 0.8, 0.55)).toBe(0.55);
    expect(speedZoom(-1, 0.8, 0.55)).toBe(0.8);
  });
});

describe("Game — mute", () => {
  it("the Sound toggle silences audio and is saved", () => {
    const { g, audio, store } = makeGame();
    expect(audio.muted).toBe(false);
    click(g, { "data-action": "toggle-sound" });
    expect(audio.muted).toBe(true);
    expect(store.load()?.settings.muted).toBe(true);
    audio.play("lap");
    expect(audio.log.some((e) => e.ev === "lap")).toBe(false);
    click(g, { "data-action": "toggle-sound" });
    expect(audio.muted).toBe(false);
  });

  it("a saved mute is honoured from the first frame", () => {
    const prog = Progression.fresh();
    prog.setSettings({ ...prog.settings, muted: true });
    const { audio } = makeGame(0, prog);
    expect(audio.muted).toBe(true);
  });
});

describe("Game — garage economy", () => {
  it("clicking an unaffordable car neither selects nor unlocks it", () => {
    const { g, prog } = makeGame(100);
    click(g, { "data-selectcar": "brawler" });
    expect(prog.selectedCarId).toBe("street-sedan");
    expect(prog.isCarOwned("brawler")).toBe(false);
    expect(prog.credits).toBe(100);
  });

  it("clicking an affordable car buys + selects it, saved immediately", () => {
    const { g, prog, store } = makeGame(600);
    click(g, { "data-selectcar": "buggy" });
    expect(prog.isCarOwned("buggy")).toBe(true);
    expect(prog.selectedCarId).toBe("buggy");
    expect(store.load()?.ownedCars).toContain("buggy");
    expect(store.load()?.credits).toBe(100);
  });

  it("an upgrade purchase is saved immediately, not at the next race's end", () => {
    const { g, store } = makeGame(500);
    click(g, { "data-buy": "engine" });
    expect(store.load()?.upgrades["street-sedan"]?.engine).toBe(1);
    expect(store.load()?.credits).toBe(380);
  });
});

describe("Game — key rebinding", () => {
  it("won't capture a reserved key (Q quits), and keeps listening for another", () => {
    const { g } = makeGame();
    click(g, { "data-bind": "handbrake" });
    g.onRebindKey(keydown("KeyQ"));
    expect(g.settings.keyMap.handbrake).toEqual(["Space"]);
    g.onRebindKey(keydown("KeyE"));
    expect(g.settings.keyMap.handbrake).toEqual(["KeyE"]);
  });
});

describe("Game — render scene", () => {
  it("confetti belongs to the finish: none carries into the next race", () => {
    const { g, lastScene } = makeGame();
    g.startRace();
    autopilot(g);
    runToFinish(g);
    g.renderScene();
    expect(lastScene()?.confettiAgeMs).toBe(0);
    g.startRace();
    g.renderScene();
    expect(lastScene()?.confettiAgeMs).toBeUndefined();
  });

  it("shows the race HUD in a race, not behind the menus", () => {
    const { g, lastScene } = makeGame();
    g.renderScene();
    expect(lastScene()?.hud).toBe(false);
    g.startRace();
    g.renderScene();
    expect(lastScene()?.hud).toBe(true);
  });
});

describe("Game — start countdown", () => {
  it("holds the whole field on the grid until GO, beeping 3-2-1 then GO", () => {
    const { g, audio } = makeGame(0, Progression.fresh(), {
      countdownMs: 3000,
    });
    g.startRace();
    drive(g, floorIt());
    const grid = g.arena.cars.map((c) => ({ ...c.body.position }));
    run(g, 2.9);
    // Throttle held, yet nobody has moved and the race clock hasn't started.
    expect(g.clockMs).toBe(0);
    g.arena.cars.forEach((c, i) => expect(c.body.position).toEqual(grid[i]));
    run(g, 0.5);
    expect(g.clockMs).toBeGreaterThan(0);
    g.arena.cars.forEach((c, i) =>
      expect(c.body.position, `car ${i} left the grid`).not.toEqual(grid[i]),
    );
    const beeps = audio.log
      .map((e) => e.ev)
      .filter((ev) => ev === "count" || ev === "go");
    expect(beeps).toEqual(["count", "count", "count", "go"]);
  });

  it("shows the player's wheels turning on the grid without moving the car", () => {
    const { g, lastScene } = makeGame(0, Progression.fresh(), {
      countdownMs: 3000,
    });
    g.startRace();
    drive(g, floorIt(1));
    const heading = g.arena.cars[0].body.angle;
    run(g, 1);
    g.renderScene();
    expect(lastScene()?.controls?.steer).toBe(1);
    expect(g.arena.cars[0].body.angle).toBe(heading);
  });

  it("feeds the start lights T-minus, then time since GO — only in a race", () => {
    const { g, lastScene } = makeGame(0, Progression.fresh(), {
      countdownMs: 3000,
    });
    g.renderScene();
    expect(lastScene()?.startClockMs).toBeUndefined(); // menu
    g.startRace();
    drive(g, neutralInput);
    run(g, 1);
    g.renderScene();
    expect(lastScene()?.startClockMs).toBeCloseTo(-2000, 6);
    run(g, 2.5);
    g.renderScene();
    expect(lastScene()?.startClockMs).toBeGreaterThan(0);
  });

  it("R restarts the countdown from the top", () => {
    const { g, audio } = makeGame(0, Progression.fresh(), {
      countdownMs: 3000,
    });
    g.startRace();
    drive(g, neutralInput);
    run(g, 5);
    expect(g.clockMs).toBeGreaterThan(0);
    audio.log.length = 0;
    g.onKeyDown(keydown("KeyR"));
    run(g, 2.9);
    expect(g.clockMs).toBe(0);
    expect(audio.log.filter((e) => e.ev === "count")).toHaveLength(3);
  });
});

describe("Game — pause", () => {
  it("Esc pauses a race: clock and cars freeze until Esc or P resumes", () => {
    const { g, uiRoot } = makeGame();
    g.startRace();
    drive(g, floorIt());
    run(g, 1);
    g.onKeyDown(keydown("Escape"));
    expect(g.paused).toBe(true);
    expect(uiRoot.innerHTML).toContain('data-action="resume"');
    const clock = g.clockMs;
    const pos = { ...g.arena.cars[0].body.position };
    run(g, 1);
    expect(g.clockMs).toBe(clock);
    expect(g.arena.cars[0].body.position).toEqual(pos);

    g.onKeyDown(keydown("KeyP"));
    expect(g.paused).toBe(false);
    expect(uiRoot.innerHTML).toContain('data-action="pause"');
    run(g, 0.5);
    expect(g.clockMs).toBeGreaterThan(clock);
    expect(g.arena.cars[0].body.position).not.toEqual(pos);
  });

  it("a held Esc pauses once instead of flickering on key auto-repeat", () => {
    const { g } = makeGame();
    g.startRace();
    g.onKeyDown(keydown("Escape"));
    g.onKeyDown(keydown("Escape", { repeat: true }));
    expect(g.paused).toBe(true);
  });

  it("losing focus pauses a race, and only a race", () => {
    const { g } = makeGame();
    g.pause(); // what the blur / hidden-tab listeners call — on the menu
    expect(g.paused).toBe(false);
    g.startRace();
    g.pause();
    expect(g.paused).toBe(true);
  });

  it("freezes the countdown too, so the lights resume where they stopped", () => {
    const { g, lastScene } = makeGame(0, Progression.fresh(), {
      countdownMs: 3000,
    });
    g.startRace();
    drive(g, neutralInput);
    run(g, 1);
    g.pause();
    run(g, 5);
    g.renderScene();
    expect(lastScene()?.startClockMs).toBeCloseTo(-2000, 6);
  });

  it("the pause menu restarts the race; Q quits it outright", () => {
    const { g } = makeGame();
    g.startRace();
    drive(g, floorIt());
    run(g, 1);
    g.pause();
    click(g, { "data-action": "restart" });
    expect(g.paused).toBe(false);
    expect(g.screen).toBe("race");
    expect(g.clockMs).toBe(0);

    g.pause();
    g.onKeyDown(keydown("KeyQ"));
    expect(g.screen).toBe("menu");
    expect(g.paused).toBe(false);
  });

  it("the sound toggle keeps the pause menu up", () => {
    const { g, uiRoot } = makeGame();
    g.startRace();
    g.pause();
    click(g, { "data-action": "toggle-sound" });
    expect(g.paused).toBe(true);
    expect(uiRoot.innerHTML).toContain('data-action="resume"');
  });
});
