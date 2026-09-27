# Changelog

All notable changes to RC Racer are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Nothing has been released yet: everything below is heading for **0.1.0**, the
first public demo. At release, `[Unreleased]` becomes `[0.1.0] - <date>` and a
fresh `[Unreleased]` section opens above it. What's still to do lives in
[roadmap.md](./roadmap.md).

## [Unreleased]

### Added

#### Driving

- A top-down arcade car model: throttle, brake and reverse, steering that
  scales with speed, lateral grip, and a handbrake that breaks the rear loose
  for drifts. Every car is one stat vector (`core/tuning.ts`) integrated on a
  fixed 120 Hz step, so tuning is editing numbers, not physics.
- Wall contact that scrubs speed by impact angle: a graze costs a little, a
  head-on hit a lot, and a car can never get stuck in a wall.
- Three car classes, each with its own body art and engine voice: the Street
  Sedan (free), the 1/10 Buggy (500 cr) and the 1/8 Brawler (1200 cr).

#### Racing

- Nine tracks authored as data (a centerline and a width; walls, gates, grid
  and art are derived), each with a difficulty, par lap and rival field: the
  warm-up Overture, then Hairpin, Riverbend, Gravel Pit, Clover, Dust Bowl,
  Monsoon, Slalom, and Midnight as the finale.
- Track conditions, each a tradeoff for the whole field: **dirt** (less grip,
  longer slides, softer brakes, a lower top end), **rain** (grip and braking
  fall away) and **night** (racing by headlight). Gravel Pit and Dust Bowl
  are dirt, Monsoon is wet, Midnight runs after dark; the menu tags each one
  and the HUD names it.
- Checkpoint gates that must be crossed in order, so a lap can't be cut.
  Lap, best, last and live lap timing.
- Three AI rivals per race on a pace-scaled autopilot. The field's car and
  upgrade tier belong to the track, never to your garage, so upgrading pulls
  you ahead of it. Live race position is ranked by distance raced.
