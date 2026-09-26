/**
 * Persistent UI settings: key bindings, colour-blind palette mode, and HUD size.
 * Folded into the versioned `SaveData` so it rides the same store + migration
 * path as progress. Pure (no DOM) so rebinding + migration are unit-testable.
 * Presentation primitives live in `core/theme.ts`; this module only *composes*
 * them into one persisted object and knows how to heal a corrupted one.
 */
import {
  defaultKeyMap,
  KEY_ACTIONS,
  type KeyAction,
  type KeyMap,
} from "../core/Input.ts";
import type { ColorMode, HudSize } from "../core/theme.ts";

export type { KeyMap, KeyAction };
export { KEY_ACTIONS };

export interface Settings {
  keyMap: KeyMap;
  colorMode: ColorMode;
  hudSize: HudSize;
  /** All game sound off. */
  muted: boolean;
  /** How to Play has been seen, so first launch shows it once. */
  onboarded: boolean;
}

/**
 * Keys the game itself answers to (R restarts, Esc / P pause, Q / Backspace
 * go back to the menu). Binding a driving action to one would fire both, e.g.
 * a handbrake on Q that also quits the race, so these are never rebindable.
 */
export const RESERVED_CODES: readonly string[] = [
  "KeyR",
  "KeyQ",
  "KeyP",
  "Escape",
  "Backspace",
];

export function isReservedCode(code: string): boolean {
  return RESERVED_CODES.includes(code);
}

export function defaultSettings(): Settings {
  return {
    keyMap: defaultKeyMap(),
    colorMode: "std",
    hudSize: "md",
    muted: false,
    onboarded: false,
  };
}

/** Coerce arbitrary / older / corrupt payloads into a valid current `Settings`. */
export function migrateSettings(input: unknown): Settings {
  const s = defaultSettings();
  if (input === null || typeof input !== "object") return s;
  const raw = input as Record<string, unknown>;
  if (raw.keyMap !== undefined) s.keyMap = migrateKeyMap(raw.keyMap);
  if (raw.colorMode === "std" || raw.colorMode === "cb") {
    s.colorMode = raw.colorMode;
  }
  if (raw.hudSize === "sm" || raw.hudSize === "md" || raw.hudSize === "lg") {
    s.hudSize = raw.hudSize;
  }
  if (typeof raw.muted === "boolean") s.muted = raw.muted;
  if (typeof raw.onboarded === "boolean") s.onboarded = raw.onboarded;
  return s;
}

/** Heal a binding table: keep valid codes per action, fall back to default. */
function migrateKeyMap(raw: unknown): KeyMap {
  const base = defaultKeyMap();
  if (raw === null || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const out = defaultKeyMap();
  for (const a of KEY_ACTIONS) {
    const v = r[a];
    if (Array.isArray(v)) {
      const codes = v.filter(
        (c): c is string =>
          typeof c === "string" && c.length > 0 && !isReservedCode(c),
      );
      // A binding that lost every code reverts to its default for that action.
      out[a] = codes.length > 0 ? codes : base[a];
    }
  }
  return out;
}

/**
 * Rebind one action to a single code, moving it off any action that already
 * claims that code (one code -> one action, so an action cannot silently steal
 * another's key). If that leaves the other action with no key at all, it takes
 * over this action's old keys (a swap), so no action is ever left undrivable.
 * A reserved code is refused (the settings come back unchanged). Returns a new
 * settings object with the change applied.
 */
export function rebindSetting(
  s: Settings,
  action: KeyAction,
  code: string,
): Settings {
  if (isReservedCode(code)) return s;
  // Strip `code` from every action first so it isn't left bound elsewhere.
  const kmc: KeyMap = {
    throttle: s.keyMap.throttle.filter((c) => c !== code),
    brake: s.keyMap.brake.filter((c) => c !== code),
    steerLeft: s.keyMap.steerLeft.filter((c) => c !== code),
    steerRight: s.keyMap.steerRight.filter((c) => c !== code),
    handbrake: s.keyMap.handbrake.filter((c) => c !== code),
  };
  const freed = s.keyMap[action].filter((c) => c !== code);
  const orphan = KEY_ACTIONS.find(
    (a) => a !== action && s.keyMap[a].length > 0 && kmc[a].length === 0,
  );
  if (orphan !== undefined && freed.length > 0) kmc[orphan] = freed;
  kmc[action] = [code];
  return { ...s, keyMap: kmc };
}

const HUD_ORDER: HudSize[] = ["sm", "md", "lg"];

/** Advance the HUD size preference (sm -> md -> lg -> sm). */
export function nextHudSize(size: HudSize): HudSize {
  const i = HUD_ORDER.indexOf(size);
  return HUD_ORDER[(i + 1) % HUD_ORDER.length];
}

/** Flip the colour-blind mode. */
export function toggleColorMode(mode: ColorMode): ColorMode {
  return mode === "cb" ? "std" : "cb";
}
