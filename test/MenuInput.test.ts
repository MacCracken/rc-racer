import { describe, it, expect } from "vitest";
import {
  backStep,
  MenuInput,
  type MenuKey,
  type NavLike,
} from "../src/ui/MenuInput.ts";
import { defaultKeyMap } from "../src/core/Input.ts";
import type { PadMenuPress } from "../src/core/Gamepad.ts";

/** A MenuNav stand-in that logs what the menus asked of it. */
function fakeNav() {
  const log: string[] = [];
  const nav: NavLike = {
    move: (d) => void log.push(`move ${d}`),
    press: () => void log.push("press"),
    pressPrimary: () => void log.push("primary"),
    setActive: (on) => void log.push(`active ${on}`),
    afterRender: (screen, navigable) =>
      void log.push(`render ${screen} ${navigable}`),
  };
  return { nav, log };
}

/** A key event stand-in that remembers whether it was claimed. */
function key(code: string, repeat = false) {
  const e: MenuKey & { prevented: boolean } = {
    code,
    repeat,
    prevented: false,
    preventDefault() {
      e.prevented = true;
    },
  };
  return e;
}

const press = (p: Partial<PadMenuPress>): PadMenuPress => ({
  dir: null,
  a: false,
  b: false,
  start: false,
  ...p,
});

describe("backing out of a screen", () => {
  const at = (screen: string, paused = false, rebinding = false) =>
    backStep({ screen, paused, rebinding });

  it("goes back one step, whatever the screen", () => {
    expect(at("replay")).toBe("exit-replay");
    expect(at("race", true)).toBe("resume");
    expect(at("race")).toBe("stay"); // racing: B is the pad's, not the menu's
    expect(at("settings", false, true)).toBe("cancel-rebind");
    expect(at("settings")).toBe("to-menu");
    expect(at("garage")).toBe("to-menu");
    expect(at("onboarding")).toBe("to-menu");
    expect(at("menu")).toBe("stay");
  });
});

describe("keys on a menu", () => {
  it("move with the arrows or the driving keys, and press with Enter or Space", () => {
    const { nav, log } = fakeNav();
    const menus = new MenuInput(nav);
    const km = defaultKeyMap();
    const down = key("ArrowDown");
    expect(menus.key(down, km)).toBe(true);
    expect(down.prevented).toBe(true);
    expect(menus.key(key("KeyA"), km)).toBe(true);
    expect(menus.key(key("Enter"), km)).toBe(true);
    expect(menus.key(key("Space", true), km)).toBe(true); // held: no press
    expect(log).toEqual(["move down", "move left", "press"]);
  });

  it("leave Tab to the browser (waking the focus ring) and other keys alone", () => {
    const { nav, log } = fakeNav();
    const menus = new MenuInput(nav);
    const tab = key("Tab");
    expect(menus.key(tab, defaultKeyMap())).toBe(false);
    expect(tab.prevented).toBe(false);
    expect(menus.key(key("Escape"), defaultKeyMap())).toBe(false);
    expect(log).toEqual(["active true"]);
  });

  it("press with Enter or Space, and let Tab tab, even when a driving key is bound there", () => {
    const { nav, log } = fakeNav();
    const menus = new MenuInput(nav);
    const km = defaultKeyMap();
    km.throttle = ["Enter"];
    km.steerLeft = ["Tab"];
    expect(menus.key(key("Enter"), km)).toBe(true);
    expect(menus.key(key("Tab"), km)).toBe(false);
    expect(log).toEqual(["press", "active true"]);
  });

  it("ignore a key held over the finish line until a fresh press", () => {
    const { nav, log } = fakeNav();
    const menus = new MenuInput(nav);
    const pad = { latched: 0, latch: () => pad.latched++ };
    menus.shown("race", true, pad);
    menus.shown("results", false, pad); // over a race: latch
    expect(pad.latched).toBe(1);
    menus.key(key("ArrowUp", true), defaultKeyMap());
    expect(log).toEqual(["render race false", "render results true"]);
    menus.key(key("ArrowDown"), defaultKeyMap());
    menus.key(key("ArrowDown", true), defaultKeyMap());
    expect(log.slice(2)).toEqual(["move down", "move down"]);
    menus.shown("garage", false, pad); // menu to menu: nothing to latch
    expect(pad.latched).toBe(1);
  });
});

describe("a gamepad on a menu", () => {
  it("does one thing a frame: Start, then B (handed back), then A, then a move", () => {
    const { nav, log } = fakeNav();
    const menus = new MenuInput(nav);
    expect(menus.pad(press({ start: true, a: true }))).toBeNull();
    expect(menus.pad(press({ b: true, a: true }))).toBe("back");
    expect(menus.pad(press({ a: true, dir: "up" }))).toBeNull();
    expect(menus.pad(press({ dir: "left" }))).toBeNull();
    expect(menus.pad(press({}))).toBeNull();
    expect(log).toEqual(["primary", "press", "move left"]);
  });
});
