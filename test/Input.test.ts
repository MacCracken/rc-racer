import { describe, it, expect } from "vitest";
import { KeyboardInput, defaultKeyMap } from "../src/core/Input.ts";

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
