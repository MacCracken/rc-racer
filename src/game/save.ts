import {
  freshUpgrades,
  maxTierFor,
  SLOTS,
  type OwnedUpgrades,
} from "./upgrades.ts";
import { carClasses } from "./cars.ts";
import { isUnlocked } from "./ladder.ts";
import { tracks } from "../track/tracks.ts";
import { capGhost, type Ghost, type GhostPoint } from "../race/Ghost.ts";
import { defaultSettings, migrateSettings, type Settings } from "./settings.ts";

/**
 * A save is a small, versioned snapshot. `version` + `migrate()` let us change the
 * shape over time without corrupting players' saves. The *store* is a seam
 * (ISaveStore) so the pure logic (migrate/newSave/serialize) is testable away
 * from the browser, with a LocalStorage implementation for the real game.
 */
export const SAVE_VERSION = 4;

/** One of your best laps on a track: how long, in which car, and when. */
export interface LapRecord {
  ms: number;
  /** Car class id ("" when an older save's record didn't say). */
  car: string;
  /** When it was set (epoch ms; 0 when not known). */
  at: number;
}

/** How many of your best laps each track keeps. */
export const RECORDS_KEPT = 5;

/**
 * Tracks whose road changed, and the save version that changed it: a record
 * from an older save was set on a different surface (Dust Bowl was tarmac
 * before v4), so it — and its ghost — no longer stands.
 */
const RESURFACED: Record<string, number> = { "dust-bowl": 4 };

export interface SaveData {
  version: number;
  credits: number;
  /** Owned (unlocked) car class ids. */
  ownedCars: string[];
  /** Owned upgrade tiers per car class. */
  upgrades: Record<string, OwnedUpgrades>;
  /** Best lap ms per track id (the race's best single lap). */
  bestLaps: Record<string, number>;
  bestGhosts: Record<string, Ghost>;
  /** Your best laps per track id, fastest first (the first is `bestLaps`). */
  records: Record<string, LapRecord[]>;
  /** Selectable screen selections, for convenience. */
  selectedCar: string;
  selectedTrack: string;
  /** Tracks you've cleared at least once (progression gate). */
  clearedTracks: string[];
  /** Persistent UI prefs: key bindings, colour-blind mode, HUD size. */
  settings: Settings;
}

/** The store seam. `save` must be synchronous for the demo (localStorage). */
export interface ISaveStore {
  load(): SaveData | null;
  save(data: SaveData): void;
}

export function newSave(): SaveData {
  const firstCar = carClasses.find((c) => c.cost === 0) ?? carClasses[0];
  return {
    version: SAVE_VERSION,
    credits: 0,
    ownedCars: [firstCar.id],
    upgrades: { [firstCar.id]: freshUpgrades() },
    bestLaps: {},
    bestGhosts: {},
    records: {},
    selectedCar: firstCar.id,
    selectedTrack: tracks[0].id,
    clearedTracks: [],
    settings: defaultSettings(),
  };
}

/** Coerce arbitrary/older payloads into a valid current SaveData. */
export function migrate(input: unknown): SaveData {
  const data = newSave();
  // No object / wrong type -> fresh save.
  if (input === null || typeof input !== "object") return data;
  const raw = input as Record<string, unknown>;

  if (typeof raw.credits === "number" && isFinite(raw.credits)) {
    data.credits = Math.max(0, Math.floor(raw.credits));
  }
  if (Array.isArray(raw.ownedCars)) {
    const valid = raw.ownedCars.filter(
      (id): id is string =>
        typeof id === "string" && carClasses.some((c) => c.id === id),
    );
    if (valid.length > 0) data.ownedCars = [...new Set(valid)];
  }
  if (raw.upgrades && typeof raw.upgrades === "object") {
    for (const [car, up] of Object.entries(
      raw.upgrades as Record<string, unknown>,
    )) {
      if (!carClasses.some((c) => c.id === car)) continue;
      if (typeof up === "object" && up !== null) {
        data.upgrades[car] = coerceUpgrades(up as Record<string, unknown>);
      }
    }
  }
  // A stored best lap must be a real, positive time. Anything else (e.g. the
  // negative "record" a stale race clock once produced) is dropped along with
  // the ghost recorded beside it, so the track's record can be set again.
  const badRecords = new Set<string>();
  if (raw.bestLaps && typeof raw.bestLaps === "object") {
    for (const [t, ms] of Object.entries(
      raw.bestLaps as Record<string, unknown>,
    )) {
      if (typeof ms === "number" && isFinite(ms) && ms > 0)
        data.bestLaps[t] = ms;
      else badRecords.add(t);
    }
  }
  if (raw.bestGhosts && typeof raw.bestGhosts === "object") {
    for (const [t, pts] of Object.entries(
      raw.bestGhosts as Record<string, unknown>,
    )) {
      if (Array.isArray(pts) && !badRecords.has(t))
        data.bestGhosts[t] = coerceGhost(pts);
    }
  }

  const version = typeof raw.version === "number" ? raw.version : 0;
  for (const [t, since] of Object.entries(RESURFACED))
    if (version < since) {
      delete data.bestLaps[t];
      delete data.bestGhosts[t];
    }

  if (raw.records && typeof raw.records === "object") {
    for (const [t, list] of Object.entries(
      raw.records as Record<string, unknown>,
    )) {
      const clean = coerceRecords(list);
      if (clean.length > 0) data.records[t] = clean;
    }
  }
  // The track record is always on its board: a save from before the boards
  // (v3 and older) starts each one from it, car and date unknown.
  for (const [t, ms] of Object.entries(data.bestLaps)) {
    const board = data.records[t] ?? [];
    if (!board.some((r) => r.ms === ms))
      data.records[t] = sortRecords([...board, { ms, car: "", at: 0 }]);
  }

  if (raw.clearedTracks && Array.isArray(raw.clearedTracks)) {
    data.clearedTracks = raw.clearedTracks.filter(
      (t): t is string =>
        typeof t === "string" && tracks.some((x) => x.id === t),
    );
  }
  // Only an owned car can be the selected one; otherwise fall back to the
  // first owned car rather than racing a car that was never bought.
  data.selectedCar =
    typeof raw.selectedCar === "string" &&
    data.ownedCars.includes(raw.selectedCar)
      ? raw.selectedCar
      : data.ownedCars[0];
  data.upgrades[data.selectedCar] =
    data.upgrades[data.selectedCar] ?? freshUpgrades();
  // Likewise only an open track: the menu would never let you start a race
  // on a locked one. One that's closed now — a new track slotted in ahead of
  // it — falls back to the nearest open track before it: the one to clear.
  const ti = tracks.findIndex((x) => x.id === raw.selectedTrack);
  for (let i = ti; i >= 0; i--)
    if (isUnlocked(tracks, data.clearedTracks, i)) {
      data.selectedTrack = tracks[i].id;
      break;
    }
  // UI prefs ride the same save; a legacy save that lacks them keeps defaults.
  if (raw.settings !== undefined) data.settings = migrateSettings(raw.settings);
  data.version = SAVE_VERSION;
  return data;
}

