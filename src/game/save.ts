import { freshUpgrades, type OwnedUpgrades } from "./upgrades.ts";
import { carClasses } from "./cars.ts";
import { tracks } from "../track/tracks.ts";
import type { Ghost, GhostPoint } from "../race/Ghost.ts";
import { defaultSettings, migrateSettings, type Settings } from "./settings.ts";

/**
 * A save is a small, versioned snapshot. `version` + `migrate()` let us change the
 * shape over time without corrupting players' saves. The *store* is a seam
 * (ISaveStore) so the pure logic (migrate/newSave/serialize) is testable away
 * from the browser, with a LocalStorage implementation for the real game.
 */
export const SAVE_VERSION = 3;

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
    if (valid.length > 0) data.ownedCars = valid;
  }
  if (raw.upgrades && typeof raw.upgrades === "object") {
    for (const [car, up] of Object.entries(
      raw.upgrades as Record<string, unknown>,
    )) {
      if (typeof up === "object" && up !== null) {
        data.upgrades[car] = { ...freshUpgrades(), ...(up as OwnedUpgrades) };
      }
    }
  }
  if (raw.bestLaps && typeof raw.bestLaps === "object") {
    for (const [t, ms] of Object.entries(
      raw.bestLaps as Record<string, unknown>,
    )) {
      if (typeof ms === "number" && isFinite(ms)) data.bestLaps[t] = ms;
    }
  }
  if (raw.bestGhosts && typeof raw.bestGhosts === "object") {
    for (const [t, pts] of Object.entries(
      raw.bestGhosts as Record<string, unknown>,
    )) {
      if (Array.isArray(pts)) data.bestGhosts[t] = coerceGhost(pts);
    }
  }

  if (raw.clearedTracks && Array.isArray(raw.clearedTracks)) {
    data.clearedTracks = raw.clearedTracks.filter(
      (t): t is string =>
        typeof t === "string" && tracks.some((x) => x.id === t),
    );
  }
  if (
    typeof raw.selectedCar === "string" &&
    carClasses.some((c) => c.id === raw.selectedCar)
  ) {
    data.selectedCar = raw.selectedCar;
    data.upgrades[data.selectedCar] =
      data.upgrades[data.selectedCar] ?? freshUpgrades();
  }
  if (
    typeof raw.selectedTrack === "string" &&
    tracks.some((x) => x.id === raw.selectedTrack)
  ) {
    data.selectedTrack = raw.selectedTrack;
  }
   // UI prefs ride the same save; a legacy save that lacks them keeps defaults.
  if (raw.settings !== undefined)
    data.settings = migrateSettings(raw.settings);
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
  return out.sort((a, b) => a.t - b.t);
}

/** Browser-backed store with a guard so a full/blocked storage never throws. */
export class LocalSaveStore implements ISaveStore {
  constructor(
    private readonly key = "rc-racer-save",
    private readonly storage: Storage | null = typeof localStorage !==
    "undefined"
      ? localStorage
      : null,
  ) {}

  load(): SaveData | null {
    if (this.storage === null) return null;
    const raw = this.storage.getItem(this.key);
    if (raw === null) return null;
    try {
      return migrate(JSON.parse(raw));
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
    this.data = { ...data };
  }
}
