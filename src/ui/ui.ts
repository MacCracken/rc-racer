/**
 * UI — the DOM layer, kept out of the simulation. These builders turn a
 * description of game state (`UiModel`) into HTML for the menu / garage /
 * results panels. The Game director installs the string and handles clicks via
 * a single delegated listener, so panels are cheap to rebuild and re-render.
 */
import type { StatBar, StatGain } from "../game/upgrades.ts";
import type { TrackOutline } from "../track/outline.ts";
import type { RaceOutcome } from "../game/progression.ts";
import { keyLabel, type ColorMode, type HudSize } from "../core/theme.ts";
import { formatLap, formatSplit } from "../race/RaceState.ts";
import { defaultKeyMap, type KeyAction, type KeyMap } from "../core/Input.ts";

export type Screen =
  | "menu"
  | "garage"
  | "records"
  | "race"
  | "results"
  | "replay"
  | "onboarding"
  | "settings";

export interface CarRow {
  id: string;
  name: string;
  blurb: string;
  classLabel: string;
  cost: number;
  owned: boolean;
  selected: boolean;
}

export interface TrackRow {
  id: string;
  name: string;
  laps: number;
  parLabel: string;
  cleared: boolean;
  unlocked: boolean;
  selected: boolean;
  /** Flavour line + rough difficulty for the menu (both optional). */
  vibe?: string;
  difficulty?: number;
  /** Who you'll race there, e.g. "vs 1/10 Buggy +1". */
  rivals?: string;
  /** Your best lap here, formatted, once you have one. */
  bestLabel?: string;
  /** What opens a locked track, e.g. "Clear Hairpin to unlock". */
  lockHint?: string;
  /** Its conditions, if any: "Dirt", "Rain", "Night". */
  tags?: string[];
  /** Its shape, for a thumbnail beside the name (see `track/outline.ts`). */
  outline?: TrackOutline;
}

export interface UpgradeRow {
  slot: string;
  name: string;
  level: number;
  maxLevel: number;
  nextCost: number;
  maxed: boolean;
  canAfford: boolean;
  /** The next tier's name + what it does, so a purchase isn't a blind buy. */
  nextName?: string;
  nextDesc?: string;
  /** The stat bars the next tier moves, and by how much. */
  gains?: StatGain[];
}

export interface UiModel {
  credits: number;
  cars: CarRow[];
  tracks: TrackRow[];
  statBars: StatBar[];
  upgrades: UpgradeRow[];
  /** Live key bindings, so on-screen hints name the keys actually bound. */
  keyMap: KeyMap;
}

/** What the results panel renders: the economy outcome + the race's finish info. */
export interface ResultsView {
  position: number;
  total: number;
  bestLapMs: number;
  outcome: RaceOutcome;
  /** The track's par lap (ms), to explain the pace bonus. */
  parMs?: number;
  /** Display name of `outcome.unlockedCar` (falls back to its id). */
  unlockedCarName?: string;
  /** The next track in the ladder, when it's open to race. */
  nextTrack?: { id: string; name: string };
  /** A replay of the race is there to watch. */
  canReplay?: boolean;
  /** The track's name, for "3rd of your best laps on <track>". */
  trackName?: string;
}

/** A track's board on the Records screen. */
export interface RecordsRow {
  id: string;
  name: string;
  tags?: string[];
  outline?: TrackOutline;
  /** Your best laps there, fastest first, ready to show. */
  laps: { time: string; car: string; date: string }[];
}

export interface RecordsView {
  tracks: RecordsRow[];
  /** The track whose best lap was just copied, to say so… */
  copied?: string | null;
  /** …or, where the clipboard refused, the line to copy by hand. */
  byHand?: { id: string; text: string } | null;
}

/** A single rebindable key binding, as shown in the settings panel. */
export interface BindRow {
  action: string;
  label: string;
  keys: string[];
}

/** What the settings panel renders: display prefs + the live key bindings. */
export interface SettingsView {
  colorMode: ColorMode;
  hudSize: HudSize;
  muted: boolean;
  bindings: BindRow[];
  /** True while a key capture is pending, and which action is being set. */
  rebinding: boolean;
  rebindingAction: string | null;
  /** Why the last key press was refused (e.g. a reserved key), if any. */
  notice?: string;
}

const DRIVE_ACTIONS: KeyAction[] = [
  "throttle",
  "brake",
  "steerLeft",
  "steerRight",
];

