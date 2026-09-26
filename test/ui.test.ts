import { describe, it, expect } from "vitest";
import {
  menuHtml,
  garageHtml,
  resultsHtml,
  raceOverlay,
  pauseHtml,
  onboardingHtml,
  settingsHtml,
  controlsHint,
  type UiModel,
  type ResultsView,
} from "../src/ui/ui.ts";
import { statBars, type StatBar } from "../src/game/upgrades.ts";
import { defaultKeyMap } from "../src/core/Input.ts";
import { defaultSettings, rebindSetting } from "../src/game/settings.ts";
import { carClasses } from "../src/game/cars.ts";

/** A minimal, fully-owned UiModel for the pure HTML generators. */
const bars: StatBar[] = [
  { key: "grip", label: "Grip", value: 1, norm: 0.5, text: "50" },
  {
    key: "maxSpeed",
    label: "Top speed",
    value: 1,
    norm: 0.5,
    text: "108 km/h",
  },
];

function model(): UiModel {
  return {
    credits: 0,
    cars: [
      {
        id: "street-sedan",
        name: "Street Sedan",
        blurb: "b",
        classLabel: "c",
        cost: 0,
        owned: true,
        selected: true,
      },
    ],
    tracks: [
      {
        id: "overture",
        name: "Overture",
        laps: 3,
        parLabel: "5.0s",
        cleared: false,
        unlocked: true,
        selected: true,
        vibe: "v",
        difficulty: 1,
      },
    ],
    statBars: bars,
    upgrades: [
      {
        slot: "tires",
        name: "Tires",
        level: 0,
        maxLevel: 3,
        nextCost: 100,
        maxed: false,
        canAfford: false,
      },
    ],
    keyMap: defaultKeyMap(),
  };
}

const BASE_OUTCOME = {
  creditsEarned: 50,
  newRecord: false,
  oldBest: 4000,
  newBest: 4000,
  unlockedCar: null,
} as const;

function resultsView(
  overrides?: Partial<Parameters<typeof resultsHtml>[0]["outcome"]>,
): ResultsView {
  return {
    position: 2,
    total: 4,
    bestLapMs: 4200,
    outcome: { ...BASE_OUTCOME, ...overrides },
  };
}

