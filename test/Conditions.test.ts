import { describe, it, expect } from "vitest";
import {
  applyConditions,
  conditionsOf,
  conditionTags,
  DIRT,
  RAIN,
} from "../src/track/conditions.ts";
import { buildTrack, type TrackDef } from "../src/track/Track.ts";
import { tracks, monsoon, overture } from "../src/track/tracks.ts";
import { createArena, stepCar } from "../src/physics/MatterCar.ts";
import { RaceState } from "../src/race/RaceState.ts";
import { makeDriver } from "../src/race/AiDriver.ts";
import { FIXED_DT } from "../src/core/tuning.ts";
import { carClasses } from "../src/game/cars.ts";
import { rivalField } from "../src/game/rivals.ts";
import { slipAmount } from "../src/core/SkidMarks.ts";
import {
  CURB_WIDTH,
  distToCenterLine,
  lampsFor,
  sceneryFor,
} from "../src/core/trackArt.ts";

/**
 * Track conditions: dirt and rain trade grip for everyone on the track; night
 * only changes the look. Pure stat math, then the same arena the game races.
 */

const sedan = carClasses.find((c) => c.id === "street-sedan")!.base;

/**
 * A stock sedan's autopilot run as the game would race it: its best lap (ms)
 * over two laps, and how hard its tyres slid on average (0..1).
 */
function drive(def: TrackDef): { lapMs: number; slip: number } {
  const track = buildTrack(def);
  const arena = createArena(track, sedan);
  const { body, stats } = arena.cars[0];
  let clock = 0;
  const race = new RaceState(track, () => clock);
  const autopilot = makeDriver(track, { pace: 0.8, lookahead: 0.05 });
  let prev = { x: body.position.x, y: body.position.y };
  let slip = 0;
  let steps = 0;
  for (; steps < 60 / FIXED_DT && race.lap < 2; steps++) {
    stepCar(body, arena.walls, track, autopilot(body), stats, FIXED_DT);
    clock += FIXED_DT * 1000;
    race.update(prev, body.position);
    prev = { x: body.position.x, y: body.position.y };
    slip += slipAmount(body, { maxSpeed: stats.maxSpeed });
  }
  return { lapMs: race.bestLapMs, slip: slip / steps };
}

describe("track conditions", () => {
  it("default to dry tarmac by day, which changes nothing", () => {
    const c = conditionsOf(overture);
    expect(c).toEqual({ terrain: "tarmac", weather: "clear", lighting: "day" });
    expect(applyConditions(sedan, c)).toEqual(sedan);
    expect(conditionTags(c)).toEqual([]);
  });

  it("dirt and rain cost grip; rain lengthens braking; night is only a look", () => {
    const dirt = applyConditions(sedan, {
      ...conditionsOf(overture),
      terrain: "dirt",
    });
    const rain = applyConditions(sedan, {
      ...conditionsOf(overture),
      weather: "rain",
    });
    const night = applyConditions(sedan, {
      ...conditionsOf(overture),
      lighting: "night",
    });
    for (const s of [dirt, rain]) {
      expect(s.grip).toBeLessThan(sedan.grip);
      expect(s.handbrakeGrip).toBeLessThan(sedan.handbrakeGrip); // slides further
      expect(s.braking).toBeLessThan(sedan.braking);
    }
    expect(rain.braking).toBeLessThan(dirt.braking); // wet brakes worst
    expect(dirt.maxSpeed).toBeLessThan(sedan.maxSpeed);
    expect(rain.maxSpeed).toBe(sedan.maxSpeed);
    expect(night).toEqual(sedan);
  });

  it("compose: a wet dirt track takes both", () => {
    const both = applyConditions(sedan, {
      terrain: "dirt",
      weather: "rain",
      lighting: "night",
    });
    expect(both.grip).toBeCloseTo(sedan.grip * DIRT.grip! * RAIN.grip!, 12);
    expect(
      conditionTags(
        conditionsOf({
          ...overture,
          terrain: "dirt",
          weather: "rain",
          lighting: "night",
        }),
      ),
    ).toEqual(["Dirt", "Rain", "Night"]);
  });

  it("apply to the whole field: player and rivals race the same road", () => {
    const track = buildTrack(monsoon);
    const field = rivalField(monsoon, 3);
    const arena = createArena(track, sedan, field);
    expect(arena.cars[0].stats.grip).toBeCloseTo(sedan.grip * RAIN.grip!, 12);
    arena.cars
      .slice(1)
      .forEach((c, i) =>
        expect(c.stats.grip).toBeCloseTo(field[i].stats.grip * RAIN.grip!, 12),
      );
  });

  it("in the wet, the same car on the same line slides more and laps slower", () => {
    // Slalom's weave is where the grip runs out first.
    const slalom = tracks.find((t) => t.id === "slalom")!;
    const dry = drive(slalom);
    const wet = drive({ ...slalom, weather: "rain" });
    expect(wet.slip).toBeGreaterThan(dry.slip * 2);
    expect(wet.lapMs).toBeGreaterThan(dry.lapMs * 1.02);
    // And on Monsoon itself, rain costs time against the same track dry.
    const monsoonDry = drive({ ...monsoon, weather: undefined });
    expect(drive(monsoon).lapMs).toBeGreaterThan(monsoonDry.lapMs * 1.01);
  });

  it("are spread through the ladder: dirt, rain and night each appear", () => {
    const all = tracks.map((t) => conditionsOf(t));
    expect(all.some((c) => c.terrain === "dirt")).toBe(true);
    expect(all.some((c) => c.weather === "rain")).toBe(true);
    expect(all.some((c) => c.lighting === "night")).toBe(true);
    expect(conditionsOf(tracks[0]).terrain).toBe("tarmac"); // the warm-up is plain
  });
});

describe("conditions dress the track", () => {
  it("lines a dirt track with straw bales, a tarmac one with tyre stacks", () => {
    const kinds = (def: TrackDef) =>
      new Set(sceneryFor(buildTrack(def)).map((s) => s.kind));
    const dirt = tracks.find((t) => t.terrain === "dirt")!;
    expect(kinds(dirt).has("hay")).toBe(true);
    expect(kinds(dirt).has("tires")).toBe(false);
    expect(kinds(overture).has("tires")).toBe(true);
    expect(kinds(overture).has("hay")).toBe(false);
  });

  it("lamps line every lap of road, off the road, the same each visit", () => {
    for (const def of tracks) {
      const track = buildTrack(def);
      const lamps = lampsFor(track);
      expect(lamps.length, def.name).toBeGreaterThan(5);
      expect(lamps).toEqual(lampsFor(buildTrack(def)));
      for (const p of lamps)
        expect(distToCenterLine(track.centerLine, p), def.name).toBeGreaterThan(
          track.width / 2 + CURB_WIDTH,
        );
    }
  });
});
