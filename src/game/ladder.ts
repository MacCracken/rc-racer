/**
 * The track ladder: tracks unlock in order, each opened by clearing the one
 * before it. Pure, and shared by `Progression` and save migration so both
 * agree on what's open.
 */
import type { TrackDef } from "../track/Track.ts";

/**
 * Is track `index` of `ladder` open? The first always is; a later one opens
 * once its predecessor is cleared. A cleared track stays open even if a new
 * track is later slotted in before it, so adding content never re-locks a
 * track a player has cleared. (One opened but not yet cleared can close
 * until the new track ahead of it is cleared.)
 */
export function isUnlocked(
  ladder: readonly TrackDef[],
  cleared: readonly string[],
  index: number,
): boolean {
  if (index <= 0) return true;
  const self = ladder[index];
  const prev = ladder[index - 1];
  if (self === undefined || prev === undefined) return false;
  return cleared.includes(prev.id) || cleared.includes(self.id);
}

/**
 * The track a first clear of `trackId` opens: the next one in the ladder, if
 * clearing this one is what unlocks it. Null for the last track, a repeat
 * clear, or a next track that was already open.
 */
export function unlockedByClearing(
  ladder: readonly TrackDef[],
  cleared: readonly string[],
  trackId: string,
): string | null {
  const i = ladder.findIndex((t) => t.id === trackId);
  const next = ladder[i + 1];
  if (i < 0 || next === undefined || cleared.includes(trackId)) return null;
  return isUnlocked(ladder, cleared, i + 1) ? null : next.id;
}