/** Coerce arbitrary data into a clean, ascending, deduped ghost timeline. */
function coerceGhost(raw: unknown): GhostPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: GhostPoint[] = [];
  let last = -Infinity;
  for (const pt of raw) {
    if (pt === null || typeof pt !== "object") continue;
    const q = pt as Record<string, unknown>;
    const { t, x, y, heading } = q;
    if (
      typeof t !== "number" ||
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isFinite(t) ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    )
      continue;
    if (t === last) continue;
    out.push({
      t,
      x,
      y,
      heading: typeof heading === "number" ? heading : 0,
    });
    last = t;
  }
  return capGhost(out.sort((a, b) => a.t - b.t));
}

/** Fastest first, and only as many as a board keeps. */
export function sortRecords(list: LapRecord[]): LapRecord[] {
  return [...list].sort((a, b) => a.ms - b.ms).slice(0, RECORDS_KEPT);
}

/** A board from arbitrary data: valid laps only, fastest first, capped. */
function coerceRecords(raw: unknown): LapRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: LapRecord[] = [];
  for (const r of raw) {
    if (r === null || typeof r !== "object") continue;
    const { ms, car, at } = r as Record<string, unknown>;
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) continue;
    out.push({
      ms,
      car: typeof car === "string" ? car : "",
      at: typeof at === "number" && Number.isFinite(at) && at > 0 ? at : 0,
    });
  }
  return sortRecords(out);
}

/** Owned tier counts, as whole numbers within each slot's tier range. */
function coerceUpgrades(raw: Record<string, unknown>): OwnedUpgrades {
  const out = freshUpgrades();
  for (const slot of SLOTS) {
    const n = raw[slot];
    if (typeof n === "number" && Number.isFinite(n))
      out[slot] = Math.min(maxTierFor(slot), Math.max(0, Math.floor(n)));
  }
  return out;
}

/**
 * The page's `localStorage`, or null where it is missing or blocked. Merely
 * reading the property throws a SecurityError in a sandboxed iframe (e.g. a
 * game-portal embed) or with site data disabled.
 */
export function browserStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** Browser-backed store with a guard so a full/blocked storage never throws. */
export class LocalSaveStore implements ISaveStore {
  constructor(
    private readonly key = "rc-racer-save",
    private readonly storage: Storage | null = browserStorage(),
  ) {}

  load(): SaveData | null {
    if (this.storage === null) return null;
    try {
      const raw = this.storage.getItem(this.key);
      return raw === null ? null : migrate(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  save(data: SaveData): void {
    if (this.storage === null) return;
    try {
      this.storage.setItem(this.key, JSON.stringify(data));
    } catch {
      // Quota / private-mode: fail quiet, the game keeps running.
    }
  }
}

/** In-memory store for tests / headless runs. */
export class MemorySaveStore implements ISaveStore {
  private data: SaveData | null = null;
  load(): SaveData | null {
    return this.data;
  }
  save(data: SaveData): void {
    // Deep-copied like a real (serializing) store, so later in-memory edits
    // can't leak into what was "saved".
    this.data = JSON.parse(JSON.stringify(data)) as SaveData;
  }
}
