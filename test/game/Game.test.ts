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
import type { Ghost } from "../../src/race/Ghost.ts";
import type { ResultsView, UiModel } from "../../src/ui/ui.ts";
import { podiumBonus } from "../../src/game/economy.ts";
import { GamepadInput, type PadLike } from "../../src/core/Gamepad.ts";
import { viewScaleFor } from "../../src/game/Game.ts";
import type { ReplayPlayer } from "../../src/race/ReplayPlayer.ts";
import { currentLapTimeMs } from "../../src/race/RaceState.ts";

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
  chaseGhost(): Ghost;
  presentAudio(): void;
  showOpeningScreen(): void;
  lastResults: ResultsView | null;
  gamepad: GamepadInput;
  pollGamepad(nowMs?: number): void;
  uiModel(): UiModel;
  rebinding: string | null;
  replays: ReplayPlayer;
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

describe("Game — chasing your best lap", () => {
  it("shows no ghost car or split before the track has a record", () => {
    const { g, lastScene } = makeGame();
    g.startRace();
    autopilot(g);
    run(g, 5);
    g.renderScene();
    expect(lastScene()?.ghostCar).toBeUndefined();
    expect(lastScene()?.splitMs).toBeUndefined();
  });

  it("replays the record as a ghost car: re-driving that lap splits ~0", () => {
    const { g, lastScene } = makeGame();
    g.startRace();
    autopilot(g);
    runToFinish(g);
    const times = g.playerRace.lapTimesMs;
    const recordLap = times.indexOf(Math.min(...times));

    // The same car and autopilot drive the identical race again; halfway
    // through the record lap, the ghost should be right on top of the car.
    g.startRace();
    autopilot(g);
    const lapMs = () => currentLapTimeMs(g.playerRace, g.clockMs);
    while (g.playerRace.lap < recordLap || lapMs() < times[recordLap] / 2)
      g.onStep(FIXED_DT);
    g.renderScene();
    const scene = lastScene()!;
    const car = g.arena.cars[0].body.position;
    expect(scene.ghostCar).toBeDefined();
    expect(scene.ghostCar!.alpha).toBe(1);
    expect(
      Math.hypot(scene.ghostCar!.x - car.x, scene.ghostCar!.y - car.y),
    ).toBeLessThan(8);
    expect(Math.abs(scene.splitMs!)).toBeLessThan(40);
  });

  it("switches the chase to this race's best once it beats the saved record", () => {
    const prog = Progression.fresh();
    prog.data.bestLaps.overture = 10 * 60_000; // a very slow saved record
    prog.data.bestGhosts.overture = [
      { t: 0, x: 0, y: 0, heading: 0 },
      { t: 600_000, x: 1, y: 0, heading: 0 },
    ];
    const { g } = makeGame(0, prog);
    g.startRace();
    expect(g.chaseGhost()).toBe(prog.data.bestGhosts.overture);
    autopilot(g);
    while (g.playerRace.lap < 1) g.onStep(FIXED_DT);
    expect(g.chaseGhost()).toBe(g.playerRace.bestGhost);
  });
});

