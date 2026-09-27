/**
 * scripts/verify_tracks.ts — headless content QA.
 *
 * Runs the autopilot on every track with every car class (no DOM, no render) and
 * reports finish time. Use it to prove a new track is *drivable* and to tune the
 * per-track par/pace:
 *
 *   npm run verify:tracks
 *
 * Anything that returns "DID NOT FINISH" is a track/pace to fix before it ships
 * in the menu.
 */
import { buildTrack } from "../src/track/Track.ts";
import { tracks } from "../src/track/tracks.ts";
import { carClasses } from "../src/game/cars.ts";
import {
  createArena,
  stepCar,
  forwardSpeed,
} from "../src/physics/MatterCar.ts";
import { RaceState } from "../src/race/RaceState.ts";
import { makeDriver } from "../src/race/AiDriver.ts";
import type { InputState } from "../src/core/Input.ts";
import { applyBuild, freshUpgrades } from "../src/game/upgrades.ts";
import { FIXED_DT } from "../src/core/tuning.ts";

const capSec = 90;

function runRace(
  trackId: string,
  carId: string,
  pace: number,
  capS: number,
): {
  finished: boolean;
  ms: number;
  bestLapMs: number;
  laps: number;
  top: number;
} {
  const track = buildTrack(tracks.find((t) => t.id === trackId)!);
  const base = carClasses.find((c) => c.id === carId)!.base;
  // The arena applies the track's conditions (dirt, rain), as in a race.
  const arena = createArena(track, applyBuild(base, freshUpgrades()));
  const { body: car, stats } = arena.cars[0];
  let clockMs = 0;
  const race = new RaceState(track, () => clockMs);
  // The same look-ahead the game gives its rivals.
  const driver = makeDriver(track, { pace, lookahead: 0.05 });

  const dt = FIXED_DT;
  const cap = Math.ceil(capS / dt);
  let top = 0;
  let prev = { x: car.position.x, y: car.position.y };
  for (let s = 0; s < cap && !race.finished; s++) {
    const input: InputState = driver({
      position: car.position,
      velocity: car.velocity,
      angle: car.angle,
    });
    stepCar(car, arena.walls, track, input, stats, dt);
    const sp = Math.abs(forwardSpeed(car));
    if (sp > top) top = sp;
    clockMs += dt * 1000;
    race.update(prev, { x: car.position.x, y: car.position.y });
    prev = { x: car.position.x, y: car.position.y };
  }
  return {
    finished: race.finished,
    ms: clockMs,
    bestLapMs: race.bestLapMs,
    laps: race.lap,
    top: Math.round(top),
  };
}

let bad = 0;
for (const t of tracks) {
  for (const c of carClasses) {
    const pace = t.aiPace ?? 0.8;
    const r = runRace(t.id, c.id, pace, capSec);
    if (!r.finished) bad++;
    const tag = r.finished ? "ok  " : "FAIL";
    const par = t.parLapMs === undefined ? "" : ` (par ${t.parLapMs / 1000}s)`;
    const time = r.finished
      ? `${(r.ms / 1000).toFixed(2)}s, best lap ${(r.bestLapMs / 1000).toFixed(2)}s${par}`
      : `DID NOT FINISH (${r.laps}/${t.laps} laps, top ${r.top} px/s)`;
    console.log(`${tag} ${t.name.padEnd(10)} ${c.name.padEnd(13)} ${time}`);
  }
}
console.log(
  `--- ${bad} of ${tracks.length * carClasses.length} pairs did not finish ---`,
);
if (bad > 0) process.exit(1);
