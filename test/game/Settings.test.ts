import { describe, it, expect } from "vitest";
import {
  defaultSettings,
  isReservedCode,
  migrateSettings,
  rebindSetting,
  nextHudSize,
  toggleColorMode,
} from "../../src/game/settings.ts";
import { migrate } from "../../src/game/save.ts";
import {
  defaultKeyMap,
  inputFrom,
  KEY_ACTIONS,
  type KeyMap,
} from "../../src/core/Input.ts";
import { carPalette, hudScaleOf } from "../../src/core/theme.ts";

/**
 * Settings live inside the versioned save and drive the input + renderer seams,
 * so the behaviour that *matters* (rebinding, palette, hud scaling, and healing
 * a corrupt/legacy block) is verified pure, away from any DOM.
 */

describe("default settings", () => {
  it("ships sensible WASD + arrows + Space-handybrake bindings", () => {
    const s = defaultSettings();
    expect(s.keyMap.throttle).toEqual(["KeyW", "ArrowUp"]);
    expect(s.keyMap.handbrake).toEqual(["Space"]);
    expect(s.colorMode).toBe("std");
    expect(s.hudSize).toBe("md");
  });

  it("each default maps a code to the right input axis", () => {
    const km = defaultKeyMap();
    expect(inputFrom(new Set(["KeyW"]), km)).toMatchObject({ throttle: 1 });
    expect(inputFrom(new Set(["KeyS"]), km)).toMatchObject({ brake: 1 });
    expect(inputFrom(new Set(["KeyA"]), km)).toMatchObject({ steer: -1 });
    expect(inputFrom(new Set(["KeyD"]), km)).toMatchObject({ steer: 1 });
    expect(inputFrom(new Set(["ArrowUp"]), km)).toMatchObject({ throttle: 1 });
    expect(inputFrom(new Set(["Space"]), km)).toMatchObject({
      handbrake: true,
    });
    expect(inputFrom(new Set(), km)).toMatchObject({
      throttle: 0,
      brake: 0,
      steer: 0,
      handbrake: false,
    });
  });
});

describe("rebinding", () => {
  it("binds a new code to an action and moves it off any other action", () => {
    const s = defaultSettings();
    // KeyA is the default steerLeft; claim it for the handbrake instead.
    const r = rebindSetting(s, "handbrake", "KeyA");
    expect(r.keyMap.handbrake).toEqual(["KeyA"]);
    expect(r.keyMap.steerLeft).toEqual(["ArrowLeft"]); // KeyA vacated, rest stay
    expect(r.keyMap.throttle).toEqual(["KeyW", "ArrowUp"]); // untouched
    // The original settings object is not mutated (a new one is returned).
    expect(s.keyMap.steerLeft).toEqual(["KeyA", "ArrowLeft"]);
  });

  it("refuses the game's own keys (R restarts, P / Esc pause, Q / Backspace quit)", () => {
    const s = defaultSettings();
    for (const code of ["KeyR", "KeyP", "KeyQ", "Escape", "Backspace"]) {
      expect(isReservedCode(code)).toBe(true);
      expect(rebindSetting(s, "handbrake", code)).toBe(s); // unchanged
    }
    expect(isReservedCode("KeyE")).toBe(false);
  });

  it("never leaves an action unbound: taking its last key swaps in the old keys", () => {
    let s = defaultSettings();
    s = rebindSetting(s, "brake", "KeyW"); // throttle keeps ArrowUp
    expect(s.keyMap.throttle).toEqual(["ArrowUp"]);
    s = rebindSetting(s, "steerLeft", "ArrowUp"); // throttle's last key
    expect(s.keyMap.steerLeft).toEqual(["ArrowUp"]);
    expect(s.keyMap.throttle).toEqual(["KeyA", "ArrowLeft"]); // swapped in
    for (const a of KEY_ACTIONS) expect(s.keyMap[a].length).toBeGreaterThan(0);
  });

  it("an unbound action still produces inputFrom with its other keys", () => {
    const km: KeyMap = {
      throttle: ["KeyW", "ArrowUp"],
      brake: ["KeyS", "ArrowDown"],
      steerLeft: [],
      steerRight: ["KeyD", "ArrowRight"],
      handbrake: ["Space"],
    };
    // steerLeft has no keys -> no steering; the rest still work.
    expect(inputFrom(new Set(["KeyA"]), km).steer).toBe(0);
    expect(inputFrom(new Set(["KeyD"]), km).steer).toBe(1);
  });
});

