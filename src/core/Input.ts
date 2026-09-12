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

export interface IInput {
  /** Current normalized state. */
  sample(): InputState;
  /** Begin / stop listening (attach to a DOM element if needed). */
  attach(target: HTMLElement): void;
  detach(): void;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Keyboard input. Maps WASD + arrow keys to the normalized axis state.
 * Throttle/brake are on the Y axis, steer on X, handbrake on a flag.
 */
export class KeyboardInput implements IInput {
  private readonly held = new Set<string>();
  /** The element listeners attach to, so detach() matches attach(). */
  private target: HTMLElement | null = null;
  private readonly onDown: (e: KeyboardEvent) => void;
  private readonly onUp: (e: KeyboardEvent) => void;

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

  sample(): InputState {
    const h = this.held;
    const down = (code: string) => h.has(code);

    let throttle = 0;
    let brake = 0;
    let steer = 0;

    if (down("KeyW") || down("ArrowUp")) throttle = 1;
    if (down("KeyS") || down("ArrowDown")) brake = 1;
    if (down("KeyA") || down("ArrowLeft")) steer = -1;
    if (down("KeyD") || down("ArrowRight")) steer = 1;

    return {
      throttle: clamp01(throttle),
      brake: clamp01(brake),
      steer,
      handbrake: down("Space"),
    };
  }
}
