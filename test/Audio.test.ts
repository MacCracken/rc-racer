import { describe, it, expect } from "vitest";
import {
  NullAudio,
  WebAudio,
  createAudio,
  engineFor,
  engineHz,
  ENGINE_IDLE_HZ,
  ENGINE_MAX_HZ,
} from "../src/core/Audio.ts";

describe("Audio — event model + environment picker", () => {
  it("records events in order", () => {
    const a = new NullAudio();
    a.play("lap");
    a.play("click");
    a.play("finish");
    expect(a.log.map((e) => e.ev)).toEqual(["lap", "click", "finish"]);
  });

  it("muted suppresses events", () => {
    const a = new NullAudio();
    a.setMuted(true);
    a.play("lap");
    expect(a.log).toHaveLength(0);
    a.setMuted(false);
    a.play("lap");
    expect(a.log).toHaveLength(1);
  });

  it("createAudio is a no-op recorder when there is no browser", () => {
    // In vitest/node there is no window.AudioContext, so we get the safe no-op
    // that still lets us assert events fire — the audible layer is the one
    // thing we deliberately don't test here.
    const a = createAudio();
    a.play("lap");
    expect((a as NullAudio).log).toEqual([{ ev: "lap", gain: 0.25 }]);
  });

  it("WebAudio never throws when it has no device (headless)", () => {
    // The audible output is un-verifiable headless; assert only that the path
    // is safe (guard-rail against a future regression that throws).
    const a = new WebAudio();
    expect(() => a.play("lap")).not.toThrow();
    expect(a.muted).toBe(false);
  });
});

describe("Engine voice — revs from the car's state", () => {
  it("pitch follows road speed, from idle to full revs", () => {
    expect(engineHz(engineFor(0, 0))).toBe(ENGINE_IDLE_HZ);
    expect(engineHz(engineFor(1, 0))).toBe(ENGINE_MAX_HZ);
    const slow = engineHz(engineFor(0.3, 1));
    const fast = engineHz(engineFor(0.8, 1));
    expect(fast).toBeGreaterThan(slow);
  });

  it("throttle revs a car that isn't moving yet (on the grid, or wheelspin)", () => {
    expect(engineFor(0, 1).rpm).toBe(0.5);
    expect(engineFor(0, 0).rpm).toBe(0);
    expect(engineFor(0.9, 1).rpm).toBe(0.9); // at speed the wheels set it
  });

  it("clamps its inputs, and a car's pitch multiplier scales the note", () => {
    expect(engineFor(3, 2)).toEqual({ rpm: 1, load: 1, pitch: 1 });
    expect(engineFor(-1, -1)).toEqual({ rpm: 0, load: 0, pitch: 1 });
    const buggy = engineHz(engineFor(0.5, 1, 1.3));
    const brawler = engineHz(engineFor(0.5, 1, 0.78));
    expect(buggy).toBeGreaterThan(brawler);
  });

  it("the continuous voices are safe headless: no device, no throw", () => {
    const a = new WebAudio();
    expect(() => {
      a.setEngine(engineFor(0.5, 1));
      a.setSkid(0.7);
      a.setEngine(null);
      a.setSkid(0);
      a.setMuted(true);
    }).not.toThrow();
  });

  it("NullAudio remembers what it would be playing", () => {
    const a = new NullAudio();
    a.setEngine(engineFor(0.5, 1));
    a.setSkid(0.4);
    expect(a.engine?.rpm).toBe(0.5);
    expect(a.skid).toBe(0.4);
    a.setEngine(null);
    expect(a.engine).toBeNull();
  });
});
