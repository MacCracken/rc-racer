/**
 * Input abstraction. The simulation reads a normalized `InputState` (no key
 * codes, no event objects), so the source of that state — keyboard, touch,
 * gamepad — is swappable without touching the loop or the physics.
 */
export interface InputState {
   /** -1..1, axis: positive = full throttle. */
  throttle: number;
   /** -1..1, axis: positive = full brake/reverse. */
  brake: number;
   /** -1..1, axis: positive = steer right. */
  steer: number;
   /** true = handbrake / drift. */
  handbrake: boolean;
}

export const neutralInput = (): InputState => ({
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
});

/**
 * A remappable binding table: each action -> the key codes that trigger it
 * (`e.code` values, e.g. "KeyW", "ArrowUp"). Kept separate from `KeyboardInput`
 * so bindings persist and rebind without the input class changing shape.
 */
export interface KeyMap {
  throttle: string[];
  brake: string[];
  steerLeft: string[];
  steerRight: string[];
  handbrake: string[];
}

export function defaultKeyMap(): KeyMap {
  return {
    throttle: ["KeyW", "ArrowUp"],
    brake: ["KeyS", "ArrowDown"],
    steerLeft: ["KeyA", "ArrowLeft"],
    steerRight: ["KeyD", "ArrowRight"],
    handbrake: ["Space"],
    };
}

/**
 * The five drivable actions. Rebinding in the settings UI means pointing a code
 * at one of these; the UI enumerates this list.
 */
export type KeyAction =
   | "throttle"
   | "brake"
   | "steerLeft"
   | "steerRight"
   | "handbrake";

export const KEY_ACTIONS: KeyAction[] = [
   "throttle",
   "brake",
   "steerLeft",
   "steerRight",
   "handbrake",
];

/**
 * Pure: a set of held key codes -> normalized input, via a `KeyMap`. This is
 * the single source of truth for "what these keys mean", shared by
 * `KeyboardInput.sample` and the rebind logic, and unit-testable with no DOM.
 */
export function inputFrom(
  held: ReadonlySet<string>,
  km: KeyMap,
): InputState {
  const has = (codes: string[]): boolean => codes.some((c) => held.has(c));
  let throttle = 0;
  let brake = 0;
  let steer = 0;
  if (has(km.throttle)) throttle = 1;
  if (has(km.brake)) brake = 1;
   // Left resolved first, then right, so a both-held case mirrors the original
   // precedence (right wins).
  if (has(km.steerLeft)) steer = -1;
  if (has(km.steerRight)) steer = 1;
  return {
    throttle: clamp01(throttle),
    brake: clamp01(brake),
    steer,
    handbrake: has(km.handbrake),
    };
}

export interface IInput {
   /** Current normalized state. */
  sample(): InputState;
   /** Begin / stop listening (attach to a DOM element if needed). */
  attach(target: HTMLElement): void;
  detach(): void;
   /** Swap the binding table live (a rebind); the next sample uses it. */
  setKeyMap(km: KeyMap): void;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Keyboard input. Maps WASD + arrow keys to the normalized axis state via a
 * `KeyMap` (rebindable). Throttle/brake on the Y axis, steer on X, handbrake a
 * flag.
 */
export class KeyboardInput implements IInput {
  private readonly held = new Set<string>();
   /** The element listeners attach to, so detach() matches attach(). */
  private target: HTMLElement | null = null;
  private readonly onDown: (e: KeyboardEvent) => void;
  private readonly onUp: (e: KeyboardEvent) => void;
  private km: KeyMap = defaultKeyMap();

  constructor() {
    this.onDown = (e: KeyboardEvent) => this.set(e, true);
    this.onUp = (e: KeyboardEvent) => this.set(e, false);
   }

  private set(e: KeyboardEvent, down: boolean): void {
    if (down) e.preventDefault();
     (this.held as Set<string>)[down ? "add" : "delete"](e.code);
    }

  attach(target: HTMLElement): void {
    this.target = target;
    target.addEventListener("keydown", this.onDown);
    target.addEventListener("keyup", this.onUp);
    target.tabIndex = 0;
    }

  detach(): void {
    this.target?.removeEventListener("keydown", this.onDown);
    this.target?.removeEventListener("keyup", this.onUp);
    this.target = null;
    }

   /** Swap the binding table live (a rebind); the next sample uses it. */
  setKeyMap(km: KeyMap): void {
    this.km = km;
     }

  sample(): InputState {
    return inputFrom(this.held, this.km);
     }
}