/**
 * The controls line shown on the menu, in the race and in How to Play, built
 * from the live bindings so a rebind is reflected everywhere. The stock
 * layout keeps its familiar short form ("WASD / arrows to drive").
 */
export function controlsHint(km: KeyMap): string {
  const keys = (a: KeyAction): string =>
    km[a].length > 0 ? km[a].map(keyLabel).join("/") : "unbound";
  const stock = defaultKeyMap();
  const stockDriving = DRIVE_ACTIONS.every(
    (a) =>
      km[a].length === stock[a].length &&
      stock[a].every((code) => km[a].includes(code)),
  );
  const drive = stockDriving
    ? "WASD / arrows to drive"
    : `${keys("throttle")} gas · ${keys("brake")} brake · ` +
      `${keys("steerLeft")} left · ${keys("steerRight")} right`;
  return `${drive} · ${keys("handbrake")} handbrake · R restart · Esc pause · Q menu`;
}

const HUD_SIZE_LABEL: Record<HudSize, string> = {
  sm: "Small",
  md: "Normal",
  lg: "Large",
};

const esc = (s: string): string =>
  s.replace(/[<>&"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case '"':
        return "&quot;";
      default:
        return c;
    }
  });

// --- MENU ------------------------------------------------------------------

export function menuHtml(m: UiModel): string {
  const cars = m.cars
    .map((c) => {
      const cls = ["car-row", c.selected && "selected", !c.owned && "not-owned"]
        .filter(Boolean)
        .join(" ");
      const cost = c.owned ? "" : `<span class="cost">${c.cost} cr</span>`;
      return `
          <button class="${cls}" data-selectcar="${c.id}">
           <span class="car-name">${esc(c.name)}</span>
           <span class="car-class">${esc(c.classLabel)}</span>
           <span class="car-blurb">${esc(c.blurb)}</span>
           ${cost}
          </button>`;
    })
    .join("");

  const tracks = m.tracks
    .map((t) => {
      const locked = !t.unlocked;
      const cls = ["track-row", t.selected && "selected", locked && "locked"]
        .filter(Boolean)
        .join(" ");
      const clear = t.cleared ? " ✓" : "";
      // A locked track says what opens it instead of its flavour line.
      const about =
        locked && t.lockHint
          ? `🔒 ${esc(t.lockHint)}`
          : [t.vibe, t.rivals]
              .filter(Boolean)
              .map((s) => esc(s!))
              .join(" · ");
      return `
          <button class="${cls}" data-selecttrack="${t.id}"${locked ? " disabled" : ""}>
           ${outlineSvg(t.outline, t.tags)}
           <span class="track-text">
           <span class="track-name">${esc(t.name)}${tagsHtml(t.tags)}</span>
           <span class="track-meta">${t.laps} laps · par ${esc(t.parLabel)}${t.bestLabel ? ` · best <b>${esc(t.bestLabel)}</b>` : ""}${t.difficulty !== undefined ? " · " + "●".repeat(t.difficulty) : ""}${clear}</span>
           ${about ? `<span class="track-about">${about}</span>` : ""}
           </span>
          </button>`;
    })
    .join("");

  const selected = m.tracks.find((t) => t.selected);
  return `
    <div class="screen screen-menu">
      <div class="title">RC RACER</div>
      <div class="sub">Top-down RC racing · earn credits · build a monster · beat the track</div>
      <div class="balance">Balance: <b>${m.credits} cr</b></div>
      <div class="cols">
        <div class="col">
          <div class="col-head">CARS</div>
          ${cars}
        </div>
        <div class="col">
          <div class="col-head">TRACKS</div>
          ${tracks}
        </div>
      </div>
      <div class="menu-footer">
        <button class="primary" data-action="start">▶ Start race${selected ? ` · ${esc(selected.name)}` : ""}</button>
        <button class="ghost" data-action="garage">Garage</button>
        <button class="ghost" data-action="records">Records</button>
        <button class="ghost" data-action="howto">How to Play</button>
        <button class="ghost" data-action="settings">Settings</button>
        <div class="hint">${esc(controlsHint(m.keyMap))}</div>
      </div>
    </div>`;
}

/** Thumbnail box (px) a track's outline is fitted to. */
export const THUMB_W = 64;
export const THUMB_H = 44;

