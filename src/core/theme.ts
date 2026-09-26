/**
 * Presentation theme: the car colour palette and HUD scaling. Kept in `core`
 * (no DOM, no data) so the renderer can pull a colour for a car and an HUD scale
 * from a single source of truth, and the settings layer (which only *chooses*
 * a mode/size) stays decoupled. Colour logic here is pure and unit-testable.
 */
import type { KeyAction } from "./Input.ts";

/**
 * Two palettes. `std` is the default vivid look; `cb` swaps the classic
 * "yellow player vs blue rival" pair for a deuteranopia-safe "orange vs blue"
 * pair, so a colour-blind player can still tell their car from the rivals.
 */
export type ColorMode = "std" | "cb";

export interface CarPalette {
  /** Player car body fill. */
  player: string;
  /** Player car nose marker fill. */
  nose: string;
  /** AI rival body fill. */
  rival: string;
}

export function carPalette(mode: ColorMode): CarPalette {
    // Orange vs blue is the canonical deuteranopia-safe pair; keep the default
    // (amber vs blue) for the vivid standard look.
  if (mode === "cb")
    return { player: "#ff7a18", nose: "#ffd8a8", rival: "#2e7de0" };
  return { player: "#f5c542", nose: "#ffe9a8", rival: "#4aa3ff" };
}

/** Body style a car class is drawn with (see `core/carArt.ts`). */
export type CarLook = "sedan" | "buggy" | "brawler";

/**
 * Lighten (`t` > 0, toward white) or darken (`t` < 0, toward black) a
 * `#rrggbb` colour by |t| (0..1). Used to derive body shading and trim from a
 * single palette colour, so the colour-blind palette shades the same way.
 */
export function shade(hex: string, t: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  if (!/^#[0-9a-f]{6}$/i.test(hex) || Number.isNaN(n)) return hex;
  const k = Math.max(-1, Math.min(1, t));
  const mix = (c: number): number =>
    Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k));
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** HUD size presets the player can pick; each maps to a dimension scale. */
export type HudSize = "sm" | "md" | "lg";

/** A larger scale makes HUD text + the minimap bigger, for readability. */
export function hudScaleOf(size: HudSize): number {
  switch (size) {
    case "sm":
      return 0.85;
    case "lg":
      return 1.2;
      // md is the unchanged default.
      default:
        return 1;
  }
}

/** Human label for an `e.code` string, for the key-rebind readout. */
export function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  switch (code) {
    case "ArrowUp":
      return "↑";
    case "ArrowDown":
      return "↓";
    case "ArrowLeft":
      return "←";
    case "ArrowRight":
      return "→";
    case "Space":
      return "Space";
    case "ShiftLeft":
      return "L-Shift";
    case "ShiftRight":
      return "R-Shift";
    case "Semicolon":
      return ";";
    case "Quote":
      return "'";
    case "Comma":
      return ",";
    case "Period":
      return ".";
    case "BracketLeft":
      return "[";
    case "BracketRight":
      return "]";
    default:
      return code;
  }
}

/** A friendly name for a rebinding action, for the settings UI. */
export const ACTION_LABELS: Record<KeyAction, string> = {
  throttle: "Accelerate",
  brake: "Brake / Reverse",
  steerLeft: "Steer Left",
  steerRight: "Steer Right",
  handbrake: "Handbrake / Drift",
};
