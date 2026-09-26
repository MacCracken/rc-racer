import { describe, it, expect } from "vitest";
import {
  deadzone,
  padInput,
  GamepadInput,
  STICK_DEADZONE,
  type PadLike,
} from "../src/core/Gamepad.ts";

/** A standard-mapping pad at rest, with overrides by button index. */
function pad(
  axes: number[] = [0, 0, 0, 0],
  held: Record<number, number> = {},
  connected = true,
): PadLike {
  return {
    connected,
    axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({
      pressed: (held[i] ?? 0) > 0.5,
      value: held[i] ?? 0,
    })),
  };
}

describe("Gamepad — mapping a pad to driving input", () => {
  it("a stick at rest (or barely off-centre) is exactly zero", () => {
    expect(deadzone(0)).toBe(0);
    expect(deadzone(STICK_DEADZONE * 0.9)).toBe(0);
    expect(deadzone(-STICK_DEADZONE)).toBe(0);
  });

  it("past the deadzone the stick keeps its full, proportional range", () => {
    expect(deadzone(1)).toBe(1);
    expect(deadzone(-1)).toBe(-1);
    const half = deadzone(0.5);
    expect(half).toBeGreaterThan(0.3);
    expect(half).toBeLessThan(0.5);
    expect(deadzone(2)).toBe(1); // clamped
  });

  it("left stick steers analog; the d-pad steers when the stick is idle", () => {
    expect(padInput(pad([0.6, 0])).steer).toBeCloseTo(deadzone(0.6), 9);
    expect(padInput(pad([0, 0], { 14: 1 })).steer).toBe(-1); // d-pad left
    expect(padInput(pad([0, 0], { 15: 1 })).steer).toBe(1); // d-pad right
  });

  it("RT is gas and LT brake, both analog; A or RB is the handbrake", () => {
    const i = padInput(pad([0, 0], { 7: 0.7, 6: 0.3 }));
    expect(i.throttle).toBeGreaterThan(0.6);
    expect(i.throttle).toBeLessThan(0.7);
    expect(i.brake).toBeGreaterThan(0.2);
    expect(padInput(pad([0, 0], { 0: 1 })).handbrake).toBe(true);
    expect(padInput(pad([0, 0], { 5: 1 })).handbrake).toBe(true);
    expect(padInput(pad()).handbrake).toBe(false);
  });

  it("d-pad up / down back up the triggers on pads without them", () => {
    expect(padInput(pad([0, 0], { 12: 1 })).throttle).toBe(1);
    expect(padInput(pad([0, 0], { 13: 1 })).brake).toBe(1);
  });

  it("a disconnected pad drives nothing", () => {
    expect(padInput(pad([1, 0], { 7: 1 }, false))).toEqual({
      throttle: 0,
      brake: 0,
      steer: 0,
      handbrake: false,
    });
  });
});

describe("GamepadInput — polling the browser's pads", () => {
  it("reads the first connected pad, and nothing when there is none", () => {
    let pads: (PadLike | null)[] = [];
    const g = new GamepadInput(() => pads);
    expect(g.sample().throttle).toBe(0);
    pads = [null, pad([0, 0], { 7: 1 }, false), pad([0, 0], { 7: 1 })];
    expect(g.sample().throttle).toBe(1);
  });

  it("reports Start once per press, not on every frame it's held", () => {
    let held = false;
    const g = new GamepadInput(() => [pad([0, 0], { 9: held ? 1 : 0 })]);
    expect(g.startPressed()).toBe(false);
    held = true;
    expect(g.startPressed()).toBe(true);
    expect(g.startPressed()).toBe(false); // still held
    held = false;
    expect(g.startPressed()).toBe(false);
    held = true;
    expect(g.startPressed()).toBe(true);
  });
});
