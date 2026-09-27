import {
  test,
  expect,
  seedSave,
  ONBOARDED,
  markGrid,
  movedFromGrid,
} from "./fixtures.ts";

test("on a phone, holding the on-screen GAS and ▶ drives the car", async ({
  page,
  context,
}) => {
  await seedSave(page, ONBOARDED);
  await page.goto("/");
  await page.locator('[data-action="start"]').tap();
  const gas = await page.locator('[data-touch="gas"]').boundingBox();
  const right = await page.locator('[data-touch="right"]').boundingBox();
  expect(gas && right).toBeTruthy();
  await markGrid(page);

  // Two fingers down and held (Playwright's touchscreen can only tap).
  const at = (
    b: { x: number; y: number; width: number; height: number },
    id: number,
  ) => ({
    x: b.x + b.width / 2,
    y: b.y + b.height / 2,
    id,
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [at(gas!, 1), at(right!, 2)],
  });
  await expect(page.locator(".touch-btn.held")).toHaveCount(2);
  await expect
    .poll(() => movedFromGrid(page), { timeout: 8000 })
    .toBeGreaterThan(40);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator(".touch-btn.held")).toHaveCount(0);
});