describe("Game — engine and tyre audio", () => {
  it("idles on the grid, revs with throttle, and goes quiet off the track", () => {
    const { g, audio } = makeGame(0, Progression.fresh(), {
      countdownMs: 3000,
    });
    g.presentAudio();
    expect(audio.engine).toBeNull(); // menu

    g.startRace();
    drive(g, neutralInput);
    run(g, 0.5);
    g.presentAudio();
    expect(audio.engine?.rpm).toBe(0); // idling at the lights
    drive(g, floorIt());
    run(g, 0.5);
    g.presentAudio();
    expect(audio.engine?.rpm).toBe(0.5); // revving on the grid

    run(g, 2.5); // GO…
    autopilot(g); // …and away, on the racing line (not into the wall)
    run(g, 2.5);
    g.presentAudio();
    expect(audio.engine!.rpm).toBeGreaterThan(0.5);

    g.pause(); // silenced at once, not on the next frame
    expect(audio.engine).toBeNull();
    expect(audio.skid).toBe(0);
  });

  it("is silent after the finish", () => {
    const { g, audio } = makeGame();
    g.startRace();
    autopilot(g);
    runToFinish(g);
    g.presentAudio();
    expect(audio.engine).toBeNull();
  });

  it("gives each class its own voice: the buggy whines above the brawler", () => {
    const pitchOf = (car: string): number => {
      const prog = Progression.fresh();
      prog.setCredits(1e6);
      prog.unlockCar(car);
      const { g, audio } = makeGame(0, prog);
      g.startRace();
      g.presentAudio();
      return audio.engine!.pitch;
    };
    expect(pitchOf("buggy")).toBeGreaterThan(1);
    expect(pitchOf("brawler")).toBeLessThan(1);
  });

  it("rains on a wet track's race, not on a dry one, the menu or a pause", () => {
    const prog = Progression.fresh();
    prog.data.clearedTracks = prog.data.clearedTracks.concat(
      "overture",
      "hairpin",
      "riverbend",
      "gravel-pit",
      "clover",
      "dust-bowl",
    );
    prog.selectTrack("monsoon");
    const { g, audio } = makeGame(0, prog);
    g.presentAudio();
    expect(audio.rain).toBe(false); // menu
    g.startRace();
    g.presentAudio();
    expect(audio.rain).toBe(true);
    g.pause();
    expect(audio.rain).toBe(false);

    const dry = makeGame();
    dry.g.startRace();
    dry.g.presentAudio();
    expect(dry.audio.rain).toBe(false);
  });

  it("squeals through a handbrake slide", () => {
    const { g, audio } = makeGame();
    g.startRace();
    drive(g, floorIt());
    run(g, 1.2);
    drive(g, () => ({
      ...neutralInput(),
      throttle: 1,
      steer: 1,
      handbrake: true,
    }));
    let loudest = 0;
    for (let i = 0; i < 0.6 / FIXED_DT; i++) {
      g.onStep(FIXED_DT);
      g.presentAudio();
      loudest = Math.max(loudest, audio.skid);
    }
    expect(loudest).toBeGreaterThan(0.2);
  });
});

describe("Game — the finish pays for position", () => {
  it("pays the podium bonus for where you finished, itemised for the results", () => {
    const { g, prog } = makeGame();
    g.startRace();
    autopilot(g);
    runToFinish(g);
    const r = g.lastResults!;
    expect(r.outcome.breakdown.podium).toBe(podiumBonus(r.position, 4));
    const { base, pace, podium } = r.outcome.breakdown;
    expect(r.outcome.creditsEarned).toBe(base + pace + podium);
    expect(prog.credits).toBe(r.outcome.creditsEarned);
    expect(r.parMs).toBe(18000); // Overture's par, to explain the pace bonus
  });
});

describe("Game — first launch", () => {
  it("opens on How to Play once; leaving it marks it seen, and saves that", () => {
    const { g, prog, store } = makeGame();
    g.showOpeningScreen();
    expect(g.screen).toBe("onboarding");
    click(g, { "data-action": "close-onboarding" });
    expect(g.screen).toBe("menu");
    expect(store.load()?.settings.onboarded).toBe(true);

    const again = makeGame(0, prog).g; // next launch, same save
    again.showOpeningScreen();
    expect(again.screen).toBe("menu");
  });

  it("leaving How to Play by key (Esc) also counts as seen", () => {
    const { g, store } = makeGame();
    g.showOpeningScreen();
    g.onKeyDown(keydown("Escape"));
    expect(g.screen).toBe("menu");
    expect(store.load()?.settings.onboarded).toBe(true);
  });

  it("'Start Racing' from How to Play also counts as seen", () => {
    const { g, prog } = makeGame();
    g.showOpeningScreen();
    click(g, { "data-action": "start" });
    expect(g.screen).toBe("race");
    expect(prog.settings.onboarded).toBe(true);
  });

  it("doesn't greet a player who has already raced (a save from before the flag)", () => {
    const prog = Progression.fresh();
    prog.data.clearedTracks = ["overture"];
    const { g } = makeGame(0, prog);
    g.showOpeningScreen();
    expect(g.screen).toBe("menu");
  });
});

