/**
 * Menus without a mouse. A gamepad's d-pad or stick, or the arrow keys (and
 * whatever keys drive the car), move focus between a screen's buttons by
 * where they sit on screen — "down" goes to the button below, not to the next
 * one in the page — and A / Enter / Space presses the focused one.
 *
 * Every screen is rebuilt from an HTML string on each change, which drops
 * focus; `afterRender` puts it back on the same control (or the one at the
 * same place in the list), so a purchase doesn't lose the player's place.
 * The spatial pick (`pickNext`) and key mapping (`navDirFor`) are pure.
 */
import type { KeyMap } from "../core/Input.ts";

export type NavDir = "up" | "down" | "left" | "right";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Gap between spans [a0, a1] and [b0, b1] (0 when they overlap). */
function gap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.max(a0, b0) - Math.min(a1, b1));
}

/** How much spans [a0, a1] and [b0, b1] overlap (0 when they don't). */
function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/** Ranks anything lined up with the current control ahead of all else. */
const OFF_LINE = 1e6;
/** Slack (px) for a candidate's edge to count as past the current one's. */
const EDGE_SLACK = 4;

/**
 * Where to go from `from` in `dir`. Only a candidate lying wholly past
 * `from`'s edge that way counts: a button mostly below this one isn't "to
 * its left". Of those, one lined up with `from` (overlapping it across the
 * direction of travel) always wins — "up" goes to what's directly above,
 * however far — nearest first, then the one sharing the most of `from`'s
 * span. Only when nothing lines up does it reach off to the side, where the
 * sideways gap counts double. Returns an index into `candidates`, or -1
 * when nothing lies that way.
 */