describe("Overlay HTML carries the right controls (pure, no DOM)", () => {
  it("menu offers Start + Garage + track selection", () => {
    const html = menuHtml(model());
    expect(html).toContain('data-action="start"');
    expect(html).toContain('data-action="garage"');
    expect(html).toContain('data-selecttrack="overture"');
  });

  it("garage offers a back-to-menu control", () => {
    const html = garageHtml(model());
    expect(html).toMatch(/data-action="menu"/);
  });

  it("results offer race-again + garage", () => {
    const html = resultsHtml(resultsView());
    expect(html).toContain('data-action="raceagain"');
    expect(html).toContain('data-action="garage"');
  });

  it("race overlay offers a clickable quit control (regression: had no way to quit)", () => {
    const html = raceOverlay(defaultKeyMap(), false);
    expect(html).toContain('data-action="quit"');
    // It should also advertise the Esc/Q shortcut.
    expect(html.toLowerCase()).toContain("esc");
  });

  it("the race overlay can pause; the pause menu resumes, restarts or quits", () => {
    expect(raceOverlay(defaultKeyMap(), false)).toContain(
      'data-action="pause"',
    );
    const html = pauseHtml(false);
    for (const action of ["resume", "restart", "quit", "toggle-sound"])
      expect(html).toContain(`data-action="${action}"`);
    expect(controlsHint(defaultKeyMap())).toContain("Esc pause");
  });

  it("offers a mute toggle in Settings and mid-race, labelled with its state", () => {
    const view = {
      colorMode: "std" as const,
      hudSize: "md" as const,
      bindings: [],
      rebinding: false,
      rebindingAction: null,
    };
    expect(settingsHtml({ ...view, muted: false })).toContain("🔊 Sound on");
    expect(settingsHtml({ ...view, muted: true })).toContain("🔇 Sound off");
    const race = raceOverlay(defaultKeyMap(), true);
    expect(race).toContain('data-action="toggle-sound"');
    expect(race).toContain('aria-pressed="true"');
  });

  it("the track list says who you'll race there", () => {
    const m = model();
    m.tracks[0].rivals = "vs 1/10 Buggy";
    expect(menuHtml(m)).toContain("vs 1/10 Buggy");
    expect(menuHtml(m)).toContain(">v · vs 1/10 Buggy<"); // with the track's vibe line
  });

  it("How to Play can start a race (as its button says) or go back to the menu", () => {
    const html = onboardingHtml(defaultKeyMap());
    expect(html).toMatch(/data-action="start"[^>]*>Got it — Start Racing/);
    expect(html).toContain('data-action="close-onboarding"');
  });

  it("a new-record result shows the record banner", () => {
    const html = resultsHtml(resultsView({ newRecord: true, newBest: 3800 }));
    expect(html).toContain("NEW RECORD");
  });

  it("escapes markup in names, including '>'", () => {
    const m = model();
    m.cars[0].name = "<b>Car</b> & co";
    expect(menuHtml(m)).toContain("&lt;b&gt;Car&lt;/b&gt; &amp; co");
  });

  it("results never print a raw non-finite lap time", () => {
    const html = resultsHtml({ ...resultsView(), bestLapMs: Infinity });
    expect(html).not.toContain("Infinity");
    expect(html).toContain("--:--.---");
  });

  it("names a newly affordable car without claiming it's unlocked", () => {
    const html = resultsHtml({
      ...resultsView({ unlockedCar: "buggy" }),
      unlockedCarName: "1/10 Buggy",
    });
    expect(html).toContain("1/10 Buggy");
    expect(html).not.toContain("Unlocked:");
  });

  it("control hints follow the live key bindings everywhere they appear", () => {
    const stock = defaultKeyMap();
    expect(controlsHint(stock)).toContain("WASD / arrows to drive");
    expect(controlsHint(stock)).toContain("Space handbrake");

    let s = defaultSettings();
    s = rebindSetting(s, "handbrake", "KeyE");
    s = rebindSetting(s, "throttle", "KeyI");
    const hint = controlsHint(s.keyMap);
    expect(hint).toContain("E handbrake");
    expect(hint).toContain("I gas");
    expect(hint).not.toContain("WASD");
    expect(hint).not.toContain("Space");

    const m = { ...model(), keyMap: s.keyMap };
    for (const html of [
      menuHtml(m),
      raceOverlay(s.keyMap, false),
      onboardingHtml(s.keyMap),
    ]) {
      expect(html).toContain("E handbrake");
      expect(html).not.toContain("Space handbrake");
    }
  });

  it("garage stats read sensibly: km/h for speed, 0-100 ratings (grip isn't '0')", () => {
    const sedan = carClasses.find((c) => c.id === "street-sedan")!.base;
    const html = garageHtml({ ...model(), statBars: statBars(sedan) });
    expect(html).toContain("108 km/h"); // 180 px/s, as the HUD speedo reads it
    const grip = statBars(sedan).find((b) => b.key === "grip")!;
    expect(Number(grip.text)).toBeGreaterThan(0);
    expect(html).toContain("Drift");
  });

  it("settings explain a refused key while capture stays armed", () => {
    const html = settingsHtml({
      colorMode: "std",
      hudSize: "md",
      muted: false,
      bindings: [{ action: "handbrake", label: "Handbrake", keys: ["Space"] }],
      rebinding: true,
      rebindingAction: "handbrake",
      notice: "Q is reserved — press another key",
    });
    expect(html).toContain("Q is reserved");
    expect(html).toContain("Press a key…");
  });
});