/** A pad whose held buttons (by standard index) a test sets. */
function testPad(g: GameInternals): { hold(...i: number[]): void } {
  let held = new Set<number>();
  g.gamepad = new GamepadInput(() => [
    {
      connected: true,
      axes: [0, 0],
      buttons: Array.from({ length: 17 }, (_, i) => ({
        pressed: held.has(i),
        value: held.has(i) ? 1 : 0,
      })),
    },
  ]);
  return { hold: (...i: number[]) => void (held = new Set(i)) };
}

/**
 * Press and release a pad button, polling as frames would: idle first (a
 * live game polls every frame, which clears a new screen's latch), then held,
 * then let go.
 */
function tapPad(g: GameInternals, pad: ReturnType<typeof testPad>, i: number) {
  pad.hold();
  g.pollGamepad();
  pad.hold(i);
  g.pollGamepad();
  pad.hold();
  g.pollGamepad();
}

describe("Game — watching the race back", () => {
  /** A finished race on the default track, with the results up. */
  function raced() {
    const made = makeGame();
    made.g.startRace();
    autopilot(made.g);
    runToFinish(made.g);
    return made;
  }

  it("records the whole race and offers it on the results", () => {
    const { g, uiRoot } = raced();
    expect(g.lastResults?.canReplay).toBe(true);
    expect(uiRoot.innerHTML).toContain('data-action="replay"');
    expect(g.replays.replay[0].t).toBe(0);
    expect(g.replays.replay[g.replays.replay.length - 1].t).toBeCloseTo(
      g.clockMs,
      6,
    );
    expect(g.replays.replay[0].cars).toHaveLength(4); // the player and the field
  });

  it("replays where the car really was, at the speed chosen", () => {
    const { g } = raced();
    const mid = g.replays.replay[Math.floor(g.replays.replay.length / 2)];
    click(g, { "data-action": "replay" });
    expect(g.screen).toBe("replay");
    run(g, mid.t / 1000);
    const car = g.arena.cars[0].body.position;
    expect(
      Math.hypot(car.x - mid.cars[0].x, car.y - mid.cars[0].y),
    ).toBeLessThan(2);

    click(g, { "data-action": "replay-speed" });
    const at = g.replays.ms;
    run(g, 1);
    expect(g.replays.ms - at).toBeCloseTo(2000, 0); // 2×
    click(g, { "data-action": "replay-toggle" });
    const held = g.replays.ms;
    run(g, 1);
    expect(g.replays.ms).toBe(held);
  });

  it("stops at the flag and offers to watch again", () => {
    const { g, uiRoot } = raced();
    click(g, { "data-action": "replay" });
    click(g, { "data-action": "replay-speed" }); // 2×
    click(g, { "data-action": "replay-speed" }); // 4×
    run(g, 20); // 80 s of replay: well past the flag
    expect(uiRoot.innerHTML).toContain("Watch again");
    click(g, { "data-action": "replay-toggle" });
    expect(g.replays.ms).toBe(0);
  });

  it("leaves the results as they were: Esc (or ◀ Results) goes back", () => {
    const { g, prog } = raced();
    const credits = prog.credits;
    const results = g.lastResults;
    click(g, { "data-action": "replay" });
    run(g, 2);
    g.onKeyDown(keydown("Escape"));
    expect(g.screen).toBe("results");
    expect(g.lastResults).toBe(results);
    expect(prog.credits).toBe(credits);
    click(g, { "data-action": "replay" });
    click(g, { "data-action": "replay-exit" });
    expect(g.screen).toBe("results");
  });

  it("holding Esc leaves a replay for its results, and no further", () => {
    const { g } = raced();
    click(g, { "data-action": "replay" });
    g.onKeyDown(keydown("Escape"));
    expect(g.screen).toBe("results");
    g.onKeyDown(keydown("Escape", { repeat: true })); // still held
    expect(g.screen).toBe("results");
    expect(g.lastResults).not.toBeNull();
  });

  it("is silent, and shows a REPLAY badge instead of the race HUD", () => {
    const { g, audio, lastScene } = raced();
    click(g, { "data-action": "replay" });
    run(g, 1);
    g.presentAudio();
    expect(audio.engine).toBeNull();
    g.renderScene();
    expect(lastScene()?.hud).toBe(false);
    expect(lastScene()?.replay?.ms).toBeGreaterThan(0);
  });
});

