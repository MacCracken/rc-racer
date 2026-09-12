import { describe, it, expect } from "vitest";
import { Camera } from "../src/core/Camera.ts";

describe("Camera", () => {
  it("centers a world point at the screen centre when it is the view target", () => {
    const cam = new Camera({ x: 100, y: 50 }, 800, 600, 1);
    // A world point equal to the view maps to the screen centre.
    const c = cam.toScreen({ x: 100, y: 50 });
    expect(c.x).toBeCloseTo(400, 5);
    expect(c.y).toBeCloseTo(300, 5);
  });

  it("zoom scales world→screen distance around the centre", () => {
    const cam = new Camera({ x: 0, y: 0 }, 800, 600, 2);
    // 10 world px away, zoom 2 → 20 screen px from centre (400,300).
    const p = cam.toScreen({ x: 10, y: 0 });
    expect(p.x - 400).toBeCloseTo(20, 5);
    expect(p.y - 300).toBeCloseTo(0, 5);
  });

  it("lerpTo converges toward the desired target (camera follows the car)", () => {
    const cam = new Camera({ x: 0, y: 0 }, 800, 600, 1);
    // Simulate a car driving to (300, 200); the camera must end up near it.
    for (let i = 0; i < 240; i++) cam.lerpTo({ x: 300, y: 200 }, 14, 1 / 60);
    expect(Math.abs(cam.view.x - 300)).toBeLessThan(5);
    expect(Math.abs(cam.view.y - 200)).toBeLessThan(5);
  });

  it("a frozen camera (no lerpTo) drifts away — the bug the follow fixes", () => {
    const cam = new Camera({ x: 0, y: 0 }, 800, 600, 1);
    // Without any update the view stays put: the car would leave the frame.
    cam.lerpTo({ x: 0, y: 0 }, 0, 1); // rate 0 → no move
    expect(cam.view.x).toBe(0);
    expect(cam.view.y).toBe(0);
  });
});
