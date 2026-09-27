import { describe, it, expect } from "vitest";
import { navDirFor, pickNext, type Rect } from "../src/ui/MenuNav.ts";
import { defaultKeyMap } from "../src/core/Input.ts";
import { defaultSettings, rebindSetting } from "../src/game/settings.ts";

/**
 * Spatial menu navigation, on the shapes the game's screens actually have:
 * the menu's two columns over a footer of buttons, and a row of actions.
 */

const r = (x: number, y: number, w: number, h: number): Rect => ({
  x,
  y,
  w,
  h,
});

// The main menu, roughly: cars on the left, a longer list of tracks on the
// right, and a footer row (Start, Garage, How to Play, Settings) below both.
const cars = [r(20, 100, 360, 80), r(20, 190, 360, 80), r(20, 280, 360, 80)];
const tracks = [0, 1, 2, 3, 4, 5].map((i) => r(400, 100 + i * 70, 360, 60));
const footer = [
  r(20, 560, 200, 40), // Start
  r(230, 560, 90, 40), // Garage
  r(330, 560, 120, 40), // How to Play
  r(460, 560, 100, 40), // Settings
];
const menu = [...cars, ...tracks, ...footer];
const go = (from: Rect, dir: Parameters<typeof pickNext>[2]): Rect | null => {
  const others = menu.filter((c) => c !== from);
  const i = pickNext(from, others, dir);
  return i < 0 ? null : others[i];
};

describe("spatial menu navigation", () => {
  it("moves along a column and across to the one beside it", () => {
    expect(go(cars[0], "down")).toBe(cars[1]);
    expect(go(tracks[3], "up")).toBe(tracks[2]);
    expect(go(cars[1], "right")).toBe(tracks[1]); // the track level with it
    expect(go(tracks[0], "left")).toBe(cars[0]);
  });

  it("goes to what's directly above or below, however far, before anything off to the side", () => {
    // Start sits under the cars: up reaches the last car, not the nearer
    // last track off to its right.
    expect(go(footer[0], "up")).toBe(cars[2]);
    // Settings sits under the tracks.
    expect(go(footer[3], "up")).toBe(tracks[5]);
    expect(go(cars[2], "down")).toBe(footer[0]);
  });

  it("reaches off to the side only when nothing lines up", () => {
    // Nothing is level with the last track on the left: take the nearest.
    expect(go(tracks[5], "left")).toBe(footer[1]);
    // From the last car, "right" finds the track rows beside it.
    expect(tracks).toContain(go(cars[2], "right"));
  });

  it("stays put at an edge", () => {
    expect(go(footer[0], "left")).toBeNull();
    expect(go(footer[0], "down")).toBeNull();
    expect(go(tracks[0], "up")).toBeNull();
    expect(go(tracks[0], "right")).toBeNull();
  });

  it("steps along a row of buttons", () => {
    expect(go(footer[0], "right")).toBe(footer[1]);
    expect(go(footer[2], "left")).toBe(footer[1]);
  });
});

describe("keys that move around the menus", () => {
  it("are the arrows and whatever keys drive the car", () => {
    const km = defaultKeyMap();
    expect(navDirFor("ArrowUp", km)).toBe("up");
    expect(navDirFor("KeyS", km)).toBe("down");
    expect(navDirFor("KeyA", km)).toBe("left");
    expect(navDirFor("ArrowRight", km)).toBe("right");
    expect(navDirFor("Space", km)).toBeNull(); // the handbrake presses instead
    expect(navDirFor("KeyX", km)).toBeNull();
  });

  it("follow a rebound layout", () => {
    const s = rebindSetting(defaultSettings(), "throttle", "KeyI");
    expect(navDirFor("KeyI", s.keyMap)).toBe("up");
    expect(navDirFor("ArrowUp", s.keyMap)).toBe("up"); // arrows always work
  });
});
