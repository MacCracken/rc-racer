import { computeReward, type RewardInput } from "./economy.ts";
import {
  applyBuild,
  nextTier,
  freshUpgrades,
  type OwnedUpgrades,
  type SlotId,
} from "./upgrades.ts";
import { newSave, migrate, type ISaveStore, type SaveData } from "./save.ts";
import { carById, carClasses, freshBase } from "./cars.ts";
import { tracks } from "../track/tracks.ts";
import type { CarStats } from "../core/tuning.ts";
import type { Ghost } from "../race/Ghost.ts";
import type { Settings } from "./settings.ts";

export interface RaceResult {
  trackId: string;
  carId: string;
  laps: number;
  bestLapMs: number;
  finished: boolean;
  bestLapGhost?: Ghost;
}

export interface RaceOutcome {
  creditsEarned: number;
  newRecord: boolean;
  oldBest: number;
  newBest: number;
  unlockedCar: string | null;
}

/**
 * The progression loop in one place: credits, owned cars, per-car upgrades, best
 * laps, and the transitions between them. Pure (no DOM, no clock), so the whole
 * "earn -> spend -> go faster -> save" loop is unit-testable.
 */
export class Progression {
  data: SaveData;

  constructor(data?: SaveData) {
    this.data = data ?? newSave();
  }

  static fromStore(store: ISaveStore): Progression {
    const loaded = store.load();
    return new Progression(loaded === null ? newSave() : migrate(loaded));
  }

  static fresh(): Progression {
    return new Progression(newSave());
  }

  // --- Cars / track selection ---------------------------------------------
  get selectedCarId(): string {
    return this.data.selectedCar;
  }
  get selectedTrackId(): string {
    return this.data.selectedTrack;
  }
  get credits(): number {
    return this.data.credits;
  }
  setCredits(c: number): void {
    this.data.credits = Math.max(0, Math.floor(c));
  }

  /** Select an owned car. An unowned one must be bought via `unlockCar`. */
  selectCar(id: string): boolean {
    if (carById(id) === undefined || !this.isCarOwned(id)) return false;
    this.data.selectedCar = id;
    this.data.upgrades[id] = this.data.upgrades[id] ?? freshUpgrades();
    return true;
  }

  selectTrack(id: string): void {
    if (!tracks.some((t) => t.id === id)) return;
    this.data.selectedTrack = id;
  }

  isCarOwned(id: string): boolean {
    return this.data.ownedCars.includes(id);
  }

  /** Try to unlock a car class by paying its cost. */
  unlockCar(id: string): boolean {
    const c = carById(id);
    if (c === undefined || this.data.ownedCars.includes(id)) return false;
    if (this.data.credits < c.cost) return false;
    this.data.credits -= c.cost;
    this.data.ownedCars.push(id);
    this.data.upgrades[id] = this.data.upgrades[id] ?? freshUpgrades();
    this.data.selectedCar = id;
    return true;
  }

  // --- Upgrades -----------------------------------------------------------
  upgradesFor(carId: string): OwnedUpgrades {
    return this.data.upgrades[carId] ?? freshUpgrades();
  }

  /** Resolve the full stat vector for a car after its installed upgrades. */
  resolveStats(carId: string): CarStats {
    return applyBuild(freshBase(carId), this.upgradesFor(carId));
  }

  /**
   * Buy & install the next tier of a slot on a car. Spends credits and bumps the
   * owned tier, returning true on success. Never buys beyond the last tier.
   */
  buyUpgrade(carId: string, slot: SlotId): boolean {
    if (!this.isCarOwned(carId)) return false;
    const owned =
      this.data.upgrades[carId] ??
      (this.data.upgrades[carId] = freshUpgrades());
    const tier = nextTier(slot, owned);
    if (tier === null) return false;
    if (this.data.credits < tier.cost) return false;
    this.data.credits -= tier.cost;
    owned[slot] = (owned[slot] ?? 0) + 1;
    return true;
  }

  // --- Records + rewards --------------------------------------------------
  bestLap(trackId: string): number {
    return this.data.bestLaps[trackId] ?? Infinity;
  }

  /** The best-lap ghost for a track, or empty if none recorded yet. */
  ghostFor(trackId: string): Ghost {
    return this.data.bestGhosts[trackId] ?? [];
  }

  isTrackCleared(trackId: string): boolean {
    return this.data.clearedTracks.includes(trackId);
  }

  /** Track 0 is always open; each later track needs its predecessor cleared. */
  isTrackUnlocked(index: number): boolean {
    if (index <= 0) return true;
    const prev = tracks[index - 1];
    return prev === undefined || this.data.clearedTracks.includes(prev.id);
  }

  /**
   * Record a finished attempt: set the record if beaten, award credits, mark the
   * track cleared, and surface any car class whose unlock threshold we just
   * crossed. Returns the *summary* for the results screen.
   */
  recordRace(result: RaceResult): RaceOutcome {
    const track = tracks.find((t) => t.id === result.trackId);
    const par = track?.parLapMs ?? 4000;

    const oldBest = this.data.bestLaps[result.trackId] ?? Infinity;
    // Only a real, positive lap time can set a record: a corrupt one (e.g. a
    // negative time) would otherwise become a "best" nothing can ever beat.
    const validLap = isFinite(result.bestLapMs) && result.bestLapMs > 0;
    const beat = result.finished && validLap && result.bestLapMs < oldBest;
    const newBest = beat ? result.bestLapMs : oldBest;

    const input: RewardInput = {
      parLapMs: par,
      bestLapMs: validLap ? result.bestLapMs : par,
      lapsCompleted: result.laps,
    };
    let creditsEarned = 0;
    if (result.finished) creditsEarned = computeReward(input);
    const creditsBefore = this.data.credits;
    this.data.credits += creditsEarned;

    if (beat) {
      this.data.bestLaps[result.trackId] = newBest;
      if (result.bestLapGhost !== undefined)
        this.data.bestGhosts[result.trackId] = result.bestLapGhost;
    }
    if (result.finished && !this.isTrackCleared(result.trackId)) {
      this.data.clearedTracks.push(result.trackId);
    }

    return {
      creditsEarned,
      newRecord: beat,
      oldBest,
      newBest,
      unlockedCar: this.detectUnlock(creditsBefore),
    };
  }

  /**
   * An unowned car whose price this race's earnings just reached, i.e.
   * affordable now but not before, so it is announced once rather than
   * after every race.
   */
  private detectUnlock(creditsBefore: number): string | null {
    for (const c of carClasses) {
      if (
        this.data.ownedCars.includes(c.id) === false &&
        creditsBefore < c.cost &&
        this.data.credits >= c.cost
      ) {
        return c.id;
      }
    }
    return null;
  }

  snapshot(): SaveData {
    return this.data;
  }

  /**
   * Persistent UI prefs (key bindings, colour-blind mode, HUD size). They live
   * in the same versioned save as progress, so they ride the same store +
   * migration path.
   */
  get settings(): Settings {
    return this.data.settings;
  }

  setSettings(s: Settings): void {
    this.data.settings = s;
  }
}