- 3-2-1 start lights that hold the whole field on the grid until GO.
- Pause (Esc / P, a gamepad's Start, or the on-screen button) with Resume /
  Restart / Quit / Sound, and auto-pause when the window loses focus.
- A ghost car that replays your best lap on the track, with a live split
  against it under the lap timer and a ring on the minimap.
- Replays: watch the race just run from the results — every car, from the
  green light to the flag, the camera on yours — at 1×, 2× or 4×, paused or
  from the top again. Kept in memory for the last race only.

#### Progression

- Credits for finishing, a pace bonus for a best lap under the track's par,
  and a podium bonus (P1 +40, P2 +20, P3 +10), itemised on the results screen.
- A garage upgrade tree: Engine, Tires, Brakes, Suspension, Chassis, Aero and
  Drift Kit, four tiers each, every tier changing real physics stats, with
  live stat bars.
- A track ladder: clearing a track unlocks the next. The menu lists each
  track with an outline of its shape (tinted by its conditions), its par and
  your best lap, and a locked track says what opens it ("Clear Hairpin to
  unlock").
- The garage previews every upgrade before you buy it: each lists what it
  adds ("Top speed +7 km/h · Acceleration +7"), and hovering or focusing one
  lights its gain on the stat bars.
- Results lead on: "Next: \<track\> ▶" races the next track in the ladder —
  first in line, with a "Track unlocked" notice, when this race opened it —
  alongside Race again, Replay, Garage and Menu.
- Records: your five best laps on every open track, with the car and the
  day, on their own screen; the results say where a lap placed ("3rd of your
  best laps on Overture"), and "Copy best" puts a line to share a track's
  best lap on the clipboard (with a link, once the game is on the web).
- A versioned save in `localStorage` that migrates old saves and repairs
  corrupt ones. Purchases and settings save the moment they happen.

#### Presentation and sound

- Pre-painted track art: red-and-white curbs, a chequered start line, grid
  boxes, textured asphalt and ground, and trackside tyre stacks, cones and
  bushes.
- Vector car art per class, with front wheels that steer and brake lights.
- Skid marks and tyre smoke while sliding, finish confetti, a minimap, and a
  camera that looks ahead and pulls out with speed.
- Conditions you can see: dirt tracks get a loose surface, earth berms, ruts,
  straw bales and dust clouds; wet ones get puddles, falling rain, splashes
  and spray behind every car; night darkens the track to moonlight, with
  pools of light under trackside lamps, headlight beams and tail-light glow.
- A HUD with lap, best / last / current time, position, speed and FPS.
- Procedural WebAudio: an engine whose pitch follows speed (buggies whine,
  brawlers growl), tyre squeal from slip, the hiss of rain on a wet track, UI
  clicks, lap and finish chimes, and countdown beeps. A mute toggle.

#### Input and accessibility

- Keyboard (rebindable in Settings), gamepad (analog stick and triggers) and
  on-screen multi-touch controls on phones and tablets, all usable at once.
- The menus work without a mouse. The arrows (or the driving keys) and a
  gamepad's d-pad or stick move between buttons by where they sit on screen;
  Enter, Space or A presses; Esc or B backs out; a pad's Start presses the
  screen's main action. The cursor stays put through a purchase, the main
  menu remembers the button you left it by, every other screen opens on its
  main action (the pause menu on Resume), and a button or key still held
  from driving presses nothing on the results.
- A colorblind palette, three HUD sizes, and a layout that works on phones
  in either orientation.
- How to Play opens by itself on first launch.

#### Tooling

- Vitest unit and headless-simulation tests, including a proof that an
  upgrade makes a finished race measurably faster, and a content guard that
  every track is drivable by a stock car.
- Playwright smoke tests that drive the production build in Chromium on a
  desktop and an emulated phone; any page error fails them.
- CI on every pull request: typecheck, lint, Prettier, unit tests, build and
  the browser tests.
- `npm run verify:tracks`: runs the autopilot for every car on every track,
  under each track's conditions, and reports finish times and best laps
  against par.

### Changed

- Rendering does far less per-frame fill work (ground baked into the cached
  track art, a pre-shaded vignette, an opaque canvas): 2–3× faster at high
  resolutions when the browser rasterizes in software.
- The build uses relative asset URLs (`base: "./"`), so `dist/` runs from any
  path or static host, or from a zip.
- Stat bars are scaled to the best any car reaches fully built, so 100 means
  the best build in the game (stock cars now read lower than before).
- A cleared track stays unlocked even if a new track is later slotted into
  the ladder before it.
- The race's key hint sits above the race buttons and fades out after ten
  seconds. Menu rows share one width per column.
- Dust Bowl is now a dirt track (par 14.5 s), and new tracks join the ladder
  after Riverbend (Gravel Pit), Dust Bowl (Monsoon) and Slalom (Midnight).
- The save format is version 4 (records boards). Older saves migrate: each
  track's record becomes the first lap on its board; a selected track that a
  newly slotted-in track has closed again opens on the nearest open track
  before it; and Dust Bowl records set before it became dirt are dropped,
  since they were set on tarmac.
- The game director hands replay playback, the Records screen and menu input
  to their own modules (`race/ReplayPlayer.ts`, `game/records.ts`,
  `ui/MenuInput.ts`), each tested on its own. No change in behaviour.

### Removed

- The GitHub Pages deploy workflow. Hosting is decided separately; see
  [DEPLOY.md](./DEPLOY.md).

### Fixed

- The camera stayed parked at the start line instead of following the car.
- Restarting a race reused a stale clock, so the first lap timed negative and
  saved as an unbeatable record. Saves carrying such a record are repaired.
- Race position read P1 for the whole first lap; it now ranks by distance.
- Grazing a wall halved the car's speed.
- Held keys stuck after alt-tab or a ⌘ shortcut; browser chords (⌘R, Ctrl+R)
  no longer restart the race.
- Leaving How to Play by keyboard didn't mark it seen, so it reopened on every
  launch.
- A hidden, 0-px canvas threw in the frame loop and stopped the game.
- Unmuting in Safari could leave the audio context suspended (silent).
- Garage stat bars topped out on strong builds, so some purchases showed no
  change at all.
- The race's key hint ran into the Sound button on windows narrower than
  about 1150 px, and the results' Garage button sat out of line.
- A menu button reached with Tab couldn't be pressed with Space: the key was
  swallowed as the handbrake.
