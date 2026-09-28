/**
 * scripts/verify_tracks.ts — headless content QA.
 *
 * Runs the autopilot on every track with every car class (no DOM, no render):
 * first alone, for its finish time and best lap against par, then against the
 * track's rival field from the back of the grid, for where a stock car
 * finishes. Use it to prove a new track is *drivable* and to tune the
 * per-track par, rivals and the cars:
 *
 *   npm run verify:tracks
 *
 * Anything that returns "DID NOT FINISH" is a track/pace to fix before it ships
 * in the menu.
 */
import { tracks } from "../src/track/tracks.ts";
import { carClasses } from "../src/game/cars.ts";
import { simulateRace } from "../src/race/simulate.ts";

const capSec = 90;
/** The autopilot's pace for the player's car: a decent driver. */
const PACE = 0.85;

let bad = 0;
for (const t of tracks) {
  for (const c of carClasses) {
    const solo = simulateRace(
      t,
      { ...c.base },
      {
        pace: PACE,
        rivals: 0,
        capS: capSec,
      },
    );
    const field = simulateRace(t, { ...c.base }, { pace: PACE, mass: c.mass });
    if (!solo.finished || !field.finished) bad++;
    const tag = solo.finished && field.finished ? "ok  " : "FAIL";
    const par = t.parLapMs === undefined ? "" : ` (par ${t.parLapMs / 1000}s)`;
    const time = solo.finished
      ? `${(solo.finishMs / 1000).toFixed(2)}s, best lap ${(solo.bestLapMs / 1000).toFixed(2)}s${par}`
      : "DID NOT FINISH";
    const place = field.finished ? `P${field.position} vs the field` : "DNF";
    console.log(
      `${tag} ${t.name.padEnd(10)} ${c.name.padEnd(13)} ${time}; ${place}`,
    );
  }
}
console.log(
  `--- ${bad} of ${tracks.length * carClasses.length} pairs did not finish ---`,
);
if (bad > 0) process.exit(1);