/** A track's shape, tinted by its conditions (nothing without one). */
function outlineSvg(o: TrackOutline | undefined, tags: string[] = []): string {
  if (o === undefined || o.d === "") return "";
  const tint = tags.map((tag) => ` thumb-${esc(tag.toLowerCase())}`);
  return `<svg class="track-thumb${tint.join("")}" viewBox="0 0 ${THUMB_W} ${THUMB_H}" aria-hidden="true"><path d="${esc(o.d)}" stroke-width="${o.road.toFixed(1)}"/><circle cx="${o.start.x}" cy="${o.start.y}" r="2.6"/></svg>`;
}

/** Condition tags beside a track's name. */
function tagsHtml(tags: string[] = []): string {
  return tags
    .map(
      (tag) =>
        ` <span class="tag tag-${esc(tag.toLowerCase())}">${esc(tag)}</span>`,
    )
    .join("");
}

// --- GARAGE ----------------------------------------------------------------

/** A 0..1 bar fill as a CSS percentage (one decimal). */
const pct = (n: number): number =>
  Math.round(Math.max(0, Math.min(1, n)) * 1000) / 10;

/** A slot id safe to put in a CSS selector as it is (no escaping applies). */
const CSS_SAFE = /^[a-z][a-z0-9-]*$/i;

export function garageHtml(m: UiModel): string {
  // Previewed slots go into a <style> rule, where HTML escapes don't apply:
  // only plain identifiers make it there.
  const buyable = m.upgrades.filter(
    (u) => !u.maxed && u.gains?.length && CSS_SAFE.test(u.slot),
  );
  const bars = m.statBars
    .map((b) => {
      // Each upgrade's gain on this stat, lit while that upgrade is hovered
      // or focused, so the bars preview a purchase before it's made.
      const gains = buyable
        .flatMap((u) =>
          u
            .gains!.filter((g) => g.key === b.key)
            .map((g) => [u.slot, g] as const),
        )
        .map(([slot, g]) => {
          const lo = pct(Math.min(g.from, g.to));
          const width = pct(Math.max(g.from, g.to)) - lo;
          return `<span class="bar-gain" data-gain="${esc(slot)}" style="left:${lo}%;width:${width}%"></span>`;
        })
        .join("");
      return `
      <div class="stat">
       <span class="stat-label">${esc(b.label)}</span>
       <span class="bar"><span class="bar-fill" style="width:${pct(b.norm)}%"></span>${gains}</span>
       <span class="stat-val">${esc(b.text)}</span>
      </div>`;
    })
    .join("");
  const preview = buyable
    .map(
      (u) =>
        `.screen-garage:has([data-buy="${u.slot}"]:is(:hover,:focus)) [data-gain="${u.slot}"]`,
    )
    .join(",");

  // A key or pad player lands on the first upgrade they can still buy.
  const firstOpen = m.upgrades.find((u) => !u.maxed)?.slot;
  const slots = m.upgrades
    .map((u) => {
      const cls = [
        "slot",
        u.maxed && "maxed",
        !u.maxed && !u.canAfford && "cant-afford",
      ]
        .filter(Boolean)
        .join(" ");
      const next =
        u.maxed || u.nextName === undefined
          ? ""
          : `<span class="slot-next">Next: ${esc(u.nextName)}${u.nextDesc ? " — " + esc(u.nextDesc) : ""}</span>`;
      const gains =
        u.maxed || !u.gains?.length
          ? ""
          : `<span class="slot-gains">${u.gains
              .map((g) => `${esc(g.label)} <b>${esc(g.text)}</b>`)
              .join(" · ")}</span>`;
      return `
      <button class="${cls}" data-buy="${esc(u.slot)}"${u.maxed ? " disabled" : ""}${u.slot === firstOpen ? " data-autofocus" : ""}>
        <span class="slot-info">
          <span class="slot-name">${esc(u.name)} <em>L${u.level}/${u.maxLevel}</em></span>
          ${next}
          ${gains}
        </span>
        <span class="slot-cost">${u.maxed ? "MAX" : u.nextCost + " cr"}</span>
      </button>`;
    })
    .join("");

  const car = m.cars.find((c) => c.selected);
  const switchCars = m.cars
    .map((c) => {
      const cls = ["mini-car", c.selected && "selected", !c.owned && "locked"]
        .filter(Boolean)
        .join(" ");
      return `
        <button class="${cls}" data-switchcar="${c.id}"${c.owned ? "" : " disabled"}>
          ${esc(c.name)}${c.owned ? "" : `<i>${c.cost} cr</i>`}
        </button>`;
    })
    .join("");

  return `
    <div class="screen screen-garage">
      ${preview ? `<style>${preview}{opacity:1}</style>` : ""}
      <div class="panel">
        <div class="panel-head">
          <button class="ghost" data-action="menu">◀ Menu</button>
          <span class="panel-title">${car ? esc(car.name) : "Garage"}</span>
          <span class="balance2">${m.credits} cr</span>
        </div>
        <div class="garage-body">
          <div class="garage-left">
            <div class="col-head">STATS</div>
            ${bars}
            <div class="col-head" style="margin-top:16px">LINEUP</div>
            <div class="car-switch">${switchCars}</div>
          </div>
          <div class="garage-right">
            <div class="col-head">UPGRADES</div>
            ${slots || '<div class="empty">This car is stock — pick another to tune.</div>'}
          </div>
        </div>
      </div>
    </div>`;
}

