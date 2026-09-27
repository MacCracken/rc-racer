import { test as base, expect, type Page } from "@playwright/test";

/**
 * Shared e2e plumbing. Every test fails if the page throws or logs a console
 * error. Game state is read through the `game` debug handle main.ts puts on
 * `window`.
 */
export const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
      page.on("console", (m) => {
        if (m.type() === "error") problems.push(`console: ${m.text()}`);
      });
      await use(problems);
      expect(problems, "errors in the page").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

const SAVE_KEY = "rc-racer-save";

/**
 * Boot on a given save. Seeded only when none exists yet, so a reload keeps
 * what the game saved since.
 */
export async function seedSave(page: Page, save: object): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    },
    [SAVE_KEY, JSON.stringify(save)] as const,
  );
}

/** A save that has seen How to Play, so boot lands on the menu. */
export const ONBOARDED = { settings: { onboarded: true } };

/** The slice of the Game the tests read (private in TS, plain in JS). */
interface GameHandle {
  screen: string;
  clockMs: number;
  paused: boolean;
  arena: {
    track: { centerLine: { x: number; y: number }[] };
    cars: {
      body: {
        position: { x: number; y: number };
        velocity: { x: number; y: number };
        angle: number;
      };
    }[];
  };
  input: unknown;
  onStep(dt: number): void;
}
type Win = Window & { game: GameHandle; __grid?: { x: number; y: number } };

export const clockMs = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as Win).game.clockMs);

export const screen = (page: Page): Promise<string> =>
  page.evaluate(() => (window as unknown as Win).game.screen);

/** Remember where the player's car sits now (call on the grid). */
export const markGrid = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const w = window as unknown as Win;
    const p = w.game.arena.cars[0].body.position;
    w.__grid = { x: p.x, y: p.y };
  });

/** How far (px) the player's car has moved from where `markGrid` saw it. */
export const movedFromGrid = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const w = window as unknown as Win;
    const p = w.game.arena.cars[0].body.position;
    const g = w.__grid ?? p;
    return Math.hypot(p.x - g.x, p.y - g.y);
  });

/**
 * Finish the current race in-page: a simple pursuit autopilot drives, and
 * the sim is stepped directly instead of waiting a minute of real time.
 */
export async function finishRaceFast(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = (window as unknown as Win).game;
    const cl = g.arena.track.centerLine;
    g.input = {
      attach() {},
      detach() {},
      setKeyMap() {},
      sample() {
        const b = g.arena.cars[0].body;
        let near = 0;
        let best = Infinity;
        cl.forEach((c, i) => {
          const d = (c.x - b.position.x) ** 2 + (c.y - b.position.y) ** 2;
          if (d < best) [best, near] = [d, i];
        });
        const t = cl[(near + 5) % cl.length];
        let e = Math.atan2(t.y - b.position.y, t.x - b.position.x) - b.angle;
        e = Math.atan2(Math.sin(e), Math.cos(e));
        return {
          throttle: Math.abs(e) > 0.5 ? 0.5 : 1,
          brake: 0,
          steer: Math.max(-1, Math.min(1, e * 1.6)),
          handbrake: false,
        };
      },
    };
    for (let i = 0; i < 120 * 180 && g.screen === "race"; i++)
      g.onStep(1 / 120);
  });
}
