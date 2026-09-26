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
import { FIXED_DT } from "../../src/core/tuning.ts";

/**
 * Director-level regressions: the Game wiring (screen flow, clicks, clock,
 * saving) driven headless. No DOM: a stub UI root, a recording renderer, and an
 * autopilot (or a fixed input) standing in for the keyboard.
 */

/** The private surface these tests drive. */
interface GameInternals {
  screen: string;
  clockMs: number;
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
}

function makeGame(credits = 0) {
  const store = new MemorySaveStore();
  const prog = Progression.fresh();
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
  const game = new Game(prog, { renderer, uiRoot, store, rivals: 3 });
  const lastScene = (): RenderScene | undefined => scenes[scenes.length - 1];
  return { g: game as unknown as GameInternals, prog, store, lastScene };
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