export function pickNext(
  from: Rect,
  candidates: readonly Rect[],
  dir: NavDir,
): number {
  const fx = from.x + from.w / 2;
  const fy = from.y + from.h / 2;
  const vertical = dir === "up" || dir === "down";
  let best = -1;
  let bestScore = Infinity;
  candidates.forEach((c, i) => {
    const past =
      dir === "down"
        ? c.y >= from.y + from.h - EDGE_SLACK
        : dir === "up"
          ? c.y + c.h <= from.y + EDGE_SLACK
          : dir === "right"
            ? c.x >= from.x + from.w - EDGE_SLACK
            : c.x + c.w <= from.x + EDGE_SLACK;
    if (!past) return;
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    const along = vertical ? Math.abs(cy - fy) : Math.abs(cx - fx);
    const [a0, a1, b0, b1] = vertical
      ? [from.x, from.x + from.w, c.x, c.x + c.w]
      : [from.y, from.y + from.h, c.y, c.y + c.h];
    const aside = gap(a0, a1, b0, b1);
    const score =
      aside > 0
        ? OFF_LINE + along + 2 * aside
        : along - 0.01 * overlap(a0, a1, b0, b1);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/**
 * The menu direction a key means: the arrows, and whatever keys drive the car
 * (so WASD, or a rebound layout, move around the menus too).
 */
export function navDirFor(code: string, km: KeyMap): NavDir | null {
  if (code === "ArrowUp" || km.throttle.includes(code)) return "up";
  if (code === "ArrowDown" || km.brake.includes(code)) return "down";
  if (code === "ArrowLeft" || km.steerLeft.includes(code)) return "left";
  if (code === "ArrowRight" || km.steerRight.includes(code)) return "right";
  return null;
}

/** The attributes that identify a control across re-renders. */
const KEY_ATTRS = [
  "data-action",
  "data-selectcar",
  "data-selecttrack",
  "data-buy",
  "data-switchcar",
  "data-bind",
  "data-share",
] as const;

/** A control's identity, e.g. `data-buy=engine`, or null if it has none. */
function keyOf(el: Element): string | null {
  for (const a of KEY_ATTRS) {
    const v = el.getAttribute(a);
    if (v !== null) return `${a}=${v}`;
  }
  return null;
}

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/** Where focus was on a screen: the control, and its place in the list. */
interface Spot {
  key: string | null;
  index: number;
}

export class MenuNav {
  /**
   * On once the player steers the menus by keys or pad; a mouse or finger
   * turns it off. Only then is focus shown and restored after re-renders.
   */
  private active = false;
  /** The menu screen up now ("" while a race runs), whose focus is kept. */
  private screen = "";
  /** The last focused spot per screen, to come back to. */
  private readonly spots = new Map<string, Spot>();
  /** Screens that come back to where the cursor was whenever revisited. */
  private readonly keepPlace: ReadonlySet<string>;
  private readonly onFocusIn = (e: Event): void => this.remember(e.target);
  private readonly onPointer = (e: Event): void => {
    const m = e as MouseEvent;
    // A synthetic mousemove (content changed under a still cursor) isn't
    // the player picking up the mouse.
    if (e.type === "mousemove" && !m.movementX && !m.movementY) return;
    this.setActive(false);
  };

  constructor(
    private readonly root: HTMLElement,
    opts: { keepPlace?: readonly string[] } = {},
  ) {
    this.keepPlace = new Set(opts.keepPlace ?? []);
  }

  /** Wire focus tracking; a no-op outside a DOM (headless tests). */
  attach(): void {
    if (typeof this.root.addEventListener !== "function") return;
    this.root.addEventListener("focusin", this.onFocusIn);
    this.root.addEventListener("pointerdown", this.onPointer);
    this.root.addEventListener("mousemove", this.onPointer);
  }

  detach(): void {
    if (typeof this.root.removeEventListener !== "function") return;
    this.root.removeEventListener("focusin", this.onFocusIn);
    this.root.removeEventListener("pointerdown", this.onPointer);
    this.root.removeEventListener("mousemove", this.onPointer);
  }

  get isActive(): boolean {
    return this.active;
  }

  setActive(on: boolean): void {
    this.active = on;
    this.root.classList?.toggle("nav-keys", on);
  }

  /**
   * A screen's HTML was just installed. While navigating by keys or pad (and
   * on a screen with menus — not a race in progress), focus goes back where
   * it was when the same screen is redrawn (a purchase, a toggle) — to the
   * same control, or the one at its place in the list — and on a `keepPlace`
   * screen whenever it's revisited. A screen opening afresh starts on its
   * default: the pause menu on Resume, not on the Quit chosen last time.
   */
  afterRender(screen: string, navigable: boolean): void {
    const redraw = navigable && screen === this.screen;
    // A race running in between (the pause menu shares its screen) means
    // whatever menu comes next opens afresh.
    this.screen = navigable ? screen : "";
    if (!this.active || !navigable) return;
    const spot =
      redraw || this.keepPlace.has(screen) ? this.spots.get(screen) : undefined;
    const controls = this.controls();
    const again =
      spot === undefined
        ? undefined
        : (controls.find((c) => spot.key !== null && keyOf(c) === spot.key) ??
          controls[Math.min(spot.index, controls.length - 1)]);
    this.focus(again ?? this.fallback(controls));
  }

  /** Move focus `dir` from the focused control (or show the default). */
  move(dir: NavDir): void {
    this.setActive(true);
    const controls = this.controls();
    const at = this.focused(controls);
    if (at === null) {
      this.focus(this.fallback(controls));
      return;
    }
    const others = controls.filter((c) => c !== at);
    const next = pickNext(rectOf(at), others.map(rectOf), dir);
    if (next >= 0) this.focus(others[next]);
  }

  /** Press the focused control; with none focused, show the default first. */
  press(): void {
    this.setActive(true);
    const controls = this.controls();
    const at = this.focused(controls);
    if (at === null) this.focus(this.fallback(controls));
    else at.click();
  }

  /** Press the screen's main action (its `.primary` button), if it has one. */
  pressPrimary(): void {
    this.setActive(true);
    this.controls()
      .find((c) => c.classList.contains("primary"))
      ?.click();
  }

  /** Enabled, visible buttons on the current screen, in page order. */
  private controls(): HTMLElement[] {
    if (typeof this.root.querySelectorAll !== "function") return [];
    return [
      ...this.root.querySelectorAll<HTMLElement>("button:not([disabled])"),
    ].filter((b) => b.getClientRects().length > 0);
  }

  private focused(controls: HTMLElement[]): HTMLElement | null {
    const el = this.root.ownerDocument?.activeElement;
    return controls.find((c) => c === el) ?? null;
  }

  /** A screen's opening control: marked, its main action, or the first. */
  private fallback(controls: HTMLElement[]): HTMLElement | undefined {
    return (
      controls.find((c) => c.hasAttribute("data-autofocus")) ??
      controls.find((c) => c.classList.contains("primary")) ??
      controls[0]
    );
  }

  private focus(el: HTMLElement | undefined): void {
    if (el === undefined) return;
    el.focus({ preventScroll: true });
    // "nearest" honours scroll-margin, so a row never hides under the
    // menu's pinned footer.
    el.scrollIntoView?.({ block: "nearest" });
    this.remember(el);
  }

  private remember(target: EventTarget | null): void {
    const el = target as HTMLElement | null;
    if (el === null || typeof el.getAttribute !== "function") return;
    const controls = this.controls();
    const index = controls.indexOf(el);
    if (index < 0) return;
    this.spots.set(this.screen, { key: keyOf(el), index });
  }
}
