/**
 * Gamepad input via the browser Gamepad API, behind the same `IInput` seam as
 * the keyboard. The mapping (`padInput`) is pure, so it's testable without a
 * controller; `GamepadInput` just polls the first connected pad each sample.
 *
 * Standard mapping: left stick (or d-pad) steers — analog, so small inputs
 * give small steering — right trigger is gas, left trigger brake / reverse,
 * and A (Cross) or RB is the handbrake. Start pauses (see `startPressed`).
 */
import { neutralInput, type IInput, type InputState } from "./Input.ts";

/** The slice of the Gamepad API read here (a real `Gamepad` satisfies it). */
export interface PadLike {
  connected: boolean;
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

/** Stick travel ignored around centre, so a worn stick doesn't drift. */
export const STICK_DEADZONE = 0.15;
/** Trigger travel ignored at rest. */
export const TRIGGER_DEADZONE = 0.05;

/** Standard-mapping button indices used here. */
const BTN = {
  a: 0,
  rb: 5,
  lt: 6,
  rt: 7,
  start: 9,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
} as const;

/**
 * Ignore `v` inside ±`dz`, then rescale the rest to reach ±1 — so the stick
 * rests at exactly 0 and still has its full range.
 */
export function deadzone(v: number, dz = STICK_DEADZONE): number {
  const a = Math.abs(v);
  if (!(a > dz)) return 0;
  return Math.sign(v) * Math.min(1, (a - dz) / (1 - dz));
}

/** A button's travel, 0..1: analog value if it reports one, else pressed. */
function travel(pad: PadLike, i: number): number {
  const b = pad.buttons[i];
  if (b === undefined) return 0;
  return b.value > 0 ? b.value : b.pressed ? 1 : 0;
}

/** Driving input from one pad's state (standard mapping). */
export function padInput(pad: PadLike): InputState {
  const out = neutralInput();
  if (!pad.connected) return out;
  out.steer = deadzone(pad.axes[0] ?? 0);
  if (out.steer === 0)
    out.steer = travel(pad, BTN.right) - travel(pad, BTN.left);
  out.throttle = Math.max(
    deadzone(travel(pad, BTN.rt), TRIGGER_DEADZONE),
    travel(pad, BTN.up),
  );
  out.brake = Math.max(
    deadzone(travel(pad, BTN.lt), TRIGGER_DEADZONE),
    travel(pad, BTN.down),
  );
  out.handbrake = travel(pad, BTN.a) > 0.5 || travel(pad, BTN.rb) > 0.5;
  return out;
}

/** The page's pads, or none where the API is missing or blocked. */
function browserPads(): readonly (PadLike | null)[] {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.getGamepads !== "function"
  )
    return [];
  try {
    return navigator.getGamepads();
  } catch {
    return []; // e.g. disallowed by an embedding iframe's permissions policy
  }
}

export class GamepadInput implements IInput {
  private startWasDown = false;

  constructor(
    private readonly pads: () => readonly (PadLike | null)[] = browserPads,
  ) {}

  private pad(): PadLike | null {
    for (const p of this.pads()) if (p !== null && p.connected) return p;
    return null;
  }

  sample(): InputState {
    const p = this.pad();
    return p === null ? neutralInput() : padInput(p);
  }

  /** True once per press of Start (the pause button); call every frame. */
  startPressed(): boolean {
    const p = this.pad();
    const down = p !== null && travel(p, BTN.start) > 0.5;
    const edge = down && !this.startWasDown;
    this.startWasDown = down;
    return edge;
  }

  // The Gamepad API is polled, not evented: nothing to attach.
  attach(): void {}
  detach(): void {}
  setKeyMap(): void {}
}
