import { describe, it, expect } from "vitest";
import { isUnlocked, unlockedByClearing } from "../../src/game/ladder.ts";
import type { TrackDef } from "../../src/track/Track.ts";

const track = (id: string): TrackDef => ({
  id,
  name: id,
  laps: 3,
  width: 120,
  centerLine: [],
});
const ladder = ["a", "b", "c", "d"].map(track);

describe("the track ladder", () => {
  it("opens the first track, then each one as the track before it is cleared", () => {
    expect(isUnlocked(ladder, [], 0)).toBe(true);
    expect(isUnlocked(ladder, [], 1)).toBe(false);
    expect(isUnlocked(ladder, ["a"], 1)).toBe(true);
    expect(isUnlocked(ladder, ["a"], 2)).toBe(false);
    expect(isUnlocked(ladder, ["a"], 9)).toBe(false); // off the end
  });

  it("keeps a cleared track open when a new one is slotted in before it", () => {
    // "c" was cleared when it followed "a"; "b" is new content.
    expect(isUnlocked(ladder, ["a", "c"], 2)).toBe(true);
    expect(isUnlocked(ladder, ["a", "c"], 3)).toBe(true); // and what it opens
    expect(isUnlocked(ladder, ["a", "c"], 1)).toBe(true); // b: a is cleared
  });

  it("names the track a first clear opens, and only then", () => {
    expect(unlockedByClearing(ladder, [], "a")).toBe("b");
    expect(unlockedByClearing(ladder, ["a"], "a")).toBeNull(); // repeat clear
    expect(unlockedByClearing(ladder, ["a", "b", "c"], "d")).toBeNull(); // last
    expect(unlockedByClearing(ladder, ["a", "c"], "b")).toBeNull(); // c was open
    expect(unlockedByClearing(ladder, [], "nowhere")).toBeNull();
  });
});