// --- RESULTS ---------------------------------------------------------------

export function resultsHtml(view: ResultsView): string {
  const { outcome, position, total, bestLapMs } = view;
  const p = `P${position} / ${total}`;
  const timeStr = formatLap(bestLapMs);
  // A record to beat next time: the new one, or how far off the old one.
  const record = outcome.newRecord
    ? `<div class="new-record">★ NEW RECORD · ${formatLap(outcome.newBest)}</div>`
    : isFinite(outcome.oldBest) && isFinite(bestLapMs) && bestLapMs > 0
      ? `<div class="result-record">Track record ${formatLap(outcome.oldBest)} (${formatSplit(bestLapMs - outcome.oldBest)})</div>`
      : "";
  // Where the credits came from, so "go faster" and "beat the field" both
  // visibly pay. A zero pace bonus says how to earn one.
  const { base, pace, podium } = outcome.breakdown;
  const par = view.parMs !== undefined ? formatPar(view.parMs) : undefined;
  const parts = [
    `Finish +${base}`,
    pace > 0
      ? `Pace +${pace}${par ? ` (par ${par})` : ""}`
      : par
        ? `Pace +0 — beat par ${par} for a bonus`
        : "",
    podium > 0 ? `P${position} +${podium}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  // `unlockedCar` is a car you can now *afford*; buying it is still your call.
  const rank = outcome.boardRank;
  const board =
    rank !== null && rank > 1
      ? `<div class="result-board">${ordinal(rank)} of your best laps${view.trackName ? ` on ${esc(view.trackName)}` : ""}</div>`
      : "";
  const unlocked = outcome.unlockedCar
    ? `<div class="unlocks">★ New car affordable: ${esc(view.unlockedCarName ?? outcome.unlockedCar)} — unlock it from the menu</div>`
    : "";
  // The ladder's next track, once open. The race that opens it makes racing
  // there the obvious next step; otherwise running it back stays first.
  const next = view.nextTrack;
  const fresh = next !== undefined && outcome.unlockedTrack === next.id;
  const opened = fresh
    ? `<div class="unlocks">★ Track unlocked: ${esc(next.name)}</div>`
    : "";
  const again = (cls: string): string =>
    `<button class="${cls}" data-action="raceagain">Race again</button>`;
  const onward =
    next === undefined
      ? ""
      : `<button class="${fresh ? "primary" : "ghost"}" data-action="nexttrack">Next: ${esc(next.name)} ▶</button>`;
  return `
    <div class="screen screen-results">
      <div class="panel results-panel">
        <div class="col-head">RACE RESULT</div>
        <div class="result-position">${p}</div>
        <div class="result-time">Best lap: <b>${timeStr}</b></div>
        <div class="reward">+ ${outcome.creditsEarned} cr</div>
        <div class="reward-parts">${esc(parts)}</div>
        ${record}
        ${board}
        ${unlocked}
        ${opened}
        <div class="results-actions">
          ${fresh ? onward + again("ghost") : again("primary") + onward}
          ${view.canReplay ? '<button class="ghost" data-action="replay">▶ Replay</button>' : ""}
          <button class="ghost" data-action="garage">Garage</button>
          <button class="ghost" data-action="menu">Menu</button>
        </div>
      </div>
    </div>`;
}

// --- RECORDS ---------------------------------------------------------------

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th", 23 -> "23rd". */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

/**
 * Your best laps on every open track, fastest first, with the car and the
 * day; each board's best can be copied to share.
 */
export function recordsHtml(v: RecordsView): string {
  const boards = v.tracks
    .map((t) => {
      const laps =
        t.laps.length === 0
          ? '<div class="empty">No laps yet — finish a race here.</div>'
          : `<ol class="board">${t.laps
              .map(
                (l) =>
                  `<li><b>${esc(l.time)}</b><span>${esc(l.car)}</span><i>${esc(l.date)}</i></li>`,
              )
              .join("")}</ol>`;
      const share =
        t.laps.length === 0
          ? ""
          : `<button class="ghost share" data-share="${esc(t.id)}">${v.copied === t.id ? "Copied ✓" : "Copy best"}</button>`;
      return `
        <section class="board-card">
          <div class="board-head">
            ${outlineSvg(t.outline, t.tags)}
            <span class="board-name">${esc(t.name)}${tagsHtml(t.tags)}</span>
            ${share}
          </div>
          ${laps}
          ${v.byHand?.id === t.id ? `<div class="share-text">Copy this: <span>${esc(v.byHand.text)}</span></div>` : ""}
        </section>`;
    })
    .join("");
  return `
    <div class="screen screen-records">
      <div class="panel">
        <div class="panel-head">
          <button class="ghost" data-action="menu">◀ Menu</button>
          <span class="panel-title">Records</span>
        </div>
        <div class="boards">${boards}</div>
      </div>
    </div>`;
}

/**
 * A line to share a best lap: the track, the time and the car, and where to
 * play when the game is on the web.
 */
export function shareText(
  track: string,
  time: string,
  car: string,
  url?: string,
): string {
  const where = url !== undefined && /^https?:/.test(url) ? ` ${url}` : "";
  return `RC Racer · ${track}: ${time}${car ? ` in the ${car}` : ""}. Beat it?${where}`;
}

// --- REPLAY ----------------------------------------------------------------

/** Where a replay is: held (paused), at its end, and how fast it plays. */
export interface ReplayView {
  held: boolean;
  atEnd: boolean;
  speed: number;
}

/**
 * Controls over a replay (the canvas shows the race and a REPLAY badge):
 * play / pause — or watch again from the end — speed, and back to the
 * results.
 */
export function replayHtml(v: ReplayView): string {
  const play = v.atEnd ? "↺ Watch again" : v.held ? "▶ Play" : "⏸ Pause";
  return `
    <div class="screen screen-replay">
      <div class="replay-controls">
        <button class="primary" data-action="replay-toggle">${play}</button>
        <button class="ghost" data-action="replay-speed" aria-label="Playback speed">${v.speed}×</button>
        <button class="ghost" data-action="replay-exit">◀ Results</button>
      </div>
    </div>`;
}

// --- RACE (in-race overlay; the live HUD is drawn on the canvas itself) ---

/** Minimal overlay shown during a race: quit + mute controls + the key hint. */
export function raceOverlay(km: KeyMap, muted: boolean): string {
  return `
     <div class="screen screen-race-overlay">
       <div class="race-controls">
         <button class="ghost" data-action="quit">◀ Menu</button>
         <button class="ghost" data-action="pause" aria-label="Pause">⏸ Pause</button>
         ${soundButton(muted)}
       </div>
       <div class="hint race-hint">${esc(controlsHint(km))}</div>
       ${TOUCH_CONTROLS}
     </div>`;
}

/**
 * On-screen driving controls (see `core/TouchInput.ts`): steering under the
 * left thumb, pedals + drift under the right. CSS shows them only on touch
 * screens. Plain elements, not buttons, so they never take keyboard focus.
 */
const TOUCH_CONTROLS = `
  <div class="touch-controls">
    <div class="touch-steer">
      <div class="touch-btn" data-touch="left" aria-label="Steer left">◀</div>
      <div class="touch-btn" data-touch="right" aria-label="Steer right">▶</div>
    </div>
    <div class="touch-pedals">
      <div class="touch-btn touch-drift" data-touch="drift" aria-label="Handbrake">DRIFT</div>
      <div class="touch-btn touch-brake" data-touch="brake" aria-label="Brake">BRAKE</div>
      <div class="touch-btn touch-gas" data-touch="gas" aria-label="Gas">GAS</div>
    </div>
  </div>`;

/**
 * The pause menu. The race behind it is frozen (clock, cars, countdown) until
 * it is resumed; restarting or quitting from here drops it.
 */
export function pauseHtml(muted: boolean): string {
  return `
    <div class="screen screen-pause">
      <div class="panel pause-panel">
        <div class="pause-title">Paused</div>
        <div class="pause-actions">
          <button class="primary" data-action="resume">▶ Resume</button>
          <button class="ghost" data-action="restart">↻ Restart race</button>
          <button class="ghost" data-action="quit">◀ Quit to menu</button>
          ${soundButton(muted)}
        </div>
        <div class="hint">Esc or P resume · R restart · Q menu</div>
      </div>
    </div>`;
}

/**
 * The mute toggle. Screen readers get a fixed name ("Mute") with the state in
 * aria-pressed; sighted players see the current state on the button.
 */
function soundButton(muted: boolean): string {
  return `<button class="ghost sound" data-action="toggle-sound" aria-label="Mute" aria-pressed="${muted}">${muted ? "🔇 Sound off" : "🔊 Sound on"}</button>`;
}

/** Onboarding / how-to screen. */
export function onboardingHtml(km: KeyMap): string {
  return `
     <div class="screen screen-onboarding">
       <div class="onboarding-panel">
         <div class="onboarding-title">How to Play — RC Racer</div>
         <div class="onboarding-body">
           <p class="no-touch"><b>Drive:</b> ${esc(controlsHint(km))}. Hold the handbrake through a corner to drift. A gamepad works too (stick, triggers, A to drift, Start to pause). On the menus, the arrows or d-pad move, Enter or A picks, Esc or B goes back.</p>
           <p class="touch-only"><b>Drive:</b> ◀ ▶ under your left thumb steer; GAS and BRAKE are on the right. Hold DRIFT through a corner to slide.</p>
           <p><b>Race:</b> Go on the green light and complete the laps. Credits pay for finishing, more for a podium, and a bonus for a best lap under the track's par.</p>
           <p><b>Chase your ghost:</b> Once you've set a time, a ghost car replays your best lap; the timer shows how far ahead (−) or behind (+) you are.</p>
           <p><b>Earn → Upgrade → Go Faster:</b> Spend credits in the Garage on Engine, Tires, Brakes, Suspension, Aero, Chassis and Drift Kit — each changes real physics. Save up for faster car classes.</p>
           <p><b>Conditions:</b> Dirt and rain cost everyone grip — rain lengthens braking too, and dirt slides further. At night you race by headlight.</p>
           <p><b>Progress:</b> Clear a track to unlock the next.</p>
         </div>
         <div class="onboarding-actions">
           <button class="ghost" data-action="close-onboarding">◀ Menu</button>
           <button class="primary" data-action="start">Got it — Start Racing</button>
         </div>
       </div>
     </div>`;
}

/** Interactive settings screen: display prefs + live key rebinding. */
export function settingsHtml(v: SettingsView): string {
  const rows = v.bindings
    .map((b) => {
      const capturing = v.rebinding && v.rebindingAction === b.action;
      const value = capturing
        ? "Press a key…"
        : b.keys.length > 0
          ? b.keys.map(keyLabel).join(" / ")
          : "—";
      return `
            <div class="setting-row key-row">
              <span>${esc(b.label)}</span>
              <button class="key-btn${capturing ? " capturing" : ""}" data-bind="${esc(
                b.action,
              )}">${esc(value)}</button>
            </div>`;
    })
    .join("");
  const cbOn = v.colorMode === "cb";
  const captureHint = v.rebinding
    ? `<div class="rebind-hint">${esc(v.notice ?? "Press any key to assign · Esc cancels")}</div>`
    : "";
  return `
       <div class="screen screen-settings">
         <div class="settings-panel">
           <div class="settings-title">Settings</div>
           <div class="settings-body">
             <div class="setting-group">
               <div class="col-head">DISPLAY &amp; SOUND</div>
               <div class="setting-row">
                 <span>Colorblind mode</span>
                 <button class="ghost" data-action="toggle-colorblind">${cbOn ? "On" : "Off"}</button>
               </div>
               <div class="setting-row">
                 <span>HUD size</span>
                 <button class="ghost" data-action="cycle-hud">${esc(
                   HUD_SIZE_LABEL[v.hudSize],
                 )}</button>
              </div>
               <div class="setting-row">
                 <span>Sound</span>
                 ${soundButton(v.muted)}
               </div>
             </div>
             <div class="setting-group">
               <div class="col-head">KEY BINDINGS</div>
               ${rows}
               ${captureHint}
               <button class="ghost" data-action="reset-settings">Reset keys to default</button>
             </div>
           </div>
           <div class="settings-actions">
             <button class="primary" data-action="close-settings">Back to Menu</button>
           </div>
         </div>
       </div>`;
}

/** Human label for a par time (ms -> "5.4s"). */
export function formatPar(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
