import { describe, it, expect } from "vitest";
import {
  touchInput,
  TouchInput,
  type TouchControl,
} from "../src/core/TouchInput.ts";

/**
 * TouchInput against a stand-in DOM: a root that receives delegated pointer
 * events, fake touch buttons, and `elementFromPoint` mapping x to a button
 * (left of 100 = ◀, 100..200 = ▶, beyond = empty track).
 */
function button(control: TouchControl) {
  const classes = new Set<string>();
  const el = {
    closest: () => el,
    getAttribute: (k: string) => (k === "data-touch" ? control : null),
    classList: {
      toggle: (c: string, on: boolean) =>
        on ? classes.add(c) : classes.delete(c),
    },
    held: () => classes.has("held"),
  };
  return el;
}

function setup() {
  const buttons = {
    left: button("left"),
    right: button("right"),
    gas: button("gas"),
  };
  const win = new EventTarget();
  const root = Object.assign(new EventTarget(), {
    ownerDocument: {
      defaultView: win,
      elementFromPoint: (x: number) =>
        x < 100 ? buttons.left : x < 200 ? buttons.right : null,
    },
    querySelectorAll: () => Object.values(buttons),
  });
  const input = new TouchInput();
  input.attach(root as unknown as HTMLElement);
  /** Fire a pointer event whose target is `on` (a button, or empty track). */
  const fire = (
    type: string,
    pointerId: number,
    on: unknown,
    clientX = 0,
  ): Event => {
    const e = Object.assign(new Event(type, { cancelable: true }), {
      pointerId,
      clientX,
      clientY: 0,
    });
    Object.defineProperty(e, "target", { value: on });
    root.dispatchEvent(e);
    return e;
  };
  return { input, buttons, fire, win };
}

describe("Touch controls", () => {
  it("map held buttons to driving input", () => {
    expect(touchInput(new Set(["gas", "left"]))).toEqual({
      throttle: 1,
      brake: 0,
      steer: -1,
      handbrake: false,
    });
    expect(touchInput(new Set(["left", "right"])).steer).toBe(0);
    expect(touchInput(new Set(["drift", "brake"]))).toMatchObject({
      brake: 1,
      handbrake: true,
    });
  });

  it("track each finger: steer with one thumb while the other holds gas", () => {
    const { input, buttons, fire } = setup();
    const down = fire("pointerdown", 1, buttons.left);
    fire("pointerdown", 2, buttons.gas);
    expect(down.defaultPrevented).toBe(true);
    expect(input.sample()).toMatchObject({ throttle: 1, steer: -1 });
    expect(buttons.left.held()).toBe(true);
    fire("pointerup", 1, buttons.left);
    expect(input.sample()).toMatchObject({ throttle: 1, steer: 0 });
    expect(buttons.left.held()).toBe(false);
  });

  it("a finger slides ◀ to ▶ without lifting, and lets go off the buttons", () => {
    const { input, buttons, fire } = setup();
    fire("pointerdown", 7, buttons.left, 50);
    fire("pointermove", 7, buttons.left, 150); // still captured by ◀
    expect(input.sample().steer).toBe(1);
    fire("pointermove", 7, buttons.left, 400);
    expect(input.sample().steer).toBe(0);
  });

  it("ignores touches that didn't start on a control, and a cancel lets go", () => {
    const { input, buttons, fire } = setup();
    fire("pointerdown", 3, null); // the track itself
    fire("pointermove", 3, null, 50); // wanders over ◀
    expect(input.sample().steer).toBe(0);
    fire("pointerdown", 4, buttons.gas);
    fire("pointercancel", 4, buttons.gas); // e.g. a system gesture
    expect(input.sample().throttle).toBe(0);
  });

  it("losing focus or detaching releases every finger", () => {
    const { input, buttons, fire, win } = setup();
    fire("pointerdown", 1, buttons.gas);
    win.dispatchEvent(new Event("blur"));
    expect(input.sample().throttle).toBe(0);
    fire("pointerdown", 1, buttons.gas);
    input.detach();
    expect(input.sample().throttle).toBe(0);
    fire("pointerdown", 1, buttons.gas); // no longer listening
    expect(input.sample().throttle).toBe(0);
  });
});
