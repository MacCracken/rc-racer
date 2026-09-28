import {
  test,
  expect,
  seedSave,
  ONBOARDED,
  clockMs,
  screen,
  markGrid,
  movedFromGrid,
  finishRaceFast,
  fakePad,
  tapPad,
  PAD,
} from "./fixtures.ts";
import { UPGRADE_TREE } from "../src/game/upgrades.ts";

const start = '[data-action="start"]';
/** The balance after buying the first engine tier with 500 cr. */
const afterEngine = `${500 - UPGRADE_TREE.find((u) => u.id === "engine")!.tiers[0].cost} cr`;

test("first launch opens How to Play, then a menu with Start in view", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("How to Play — RC Racer")).toBeVisible();
  await page.locator('[data-action="close-onboarding"]').click();
  await expect(page.locator(".screen-menu")).toBeVisible();
  await expect(page.locator(start)).toBeInViewport();
  await page.reload(); // seen once: the next launch goes straight to the menu
  await expect(page.locator(".screen-menu")).toBeVisible();
});

test("a race: the lights hold the grid, then the car drives; pause freezes it", async ({
  page,
}) => {
  await seedSave(page, ONBOARDED);
  await page.goto("/");
  await page.locator(start).click();
  await markGrid(page);
  await expect(page.locator('[data-touch="gas"]')).toBeHidden(); // desktop
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(1500);
  expect(await movedFromGrid(page)).toBe(0); // throttle held at the lights
  await expect
    .poll(() => movedFromGrid(page), { timeout: 6000 })
    .toBeGreaterThan(40);
  await page.keyboard.up("KeyW");

  await page.keyboard.press("Escape");
  await expect(page.locator('[data-action="resume"]')).toBeVisible();
  const frozen = await clockMs(page);
  await page.waitForTimeout(400);
  expect(await clockMs(page)).toBe(frozen);
  await page.locator('[data-action="resume"]').click();
  await expect.poll(() => clockMs(page)).toBeGreaterThan(frozen);

  // Alt-tab: losing focus pauses the race by itself.
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.locator('[data-action="resume"]')).toBeVisible();
  await page.keyboard.press("KeyQ");
  await expect(page.locator(".screen-menu")).toBeVisible();
});

test("a finished race itemises its payout, and the menu shows the new best", async ({
  page,
}) => {
  await seedSave(page, ONBOARDED);
  await page.goto("/");
  await page.locator(start).click();
  await finishRaceFast(page);
  expect(await screen(page)).toBe("results");
  await expect(page.locator(".results-panel")).toContainText("NEW RECORD");
  await expect(page.locator(".reward-parts")).toContainText("Finish +");
  await page.keyboard.press("Escape");
  await expect(page.locator(".track-row.selected")).toContainText("best");
});

test("garage: a purchase spends credits, shows at once, and survives a reload", async ({
  page,
}) => {
  await seedSave(page, { ...ONBOARDED, credits: 500 });
  await page.goto("/");
  await page.locator('[data-action="garage"]').click();
  await expect(page.locator(".balance2")).toHaveText("500 cr");
  await page.locator('[data-buy="engine"]').click();
  await expect(page.locator(".balance2")).toHaveText(afterEngine);
  await expect(page.locator('[data-buy="engine"]')).toContainText("L1/4");
  await page.reload();
  await page.locator('[data-action="garage"]').click();
  await expect(page.locator(".balance2")).toHaveText(afterEngine);
});

test("settings: rebind a key by pressing it; reserved keys are refused", async ({
  page,
}) => {
  await seedSave(page, ONBOARDED);
  await page.goto("/");
  await page.locator('[data-action="settings"]').click();
  const handbrake = page.locator('[data-bind="handbrake"]');
  await handbrake.click();
  await expect(handbrake).toHaveText("Press a key…");
  await page.keyboard.press("KeyQ");
  await expect(page.locator(".rebind-hint")).toContainText("Q is reserved");
  await page.keyboard.press("KeyE");
  await expect(handbrake).toHaveText("E");
  await page.locator('[data-action="close-settings"]').click();
  await expect(page.locator(".menu-footer .hint")).toContainText("E handbrake");
});

test("a 0-px canvas (a hidden embed) doesn't stop the frame loop", async ({
  page,
}) => {
  await seedSave(page, ONBOARDED);
  await page.goto("/");
  await page.locator(start).click();
  type Handles = {
    renderer: { resize(w: number, h: number, dpr: number): void };
    game: { lastFrameMs: number };
  };
  await page.evaluate(() =>
    (window as unknown as Handles).renderer.resize(800, 0, 1),
  );
  const frameAt = () =>
    page.evaluate(() => (window as unknown as Handles).game.lastFrameMs);
  const before = await frameAt();
  await expect.poll(frameAt).toBeGreaterThan(before); // still ticking
});

