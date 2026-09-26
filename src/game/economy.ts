/**
 * Credits from a finished race: a base payout for finishing, plus a *performance
 * bonus* that is larger the faster the best lap is versus the track's par time,
 * with diminishing returns (a perfect lap isn't worth 10x, and slower is worth
 * far less). Pure and monotonic: a faster best lap always earns more.
 */
export interface RewardInput {
  parLapMs: number; // the track's par lap
  bestLapMs: number; // the player's best single lap
  lapsCompleted: number;
}

export const REWARD_MIN = 0;
const REWARD_MAX = 320;
const BASE = 60;
const PER_LAP = 8;

export function computeReward(inp: RewardInput): number {
  const base = BASE + inp.lapsCompleted * PER_LAP;
  if (inp.bestLapMs <= 0 || !isFinite(inp.bestLapMs) || inp.parLapMs <= 0) {
    return base;
  }
  // ratio > 1 is faster than par. The 1.6 power rewards beating par by more;
  // REWARD_MAX caps it, and slower-than-par laps floor at REWARD_MIN.
  const ratio = inp.parLapMs / inp.bestLapMs;
  const bonus = Math.round((Math.pow(ratio, 1.6) - 1) * 180);
  const clamped = Math.min(REWARD_MAX, Math.max(REWARD_MIN, bonus));
  return base + clamped;
}
