import { describe, it, expect } from "vitest";
import {
  deadzone,
  padInput,
  padMenuState,
  GamepadInput,
  NAV_REPEAT_DELAY_MS,
  NAV_REPEAT_EVERY_MS,
  PadRepeater,
  STICK_DEADZONE,
  type PadLike,
  type PadMenuState,
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

describe("Gamepad — the menus", () => {
  it("reads the d-pad, or a stick pushed past halfway, as a direction", () => {
    expect(padMenuState(pad()).dir).toBeNull();
    expect(padMenuState(pad([0, 0], { 13: 1 })).dir).toBe("down");
    expect(padMenuState(pad([0, 0], { 14: 1 })).dir).toBe("left");
    expect(padMenuState(pad([0.3, -0.2])).dir).toBeNull(); // a nudge
    expect(padMenuState(pad([0.2, -0.9])).dir).toBe("up");
    expect(padMenuState(pad([0.8, 0.6])).dir).toBe("right"); // its main axis
    const held = padMenuState(pad([0, 0], { 0: 1, 1: 1, 9: 1 }));
    expect([held.a, held.b, held.start]).toEqual([true, true, true]);
    expect(padMenuState(pad([0, 0], { 0: 1 }, false)).a).toBe(false);
  });

  const state = (s: Partial<PadMenuState> = {}): PadMenuState => ({
    dir: null,
    a: false,
    b: false,
    start: false,
    ...s,
  });

  it("presses a button once per push", () => {
    const r = new PadRepeater();
    expect(r.update(state({ a: true }), 0).a).toBe(true);
    expect(r.update(state({ a: true }), 16).a).toBe(false); // held
    expect(r.update(state(), 32).a).toBe(false);
    expect(r.update(state({ a: true }), 48).a).toBe(true);
  });

  it("repeats a held direction after a pause, then steadily", () => {
    const r = new PadRepeater();
    const down = state({ dir: "down" });
    const presses: number[] = [];
    for (let t = 0; t <= 1000; t += 10)
      if (r.update(down, t).dir === "down") presses.push(t);
    expect(presses[0]).toBe(0);
    expect(presses[1]).toBe(NAV_REPEAT_DELAY_MS);
    expect(presses[2] - presses[1]).toBe(NAV_REPEAT_EVERY_MS);
    // A new direction presses at once.
    expect(r.update(state({ dir: "left" }), 1010).dir).toBe("left");
  });

  it("ignores what's held when a screen opens until it's let go", () => {
    const r = new PadRepeater();
    r.update(state({ a: true, dir: "up" }), 0); // driving: A is the handbrake
    r.latch(); // the results open
    for (let t = 16; t < 2000; t += 16) {
      const p = r.update(state({ a: true, dir: "up" }), t);
      expect(p.a || p.dir !== null).toBe(false);
    }
    r.update(state(), 2000); // let go…
    expect(r.update(state({ a: true }), 2016).a).toBe(true); // …then a real press
  });
});
