/**
 * On-screen touch controls behind the `IInput` seam. The buttons are plain
 * DOM (`[data-touch]` elements in the race overlay, shown only on touch
 * screens by CSS); this listens for pointer events delegated from a root, so
 * the overlay can be re-rendered freely. Each finger is tracked on its own —
 * steer with one thumb while the other holds the gas — and a finger can slide
 * from one button to another (◀ to ▶) without lifting.
 */
import type { IInput, InputState } from "./Input.ts";

export type TouchControl = "left" | "right" | "gas" | "brake" | "drift";

const CONTROLS: readonly TouchControl[] = [
  "left",
  "right",
  "gas",
  "brake",
  "drift",
];

/** Held controls -> driving input. Pure. */
export function touchInput(held: ReadonlySet<TouchControl>): InputState {
  return {
    throttle: held.has("gas") ? 1 : 0,
    brake: held.has("brake") ? 1 : 0,
    steer: (held.has("right") ? 1 : 0) - (held.has("left") ? 1 : 0),
    handbrake: held.has("drift"),
  };
}

/** The control an element belongs to, if it's (inside) a touch button. */
function controlOf(el: unknown): TouchControl | null {
  const hit = (el as Element | null)?.closest?.("[data-touch]");
  const c = hit?.getAttribute("data-touch");
  return CONTROLS.includes(c as TouchControl) ? (c as TouchControl) : null;
}

export class TouchInput implements IInput {
  /** Each finger on a control: pointerId -> the control under it. */
  private readonly fingers = new Map<number, TouchControl>();
  private root: HTMLElement | null = null;
  private win: Window | null = null;
  private readonly onDown = (e: PointerEvent): void => this.down(e);
  private readonly onMove = (e: PointerEvent): void => this.move(e);
  private readonly onUp = (e: PointerEvent): void => this.lift(e.pointerId);
  private readonly onBlur = (): void => this.release();

  private down(e: PointerEvent): void {
    const c = controlOf(e.target);
    if (c === null) return;
    // No text selection, callout or emulated mouse clicks from a held button.
    e.preventDefault();
    this.fingers.set(e.pointerId, c);
    this.paint();
  }

  private move(e: PointerEvent): void {
    if (!this.fingers.has(e.pointerId)) return;
    // Touch pointers stay captured by the element they went down on, so ask
    // what's under the finger now: sliding ◀ -> ▶ switches, sliding off lets go.
    const under = this.root?.ownerDocument?.elementFromPoint?.(
      e.clientX,
      e.clientY,
    );
    const c = controlOf(under);
    if (c === null) this.fingers.delete(e.pointerId);
    else this.fingers.set(e.pointerId, c);
    this.paint();
  }

  private lift(pointerId: number): void {
    if (this.fingers.delete(pointerId)) this.paint();
  }

  /** Let go of everything (focus lost, or detached). */
  private release(): void {
    this.fingers.clear();
    this.paint();
  }

  /** Light up held buttons: a finger covers the one it's pressing. */
  private paint(): void {
    const held = new Set(this.fingers.values());
    const buttons = this.root?.querySelectorAll?.("[data-touch]") ?? [];
    for (const b of buttons)
      b.classList.toggle("held", held.has(controlOf(b) as TouchControl));
  }

  sample(): InputState {
    return touchInput(new Set(this.fingers.values()));
  }

  attach(root: HTMLElement): void {
    this.detach();
    this.root = root;
    root.addEventListener("pointerdown", this.onDown);
    root.addEventListener("pointermove", this.onMove);
    root.addEventListener("pointerup", this.onUp);
    root.addEventListener("pointercancel", this.onUp);
    this.win = root.ownerDocument?.defaultView ?? null;
    this.win?.addEventListener("blur", this.onBlur);
  }

  detach(): void {
    this.root?.removeEventListener("pointerdown", this.onDown);
    this.root?.removeEventListener("pointermove", this.onMove);
    this.root?.removeEventListener("pointerup", this.onUp);
    this.root?.removeEventListener("pointercancel", this.onUp);
    this.win?.removeEventListener("blur", this.onBlur);
    this.fingers.clear();
    this.root = null;
    this.win = null;
  }

  setKeyMap(): void {}
}
