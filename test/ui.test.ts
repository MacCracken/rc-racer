import { describe, it, expect } from "vitest";
import {
  menuHtml,
  garageHtml,
  resultsHtml,
  raceOverlay,
  pauseHtml,
  onboardingHtml,
  settingsHtml,
  replayHtml,
  recordsHtml,
  shareText,
  ordinal,
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
  breakdown: { base: 50, pace: 0, podium: 0 },
  parMs: 4000,
  newRecord: false,
  oldBest: 4000,
  newBest: 4000,
  unlockedCar: null,
  unlockedTrack: null,
  boardRank: null,
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

  it("the race overlay carries on-screen touch controls for every action", () => {
    const html = raceOverlay(defaultKeyMap(), false);
    for (const c of ["left", "right", "gas", "brake", "drift"])
      expect(html).toContain(`data-touch="${c}"`);
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

describe("Results explain the payout; the menu shows your times", () => {
  it("breaks the credits down, and says how to earn a pace bonus", () => {
    const html = resultsHtml({
      ...resultsView({
        creditsEarned: 104,
        breakdown: { base: 84, pace: 0, podium: 20 },
      }),
      parMs: 18000,
    });
    expect(html).toContain("+ 104 cr");
    expect(html).toContain("Finish +84");
    expect(html).toContain("beat par 18.0s for a bonus");
    expect(html).toContain("P2 +20");
  });

  it("names the pace bonus when earned, and omits an empty podium", () => {
    const html = resultsHtml({
      ...resultsView({
        creditsEarned: 132,
        breakdown: { base: 84, pace: 48, podium: 0 },
      }),
      parMs: 18000,
    });
    expect(html).toContain("Pace +48 (par 18.0s)");
    expect(html).not.toMatch(/P\d \+0/);
  });

  it("shows the gap to the track record when it wasn't beaten", () => {
    const html = resultsHtml({
      ...resultsView({ oldBest: 3900, newBest: 3900 }),
      bestLapMs: 4420,
    });
    expect(html).toContain("Track record 0:03.900 (+0.52)");
    // No record yet (first finish): nothing to compare against.
    const first = resultsHtml(resultsView({ oldBest: Infinity }));
    expect(first).not.toContain("Track record");
  });

  it("the menu lists your best lap per track and a Start button naming it", () => {
    const m = model();
    m.tracks[0].bestLabel = "0:17.717";
    const html = menuHtml(m);
    expect(html).toContain("best <b>0:17.717</b>");
    expect(html).toMatch(/data-action="start"[^>]*>▶ Start race · Overture</);
    expect(html).toContain('class="menu-footer"');
  });
});

describe("Menu, garage and results guide the next step", () => {
  it("a locked track says what opens it instead of its flavour line", () => {
    const m = model();
    m.tracks.push({
      ...m.tracks[0],
      id: "hairpin",
      name: "Hairpin",
      selected: false,
      unlocked: false,
      vibe: "Tight & quick",
      lockHint: "Clear Overture to unlock",
    });
    const html = menuHtml(m);
    expect(html).toContain("🔒 Clear Overture to unlock");
    expect(html).not.toContain("Tight &amp; quick");
    expect(html).toMatch(/data-selecttrack="hairpin" disabled/);
  });

  it("the garage shows what each upgrade adds, and previews it on the bars", () => {
    const m = model();
    m.upgrades[0].gains = [
      { key: "grip", label: "Grip", from: 0.5, to: 0.6, text: "+10" },
    ];
    const html = garageHtml(m);
    expect(html).toContain("Grip <b>+10</b>");
    expect(html).toContain(
      '<span class="bar-gain" data-gain="tires" style="left:50%;width:10%"></span>',
    );
    expect(html).toContain(
      '.screen-garage:has([data-buy="tires"]:is(:hover,:focus)) [data-gain="tires"]',
    );
    // Only a plain identifier goes into the <style> rule.
    const odd = model();
    odd.upgrades[0].slot = 'x"]{}*{color:red}';
    odd.upgrades[0].gains = m.upgrades[0].gains;
    const oddHtml = garageHtml(odd);
    expect(oddHtml).not.toContain("<style>");
    expect(oddHtml).toContain('data-buy="x&quot;]{}*{color:red}"');
    // A maxed slot has nothing left to preview.
    m.upgrades[0].maxed = true;
    expect(garageHtml(m)).not.toContain("bar-gain");
    expect(garageHtml(m)).not.toContain("<style>");
  });

  it("results offer the next track, first when this race unlocked it", () => {
    const view = {
      ...resultsView({ unlockedTrack: "hairpin" }),
      nextTrack: { id: "hairpin", name: "Hairpin" },
    };
    const html = resultsHtml(view);
    expect(html).toContain("★ Track unlocked: Hairpin");
    expect(html).toMatch(
      /class="primary" data-action="nexttrack">Next: Hairpin ▶<\/button>\s*<button class="ghost" data-action="raceagain">/,
    );
    expect(html).toContain('data-action="menu"');

    // Already open: Race again stays the main action.
    const again = resultsHtml({ ...resultsView(), nextTrack: view.nextTrack });
    expect(again).not.toContain("Track unlocked");
    expect(again).toMatch(/class="primary" data-action="raceagain"/);
    expect(again).toMatch(/class="ghost" data-action="nexttrack"/);

    // The last track: nowhere further to go.
    expect(resultsHtml(resultsView())).not.toContain("nexttrack");
  });
});

describe("The menu names each track's conditions", () => {
  it("tags a track beside its name, and none when it has none", () => {
    const m = model();
    expect(menuHtml(m)).not.toContain('class="tag');
    m.tracks[0].tags = ["Dirt", "Night"];
    const html = menuHtml(m);
    expect(html).toContain('<span class="tag tag-dirt">Dirt</span>');
    expect(html).toContain('<span class="tag tag-night">Night</span>');
  });

  it("How to Play explains the conditions", () => {
    expect(onboardingHtml(defaultKeyMap())).toContain("Conditions:");
  });
});

describe("The menu shows each track's shape", () => {
  it("draws its outline beside the name, tinted by its conditions", () => {
    const m = model();
    expect(menuHtml(m)).not.toContain("track-thumb"); // no outline, no svg
    m.tracks[0].outline = { d: "M1 2 L3 4 Z", road: 5, start: { x: 1, y: 2 } };
    m.tracks[0].tags = ["Dirt"];
    const html = menuHtml(m);
    expect(html).toContain('<svg class="track-thumb thumb-dirt"');
    expect(html).toContain('<path d="M1 2 L3 4 Z" stroke-width="5.0"/>');
    expect(html).toContain('<circle cx="1" cy="2"');
  });
});

describe("Replays", () => {
  it("the results offer one only when there's one to watch", () => {
    expect(resultsHtml(resultsView())).not.toContain('data-action="replay"');
    expect(resultsHtml({ ...resultsView(), canReplay: true })).toContain(
      'data-action="replay"',
    );
  });

  it("the replay controls say what they'll do", () => {
    expect(replayHtml({ held: false, atEnd: false, speed: 1 })).toContain(
      "⏸ Pause",
    );
    expect(replayHtml({ held: true, atEnd: false, speed: 2 })).toContain(
      "▶ Play",
    );
    expect(replayHtml({ held: true, atEnd: false, speed: 2 })).toContain("2×");
    expect(replayHtml({ held: true, atEnd: true, speed: 1 })).toContain(
      "Watch again",
    );
    expect(replayHtml({ held: false, atEnd: false, speed: 1 })).toContain(
      'data-action="replay-exit"',
    );
  });
});

describe("Records", () => {
  it("the results say where a lap placed among your best, below the record", () => {
    const html = resultsHtml({
      ...resultsView({ boardRank: 3 }),
      trackName: "Overture",
    });
    expect(html).toContain("3rd of your best laps on Overture");
    // A new record says so itself.
    expect(resultsHtml(resultsView({ boardRank: 1 }))).not.toContain(
      "of your best laps",
    );
    expect(resultsHtml(resultsView())).not.toContain("of your best laps");
  });

  it("the menu opens them, and each board lists laps or says there are none", () => {
    expect(menuHtml(model())).toContain('data-action="records"');
    const html = recordsHtml({
      tracks: [
        {
          id: "overture",
          name: "Overture",
          laps: [{ time: "0:17.642", car: "Street Sedan", date: "26 Sep" }],
        },
        { id: "hairpin", name: "Hairpin", laps: [] },
      ],
      copied: "overture",
    });
    expect(html).toContain("<b>0:17.642</b><span>Street Sedan</span>");
    expect(html).toContain('data-share="overture">Copied ✓');
    expect(html).not.toContain('data-share="hairpin"');
    expect(html).toContain("No laps yet");
    expect(html).toContain('data-action="menu"');
  });

  it("a shared best lap names the track, time and car, and links a web copy", () => {
    expect(shareText("Overture", "0:17.642", "Street Sedan")).toBe(
      "RC Racer · Overture: 0:17.642 in the Street Sedan. Beat it?",
    );
    expect(
      shareText("Hairpin", "0:11.9", "", "https://example.com/rc-racer/"),
    ).toBe(
      "RC Racer · Hairpin: 0:11.9. Beat it? https://example.com/rc-racer/",
    );
    expect(shareText("A", "1", "B", "file:///x")).not.toContain("file:");
  });

  it("counts places the English way", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
      "101st",
    ]);
  });
});
