/**
 * UI — the DOM layer, kept out of the simulation. These builders turn a
 * description of game state (`UiModel`) into HTML for the menu / garage /
 * results panels. The Game director installs the string and handles clicks via
 * a single delegated listener, so panels are cheap to rebuild and re-render.
 */
import type { StatBar } from "../game/upgrades.ts";
import type { RaceOutcome } from "../game/progression.ts";
import { keyLabel, type ColorMode, type HudSize } from "../core/theme.ts";

export type Screen =
     | "menu"
     | "garage"
     | "race"
     | "results"
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
}

export interface UpgradeRow {
  slot: string;
  name: string;
  level: number;
  maxLevel: number;
  nextCost: number;
  maxed: boolean;
  canAfford: boolean;
}

export interface UiModel {
  credits: number;
  cars: CarRow[];
  tracks: TrackRow[];
  statBars: StatBar[];
  upgrades: UpgradeRow[];
}

/** What the results panel renders: the economy outcome + the race's finish info. */
export interface ResultsView {
  position: number;
  total: number;
  bestLapMs: number;
  outcome: RaceOutcome;
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
  bindings: BindRow[];
    /** True while a key capture is pending, and which action is being set. */
  rebinding: boolean;
  rebindingAction: string | null;
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
        return `
          <button class="${cls}" data-selecttrack="${t.id}"${locked ? " disabled" : ""}>
           <span class="track-name">${esc(t.name)}</span>
           <span class="track-meta">${t.laps} laps · par ${esc(t.parLabel)}${t.difficulty !== undefined ? " · " + "●".repeat(t.difficulty) : ""}${clear}</span>
          </button>`;
        })
      .join("");

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
          <button class="primary" data-action="start">Start race</button>
        </div>
      </div>
      <div class="hint">WASD/arrows to drive · Space handbrake · R restart · Esc or Q to menu</div>
      <div class="menu-actions">
        <button class="ghost" data-action="garage">Open garage</button>
        <button class="ghost" data-action="howto">How to Play</button>
        <button class="ghost" data-action="settings">Settings</button>
      </div>
    </div>`;
}

// --- GARAGE ----------------------------------------------------------------

export function garageHtml(m: UiModel): string {
  const bars = m.statBars
      .map((b) => {
        const pct = Math.round(Math.max(0, Math.min(1, b.norm)) * 100);
        return `
      <div class="stat">
       <span class="stat-label">${esc(b.label)}</span>
       <span class="bar"><span class="bar-fill" style="width:${pct}%"></span></span>
       <span class="stat-val">${b.value.toFixed(0)}</span>
      </div>`;
        })
      .join("");

  const slots = m.upgrades
      .map((u) => {
        const cls = [
         "slot",
        u.maxed && "maxed",
         !u.maxed && !u.canAfford && "cant-afford",
         ]
            .filter(Boolean)
            .join(" ");
        return `
      <button class="${cls}" data-buy="${u.slot}"${u.maxed ? " disabled" : ""}>
        <span class="slot-name">${esc(u.name)} <em>L${u.level}${u.level > 0 ? "/" + u.maxLevel : ""}</em></span>
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
  const timeStr = `${(bestLapMs / 1000).toFixed(2)}s`;
  const record = outcome.newRecord
      ? `<div class="new-record">★ NEW RECORD · ${(outcome.newBest / 1000).toFixed(2)}s</div>`
     : "";
  const unlocked = outcome.unlockedCar
      ? `<div class="unlocks">★ Unlocked: ${esc(outcome.unlockedCar)}</div>`
      : "";
  return `
    <div class="screen screen-results">
      <div class="panel results-panel">
        <div class="col-head">RACE RESULT</div>
        <div class="result-position">${p}</div>
        <div class="result-time">Best lap: <b>${timeStr}</b></div>
        <div class="reward">+ ${outcome.creditsEarned} cr</div>
        ${record}
        ${unlocked}
        <div class="results-actions">
          <button class="primary" data-action="raceagain">Race again</button>
          <button class="ghost" data-action="garage">Garage</button>
        </div>
      </div>
    </div>`;
}

// --- RACE (in-race overlay; the live HUD is drawn on the canvas itself) ---

/** Minimal overlay shown during a race: a quit control + the key hint. */
export function raceOverlay(): string {
  return `
     <div class="screen screen-race-overlay">
       <button class="ghost quit" data-action="quit">◀ Menu</button>
       <div class="hint race-hint">WASD / arrows · Space handbrake · R restart · Esc or Q to menu</div>
     </div>`;
}

/** Onboarding / how-to screen. */
export function onboardingHtml(): string {
  return `
     <div class="screen screen-onboarding">
       <div class="onboarding-panel">
         <div class="onboarding-title">How to Play — RC Racer</div>
         <div class="onboarding-body">
           <p><b>Drive:</b> WASD / Arrow keys to steer and throttle. Space for handbrake/drift. R to restart.</p>
           <p><b>Race:</b> Complete laps, beat your best time and finish ahead of the AI rivals.</p>
           <p><b>Earn → Upgrade → Go Faster:</b> Credits are awarded for finishing. Spend them in the Garage to upgrade Engine, Tires, Brakes, Suspension, Aero, Chassis and Drift Kit. Each upgrade changes real physics.</p>
           <p><b>Progress:</b> Clear a track to unlock the next. Pick different car classes for different tracks.</p>
         </div>
         <div class="onboarding-actions">
           <button class="primary" data-action="close-onboarding">Got it — Start Racing</button>
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
      ? '<div class="rebind-hint">Press any key to assign · Esc cancels</div>'
      : "";
  return `
       <div class="screen screen-settings">
         <div class="settings-panel">
           <div class="settings-title">Settings</div>
           <div class="settings-body">
             <div class="setting-group">
               <div class="col-head">DISPLAY</div>
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
