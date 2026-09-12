import { describe, it, expect } from "vitest";
import {
  menuHtml,
  garageHtml,
  resultsHtml,
  raceOverlay,
  type UiModel,
  type ResultsView,
} from "../src/ui/ui.ts";
import type { StatBar } from "../src/game/upgrades.ts";

/** A minimal, fully-owned UiModel for the pure HTML generators. */
const bars: StatBar[] = [
  { key: "grip", label: "Grip", value: 1, norm: 0.5 },
  { key: "maxSpeed", label: "Top speed", value: 1, norm: 0.5 },
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
    const html = raceOverlay();
    expect(html).toContain('data-action="quit"');
    // It should also advertise the Esc/Q shortcut.
    expect(html.toLowerCase()).toContain("esc");
  });

  it("a new-record result shows the record banner", () => {
    const html = resultsHtml(resultsView({ newRecord: true, newBest: 3800 }));
    expect(html).toContain("NEW RECORD");
  });
});
