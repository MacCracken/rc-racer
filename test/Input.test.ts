import { describe, it, expect } from "vitest";
import {
  CompositeInput,
  KeyboardInput,
  defaultKeyMap,
  mergeInputs,
  neutralInput,
  type IInput,
  type InputState,
} from "../src/core/Input.ts";

/**
 * KeyboardInput against real (cancelable) events on plain EventTargets: which
 * keys it swallows, and that a key can never stay "held" after its keyup was
 * lost (window blur, macOS ⌘ chords).
 */

type Mods = Partial<Record<"ctrlKey" | "metaKey" | "altKey", boolean>>;

function key(
  type: "keydown" | "keyup",
  code: string,
  mods: Mods = {},
  keyName = code,
): Event {
  return Object.assign(new Event(type, { cancelable: true }), {
    code,
    key: keyName,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...mods,
  });
}

function setup() {
  const win = new EventTarget();
  const target = Object.assign(new EventTarget(), {
    tabIndex: -1,
    ownerDocument: { defaultView: win },
  });
  const input = new KeyboardInput();
  input.attach(target as unknown as HTMLElement);
  return { input, target, win };
}

describe("KeyboardInput", () => {
  it("swallows only bound driving keys, leaving Tab / Enter to the browser", () => {
    const { input, target } = setup();
    const w = key("keydown", "KeyW");
    const tab = key("keydown", "Tab");
    const enter = key("keydown", "Enter");
    target.dispatchEvent(w);
    target.dispatchEvent(tab);
    target.dispatchEvent(enter);
    expect(w.defaultPrevented).toBe(true);
    expect(tab.defaultPrevented).toBe(false);
    expect(enter.defaultPrevented).toBe(false);
    expect(input.sample().throttle).toBe(1);
  });

  it("ignores modifier chords (⌘R reload, Ctrl+W…): neither swallowed nor held", () => {
    const { input, target } = setup();
    const reload = key("keydown", "KeyR", { metaKey: true });
    const chord = key("keydown", "KeyW", { ctrlKey: true });
    target.dispatchEvent(reload);
    target.dispatchEvent(chord);
    expect(reload.defaultPrevented).toBe(false);
    expect(chord.defaultPrevented).toBe(false);
    expect(input.sample().throttle).toBe(0);
  });

  it("releases every held key when the window loses focus", () => {
    const { input, target, win } = setup();
    target.dispatchEvent(key("keydown", "KeyW"));
    expect(input.sample().throttle).toBe(1);
    win.dispatchEvent(new Event("blur")); // alt-tab: the keyup never arrives
    expect(input.sample().throttle).toBe(0);
  });

  it("releases held keys when ⌘ goes up (macOS drops their keyups)", () => {
    const { input, target } = setup();
    target.dispatchEvent(key("keydown", "KeyA"));
    expect(input.sample().steer).toBe(-1);
    target.dispatchEvent(key("keyup", "MetaLeft", {}, "Meta"));
    expect(input.sample().steer).toBe(0);
  });

  it("follows a rebind: the new key drives and is swallowed", () => {
    const { input, target } = setup();
    input.setKeyMap({ ...defaultKeyMap(), throttle: ["KeyI"] });
    const i = key("keydown", "KeyI");
    target.dispatchEvent(i);
    expect(i.defaultPrevented).toBe(true);
    expect(input.sample().throttle).toBe(1);
  });

  it("detach stops listening and forgets held keys", () => {
    const { input, target, win } = setup();
    target.dispatchEvent(key("keydown", "KeyW"));
    input.detach();
    expect(input.sample().throttle).toBe(0);
    target.dispatchEvent(key("keydown", "KeyW"));
    win.dispatchEvent(new Event("blur"));
    expect(input.sample().throttle).toBe(0);
  });
});

describe("CompositeInput — keyboard, gamepad and touch at once", () => {
  const src = (s: Partial<InputState>): IInput => ({
    sample: () => ({ ...neutralInput(), ...s }),
    attach() {},
    detach() {},
    setKeyMap() {},
  });

  it("each axis takes its strongest source; an idle one can't cancel it", () => {
    expect(
      mergeInputs([
        { throttle: 1, brake: 0, steer: 0, handbrake: false },
        { throttle: 0.3, brake: 0.2, steer: -0.4, handbrake: false },
        { throttle: 0, brake: 0, steer: 0.1, handbrake: true },
      ]),
    ).toEqual({ throttle: 1, brake: 0.2, steer: -0.4, handbrake: true });
    expect(mergeInputs([])).toEqual(neutralInput());
  });

  it("samples, attaches and rebinds every source", () => {
    const seen: string[] = [];
    const spy = (name: string, s: Partial<InputState>): IInput => ({
      ...src(s),
      attach: () => void seen.push(`attach ${name}`),
      detach: () => void seen.push(`detach ${name}`),
      setKeyMap: () => void seen.push(`keys ${name}`),
    });
    const c = new CompositeInput([
      spy("kb", { steer: 1 }),
      spy("pad", { throttle: 0.5 }),
    ]);
    expect(c.sample()).toMatchObject({ steer: 1, throttle: 0.5 });
    c.attach({} as HTMLElement);
    c.setKeyMap(defaultKeyMap());
    c.detach();
    expect(seen).toEqual([
      "attach kb",
      "attach pad",
      "keys kb",
      "keys pad",
      "detach kb",
      "detach pad",
    ]);
  });
});
