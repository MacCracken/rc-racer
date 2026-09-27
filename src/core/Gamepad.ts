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
import type { NavDir } from "../ui/MenuNav.ts";

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
  b: 1,
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

/** What a pad holds, as the menus read it. */
export interface PadMenuState {
  /** D-pad, or the left stick pushed past halfway along its main axis. */
  dir: NavDir | null;
  /** A confirms, B goes back, Start is the screen's main action. */
  a: boolean;
  b: boolean;
  start: boolean;
}

/** Menu presses since the last poll (what `PadRepeater` turns holds into). */
export type PadMenuPress = PadMenuState;

const IDLE_MENU: PadMenuState = {
  dir: null,
  a: false,
  b: false,
  start: false,
};

/** How far the stick must lean before it counts as a menu direction. */
const MENU_STICK = 0.5;

/** A pad's held menu state (standard mapping). */
export function padMenuState(pad: PadLike): PadMenuState {
  if (!pad.connected) return IDLE_MENU;
  const held = (i: number): boolean => travel(pad, i) > 0.5;
  const sx = pad.axes[0] ?? 0;
  const sy = pad.axes[1] ?? 0;
  let dir: NavDir | null = null;
  if (held(BTN.up)) dir = "up";
  else if (held(BTN.down)) dir = "down";
  else if (held(BTN.left)) dir = "left";
  else if (held(BTN.right)) dir = "right";
  else if (Math.max(Math.abs(sx), Math.abs(sy)) > MENU_STICK)
    dir =
      Math.abs(sx) > Math.abs(sy)
        ? sx > 0
          ? "right"
          : "left"
        : sy > 0
          ? "down"
          : "up";
  return { dir, a: held(BTN.a), b: held(BTN.b), start: held(BTN.start) };
}

/** A held direction repeats after this long (ms)… */
export const NAV_REPEAT_DELAY_MS = 380;
/** …then every this often, like a key's auto-repeat. */
export const NAV_REPEAT_EVERY_MS = 130;

/**
 * Held pad state -> menu presses. A button presses once per push; a held
 * direction presses, pauses, then repeats. `latch()` ignores everything held
 * right now until the pad is let go: the A still held from a handbrake slide
 * over the finish line mustn't press a button on the results. Pure (the
 * caller supplies the clock).
 */
export class PadRepeater {
  private prev: PadMenuState = IDLE_MENU;
  private dirSince = 0;
  private lastRepeat = 0;
  private latched = false;

  latch(): void {
    this.latched = true;
  }

  update(held: PadMenuState, nowMs: number): PadMenuPress {
    if (this.latched) {
      const idle = held.dir === null && !held.a && !held.b && !held.start;
      this.prev = held;
      if (!idle) return IDLE_MENU;
      this.latched = false;
    }
    let dir: NavDir | null = null;
    if (held.dir !== null) {
      if (held.dir !== this.prev.dir) {
        dir = held.dir;
        this.dirSince = nowMs;
        this.lastRepeat = nowMs;
      } else if (
        nowMs - this.dirSince >= NAV_REPEAT_DELAY_MS &&
        nowMs - this.lastRepeat >= NAV_REPEAT_EVERY_MS
      ) {
        dir = held.dir;
        this.lastRepeat = nowMs;
      }
    }
    const press: PadMenuPress = {
      dir,
      a: held.a && !this.prev.a,
      b: held.b && !this.prev.b,
      start: held.start && !this.prev.start,
    };
    this.prev = held;
    return press;
  }
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
  private readonly repeater = new PadRepeater();

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

  /**
   * The pad's menu presses since the last poll: Start, A, B, and a d-pad or
   * stick direction (repeating while held). Call once per frame, racing or
   * not, so a button held through a screen change isn't read as a new press.
   */
  poll(nowMs: number): PadMenuPress {
    const p = this.pad();
    return this.repeater.update(
      p === null ? IDLE_MENU : padMenuState(p),
      nowMs,
    );
  }

  /** Ignore what's held now until it's released (a new screen opened). */
  latch(): void {
    this.repeater.latch();
  }

  /** True once per press of Start (the pause button); call every frame. */
  startPressed(): boolean {
    return this.poll(performance.now()).start;
  }

  // The Gamepad API is polled, not evented: nothing to attach.
  attach(): void {}
  detach(): void {}
  setKeyMap(): void {}
}