describe("Game — records", () => {
  it("a race's best lap lands on the track's board, shown on Records", () => {
    const { g, uiRoot, prog } = makeGame();
    g.startRace();
    autopilot(g);
    runToFinish(g);
    expect(g.lastResults?.outcome.boardRank).toBe(1);
    expect(g.lastResults?.trackName).toBe("Overture");
    const [lap] = prog.recordsFor("overture");
    expect(lap.ms).toBe(g.playerRace.bestLapMs);
    expect(lap.car).toBe("street-sedan");
    expect(lap.at).toBeGreaterThan(0);

    click(g, { "data-action": "menu" });
    click(g, { "data-action": "records" });
    expect(g.screen).toBe("records");
    expect(uiRoot.innerHTML).toContain("Street Sedan");
    expect(uiRoot.innerHTML).toContain('data-share="overture"');
    // Only open tracks have boards: Hairpin just opened, Riverbend hasn't.
    expect(uiRoot.innerHTML).toContain("Hairpin");
    expect(uiRoot.innerHTML).not.toContain("Riverbend");
    g.onKeyDown(keydown("Escape"));
    expect(g.screen).toBe("menu");
  });

  it("where there's no clipboard, 'Copy best' shows the line to copy by hand", () => {
    const { g, uiRoot } = makeGame();
    g.startRace();
    autopilot(g);
    runToFinish(g);
    click(g, { "data-action": "records" });
    click(g, { "data-share": "overture" });
    expect(uiRoot.innerHTML).toMatch(
      /Copy this: <span>RC Racer · Overture: \d:\d\d\.\d{3} in the Street Sedan\. Beat it\?<\/span>/,
    );
    click(g, { "data-action": "records" }); // reopened: the line is gone
    expect(uiRoot.innerHTML).not.toContain("Copy this:");
  });
});

describe("Game — the menus by keyboard", () => {
  it("a throttle key held over the finish line doesn't wander the results", () => {
    const { g } = makeGame();
    g.startRace();
    autopilot(g);
    runToFinish(g);
    const moves: string[] = [];
    (g as unknown as { nav: { move(d: string): void } }).nav.move = (d) =>
      void moves.push(d);
    g.onKeyDown(keydown("ArrowUp", { repeat: true })); // still held
    g.onKeyDown(keydown("KeyS", { repeat: true }));
    expect(moves).toEqual([]);
    g.onKeyDown(keydown("ArrowDown")); // a fresh press moves
    g.onKeyDown(keydown("ArrowDown", { repeat: true })); // and may repeat
    expect(moves).toEqual(["down", "down"]);
  });
});

describe("Game — the menus by gamepad", () => {
  const B = 1;
  const START = 9;

  it("B backs out of a screen to the menu, and resumes a paused race", () => {
    const { g } = makeGame();
    const pad = testPad(g);
    click(g, { "data-action": "garage" });
    tapPad(g, pad, B);
    expect(g.screen).toBe("menu");
    tapPad(g, pad, B); // already on the menu: nowhere further back
    expect(g.screen).toBe("menu");

    g.startRace();
    tapPad(g, pad, START);
    expect(g.paused).toBe(true);
    tapPad(g, pad, B);
    expect(g.paused).toBe(false);
    expect(g.screen).toBe("race");
  });

  it("B cancels a key capture before it leaves Settings", () => {
    const { g } = makeGame();
    const pad = testPad(g);
    click(g, { "data-action": "settings" });
    click(g, { "data-bind": "handbrake" });
    expect(g.rebinding).toBe("handbrake");
    tapPad(g, pad, B);
    expect(g.rebinding).toBeNull();
    expect(g.screen).toBe("settings");
    tapPad(g, pad, B);
    expect(g.screen).toBe("menu");
  });

  it("B on How to Play counts it as seen", () => {
    const { g, store } = makeGame();
    const pad = testPad(g);
    g.showOpeningScreen();
    tapPad(g, pad, B);
    expect(g.screen).toBe("menu");
    expect(store.load()?.settings.onboarded).toBe(true);
  });

  it("the pad's buttons don't work the menus while racing", () => {
    const { g } = makeGame();
    const pad = testPad(g);
    g.startRace();
    tapPad(g, pad, B);
    expect(g.screen).toBe("race");
    expect(g.paused).toBe(false);
  });
});

