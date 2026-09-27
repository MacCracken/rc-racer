/**
 * Menu input, decided here and routed by the Game: what a key or a gamepad
 * press does on a menu (the pause menu too), and the latches that keep a
 * control still held from driving from pressing anything when a menu opens
 * over a race. Moving focus and pressing buttons is `MenuNav`'s; leaving a
 * screen is the Game's, and `backStep` tells it what "back" means where.
 */
import { navDirFor, type MenuNav } from "./MenuNav.ts";
import type { KeyMap } from "../core/Input.ts";
import type { PadMenuPress } from "../core/Gamepad.ts";

/** The slice of `MenuNav` the menus drive (a test can stand in for it). */
export type NavLike = Pick<
  MenuNav,
  "move" | "press" | "pressPrimary" | "setActive" | "afterRender"
>;

/** A key event, as far as the menus care. */
export interface MenuKey {
  code: string;
  repeat: boolean;
  preventDefault(): void;
}

/** What backing out (a pad's B) does on a screen. */
export type BackStep =
  "exit-replay" | "resume" | "cancel-rebind" | "to-menu" | "stay";

/**
 * Back out of a screen: a replay goes back to its results, a paused race
 * resumes, a pending key capture is cancelled, and anything else returns to
 * the main menu. Nothing from the main menu itself, or from a race running.
 */
export function backStep(s: {
  screen: string;
  paused: boolean;
  rebinding: boolean;
}): BackStep {
  if (s.screen === "replay") return "exit-replay";
  if (s.screen === "race") return s.paused ? "resume" : "stay";
  if (s.rebinding) return "cancel-rebind";
  return s.screen === "menu" ? "stay" : "to-menu";
}

export class MenuInput {
  /** Whether the last screen shown was a race in progress (no menus). */
  private wasRacing = false;
  /**
   * Set when a menu opens over a race: key auto-repeat (a throttle key held
   * over the finish line) is ignored until a fresh key press, like the pad.
   */
  private keysLatched = false;

  constructor(private readonly nav: NavLike) {}

  /**
   * A screen's HTML was just installed (`racing`: it's a race in progress,
   * with no menus). A menu that opens over a race — the results, the pause
   * menu — first latches `pad` and the keys, so a button still held from
   * driving isn't taken as a press; then focus goes back to a key or pad
   * player.
   */
  shown(screen: string, racing: boolean, pad: { latch(): void }): void {
    if (!racing && this.wasRacing) {
      pad.latch();
      this.keysLatched = true;
    }
    this.wasRacing = racing;
    this.nav.afterRender(screen, !racing);
  }

  /**
   * A key on a menu: Enter / Space press the focused button; the arrows, or
   * the driving keys, move between buttons. True when it was one of those,
   * so no other shortcut acts on it. Tab wakes the focus ring but is left to
   * the browser. The press keys and Tab come first, so a driving key bound
   * to one of them still does its menu job.
   */
  key(e: MenuKey, km: KeyMap): boolean {
    if (!e.repeat) this.keysLatched = false;
    if (e.code === "Enter" || e.code === "NumpadEnter" || e.code === "Space") {
      // This press is the only one: no native click on top of it.
      e.preventDefault();
      if (!e.repeat) this.nav.press();
      return true;
    }
    if (e.code === "Tab") {
      this.nav.setActive(true);
      return false;
    }
    const dir = navDirFor(e.code, km);
    if (dir === null) return false;
    e.preventDefault();
    if (!this.keysLatched) this.nav.move(dir);
    return true;
  }

  /**
   * A frame's pad presses on a menu, one thing a frame (a press can change
   * the screen under the next one): Start presses the screen's main action,
   * A the focused button, a direction moves. B is handed back, as "back",
   * for the Game to take (see `backStep`).
   */
  pad(press: PadMenuPress): "back" | null {
    if (press.start) this.nav.pressPrimary();
    else if (press.b) return "back";
    else if (press.a) this.nav.press();
    else if (press.dir !== null) this.nav.move(press.dir);
    return null;
  }
}
