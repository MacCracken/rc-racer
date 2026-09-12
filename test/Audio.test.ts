import { describe, it, expect } from "vitest";
import { NullAudio, WebAudio, createAudio } from "../src/core/Audio.ts";

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