test("resizing to a phone re-frames the menu backdrop", async ({ page }) => {
  await seedSave(page, ONBOARDED);
  await page.goto("/");
  const zoom = () =>
    page.evaluate(
      () =>
        (window as unknown as { game: { camera: { zoom: number } } }).game
          .camera.zoom,
    );
  const desktop = await zoom();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(zoom).toBeLessThan(desktop * 0.8);
});

test("the menus work from the keyboard: arrows move, Enter picks, Esc backs out", async ({
  page,
}) => {
  await seedSave(page, { ...ONBOARDED, credits: 500 });
  await page.goto("/");
  await page.keyboard.press("ArrowDown"); // the first press shows the cursor
  await expect(page.locator(start)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-action="garage"]')).toBeFocused();
  await page.keyboard.press("Enter");
  // The garage opens on its first upgrade; buying it keeps the cursor there.
  await expect(page.locator('[data-buy="engine"]')).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".balance2")).toHaveText(afterEngine);
  await expect(page.locator('[data-buy="engine"]')).toBeFocused();
  // Back on the menu, the cursor is where it was.
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-action="garage"]')).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Space");
  await expect.poll(() => screen(page)).toBe("race");
});

test("a gamepad works the menus: d-pad moves, A picks, B backs out, Start pauses", async ({
  page,
}) => {
  await fakePad(page);
  await seedSave(page, ONBOARDED);
  await page.goto("/");
  await tapPad(page, PAD.down);
  await expect(page.locator(start)).toBeFocused();
  await tapPad(page, PAD.a);
  await expect.poll(() => screen(page)).toBe("race");

  await tapPad(page, PAD.start);
  await expect(page.locator('[data-action="resume"]')).toBeFocused();
  await tapPad(page, PAD.b); // B resumes
  await expect(page.locator('[data-action="pause"]')).toBeVisible();

  await tapPad(page, PAD.start);
  await tapPad(page, PAD.down);
  await tapPad(page, PAD.down);
  await expect(page.locator('[data-action="quit"]')).toBeFocused();
  await tapPad(page, PAD.a);
  await expect(page.locator(".screen-menu")).toBeVisible();
  await expect(page.locator(start)).toBeFocused();
});

test("a finished race can be watched back, then it's back to the results", async ({
  page,
}) => {
  await seedSave(page, ONBOARDED);
  await page.goto("/");
  await page.locator(start).click();
  await finishRaceFast(page);
  await page.locator('[data-action="replay"]').click();
  await expect(page.locator('[data-action="replay-toggle"]')).toHaveText(
    "⏸ Pause",
  );
  const replayMs = () =>
    page.evaluate(
      () =>
        (window as unknown as { game: { replays: { ms: number } } }).game
          .replays.ms,
    );
  await expect.poll(replayMs).toBeGreaterThan(300); // it's playing
  await page.locator('[data-action="replay-speed"]').click();
  await expect(page.locator('[data-action="replay-speed"]')).toHaveText("2×");
  await page.locator('[data-action="replay-exit"]').click();
  await expect(page.locator(".results-panel")).toContainText("RACE RESULT");
});

test("records keep your best laps, and copy one to share", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await seedSave(page, ONBOARDED);
  await page.goto("/");
  await page.locator(start).click();
  await finishRaceFast(page);
  await page.locator('[data-action="menu"]').click();
  await page.locator('[data-action="records"]').click();
  await expect(page.locator(".board-card").first()).toContainText(
    "Street Sedan",
  );
  await page.locator('[data-share="overture"]').click();
  await expect(page.locator('[data-share="overture"]')).toHaveText("Copied ✓");
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toMatch(
    /^RC Racer · Overture: \d:\d\d\.\d{3} in the Street Sedan\. Beat it\? http:\/\/localhost:4173\/$/,
  );
});

test("the pause menu opens on Resume every time, whatever was picked last", async ({
  page,
}) => {
  await fakePad(page);
  await seedSave(page, ONBOARDED);
  await page.goto("/");
  await tapPad(page, PAD.down); // the cursor appears on Start
  await tapPad(page, PAD.a);
  await expect.poll(() => screen(page)).toBe("race");
  await tapPad(page, PAD.start);
  await tapPad(page, PAD.down);
  await expect(page.locator('[data-action="restart"]')).toBeFocused();
  await tapPad(page, PAD.a); // restart the race…
  await expect(page.locator('[data-action="pause"]')).toBeVisible();
  await tapPad(page, PAD.start); // …and pause it again
  await expect(page.locator('[data-action="resume"]')).toBeFocused();
});
