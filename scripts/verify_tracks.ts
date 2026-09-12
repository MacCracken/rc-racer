/**
 * scripts/verify_tracks.ts — headless content QA.
 *
 * Runs the autopilot on every track with every car class (no DOM, no render) and
 * reports finish time. Use it to prove a new track is *drivable* and to tune the
 * per-track par/pace:
 *
 *   npx vite-node scripts/verify_tracks.ts
 *
 * Anything that returns "DID NOT FINISH" is a track/pace to fix before it ships
 * in the menu.
 */
import { buildTrack } from "../src/track/Track.ts";
import { tracks } from "../src/track/tracks.ts";
import { carClasses } from "../src/game/cars.ts";
import {
  createCarWorld,
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
): { finished: boolean; ms: number; laps: number; top: number } {
  const track = buildTrack(tracks.find((t) => t.id === trackId)!);
  const base = carClasses.find((c) => c.id === carId)!.base;
  const stats = applyBuild(base, freshUpgrades());
  const world = createCarWorld(track);
  const car = world.car;
  const race = new RaceState(track, () => 0);
  const driver = makeDriver(track, { pace });

  const dt = FIXED_DT;
  const cap = Math.ceil(capS / dt);
  let clockMs = 0;
  let top = 0;
  let prev = { x: car.position.x, y: car.position.y };
  for (let s = 0; s < cap && !race.finished; s++) {
    const input: InputState = driver({
      position: car.position,
      velocity: car.velocity,
      angle: car.angle,
    });
    stepCar(car, world.walls, track, input, stats, dt);
    const sp = Math.abs(forwardSpeed(car));
    if (sp > top) top = sp;
    race.update(prev, { x: car.position.x, y: car.position.y });
    prev = { x: car.position.x, y: car.position.y };
    clockMs += dt * 1000;
  }
  return {
    finished: race.finished,
    ms: clockMs,
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
    const time = r.finished
      ? (r.ms / 1000).toFixed(2) + "s"
      : `DID NOT FINISH (${r.laps}/${t.laps} laps, top ${r.top} px/s)`;
    console.log(`${tag} ${t.name.padEnd(10)} ${c.name.padEnd(13)} ${time}`);
  }
}
console.log(
  `--- ${bad} of ${tracks.length * carClasses.length} pairs did not finish ---`,
);
if (bad > 0) process.exit(1);