describe("display toggles", () => {
  it("cycles HUD size sm -> md -> lg -> sm", () => {
    expect(nextHudSize("sm")).toBe("md");
    expect(nextHudSize("md")).toBe("lg");
    expect(nextHudSize("lg")).toBe("sm");
  });

  it("flips colour mode", () => {
    expect(toggleColorMode("std")).toBe("cb");
    expect(toggleColorMode("cb")).toBe("std");
  });

  it("the colour-blind palette is visually distinct from the standard pair", () => {
    const cb = carPalette("cb");
    const std = carPalette("std");
    expect(cb.player).not.toEqual(std.player);
    expect(cb.rival).not.toEqual(std.rival);
  });

  it("hud size maps to a scale (md is the unchanged default)", () => {
    expect(hudScaleOf("md")).toBe(1);
    expect(hudScaleOf("sm")).toBeLessThan(1);
    expect(hudScaleOf("lg")).toBeGreaterThan(1);
  });
});

describe("settings migration", () => {
  const blankSave = (extra: Record<string, unknown> = {}) => ({
    version: 3,
    credits: 0,
    ownedCars: [],
    upgrades: {},
    bestLaps: {},
    bestGhosts: {},
    selectedCar: "street-sedan",
    selectedTrack: "overture",
    clearedTracks: [],
    ...extra,
  });

  it("a legacy save without `settings` gets the defaults", () => {
    expect(migrate(blankSave()).settings).toEqual(defaultSettings());
  });

  it("repairs a fully corrupt settings block down to defaults", () => {
    const bad = blankSave({
      settings: { keyMap: "nope", colorMode: "x", hudSize: 3 },
    });
    expect(migrate(bad).settings).toEqual(defaultSettings());
  });

  it("survives a malformed keyMap (drops junk, fills gaps)", () => {
    const s = blankSave({
      settings: { keyMap: { throttle: ["KeyW"], brake: [5, ""] } },
    });
    const out = migrate(s).settings;
    expect(out.keyMap.throttle).toEqual(["KeyW"]);
    expect(out.keyMap.brake).toEqual(defaultKeyMap().brake); // junk -> default
  });

  it("drops reserved keys from a saved binding (they'd double as restart / quit)", () => {
    const s = blankSave({
      settings: {
        keyMap: { handbrake: ["KeyQ", "ShiftLeft"], throttle: ["KeyR"] },
      },
    });
    const out = migrate(s).settings;
    expect(out.keyMap.handbrake).toEqual(["ShiftLeft"]);
    expect(out.keyMap.throttle).toEqual(defaultKeyMap().throttle); // emptied -> default
  });

  it("keeps a valid, rebinded settings object", () => {
    const s = blankSave({
      settings: {
        colorMode: "cb",
        hudSize: "lg",
        keyMap: {
          throttle: ["KeyJ"],
          brake: ["KeyK"],
          steerLeft: ["KeyH"],
          steerRight: ["KeyL"],
          handbrake: ["Space"],
        },
      },
    });
    const out = migrate(s).settings;
    expect(out.colorMode).toBe("cb");
    expect(out.hudSize).toBe("lg");
    expect(out.keyMap.throttle).toEqual(["KeyJ"]);
  });

  it("keeps a saved mute, and treats a missing or junk one as sound on", () => {
    expect(migrateSettings({ muted: true }).muted).toBe(true);
    expect(migrateSettings({ muted: false }).muted).toBe(false);
    expect(migrateSettings({}).muted).toBe(false);
    expect(migrateSettings({ muted: "yes" }).muted).toBe(false);
    expect(
      migrate(blankSave({ settings: { muted: true } })).settings.muted,
    ).toBe(true);
  });

  it("migrateSettings handles null/non-object without throwing", () => {
    expect(migrateSettings(null)).toEqual(defaultSettings());
    expect(migrateSettings("garbage")).toEqual(defaultSettings());
    expect(migrateSettings({})).toEqual(defaultSettings());
  });
});