describe("Game — gamepad and small screens", () => {
  it("a gamepad's Start pauses and resumes a race, once per press", () => {
    const { g } = makeGame();
    let start = false;
    const pad = (): PadLike => ({
      connected: true,
      axes: [0, 0],
      buttons: Array.from({ length: 17 }, (_, i) => ({
        pressed: i === 9 && start,
        value: i === 9 && start ? 1 : 0,
      })),
    });
    g.gamepad = new GamepadInput(() => [pad()]);
    g.startRace();
    start = true;
    g.pollGamepad();
    expect(g.paused).toBe(true);
    g.pollGamepad(); // still held: no flicker
    expect(g.paused).toBe(true);
    start = false;
    g.pollGamepad();
    start = true;
    g.pollGamepad();
    expect(g.paused).toBe(false);
  });

  it("pulls the camera out on a phone, leaving desktop framing untouched", () => {
    expect(viewScaleFor(1280, 720)).toBe(1);
    expect(viewScaleFor(1024, 600)).toBe(1);
    expect(viewScaleFor(844, 390)).toBeCloseTo(0.65, 9); // landscape phone
    expect(viewScaleFor(390, 844)).toBeCloseTo(0.65, 9); // portrait
    expect(viewScaleFor(200, 150)).toBe(0.5); // floor
  });
});

describe("Game — results lead on", () => {
  it("a first clear offers the track it opened, and 'Next' races there", () => {
    const { g, uiRoot, store } = makeGame();
    g.startRace();
    autopilot(g);
    runToFinish(g);
    expect(g.lastResults?.outcome.unlockedTrack).toBe("hairpin");
    expect(g.lastResults?.nextTrack).toEqual({
      id: "hairpin",
      name: "Hairpin",
    });
    expect(uiRoot.innerHTML).toContain('data-action="nexttrack"');
    click(g, { "data-action": "nexttrack" });
    expect(g.screen).toBe("race");
    expect(g.arena.track.def.id).toBe("hairpin");
    expect(g.clockMs).toBe(0);
    expect(store.load()?.selectedTrack).toBe("hairpin");
  });

  it("Menu from the results parks a fresh preview car, as Esc does", () => {
    const { g } = makeGame();
    g.startRace();
    autopilot(g);
    runToFinish(g);
    click(g, { "data-action": "menu" });
    expect(g.screen).toBe("menu");
    expect(g.arena.cars).toHaveLength(1); // the finished field is gone
    expect(g.lastResults).toBeNull();
  });
});

describe("Game — the garage previews each upgrade", () => {
  it("every buyable slot says which bars its next tier moves; maxed ones don't", () => {
    const prog = Progression.fresh();
    prog.data.upgrades["street-sedan"].engine = 4; // maxed
    const { g } = makeGame(0, prog);
    const rows = g.uiModel().upgrades;
    for (const u of rows) {
      if (u.maxed) expect(u.gains, u.slot).toEqual([]);
      else expect(u.gains!.length, u.slot).toBeGreaterThan(0);
    }
    expect(rows.find((u) => u.slot === "engine")!.maxed).toBe(true);
    const tires = rows.find((u) => u.slot === "tires")!;
    expect(tires.gains!.map((x) => x.key)).toEqual(["grip", "braking"]);
  });

  it("the menu tags each track with its conditions", () => {
    const { g } = makeGame();
    const tags = Object.fromEntries(
      g.uiModel().tracks.map((t) => [t.id, t.tags]),
    );
    expect(tags.overture).toEqual([]);
    expect(tags["gravel-pit"]).toEqual(["Dirt"]);
    expect(tags.monsoon).toEqual(["Rain"]);
    expect(tags.midnight).toEqual(["Night"]);
  });

  it("locked tracks name the clear that opens them", () => {
    const { g } = makeGame();
    const tracks = g.uiModel().tracks;
    expect(tracks[0].unlocked).toBe(true);
    expect(tracks[1].unlocked).toBe(false);
    expect(tracks[1].lockHint).toBe("Clear Overture to unlock");
  });
});
