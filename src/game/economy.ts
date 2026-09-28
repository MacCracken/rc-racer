/**
 * The lap-time side of a race's credits: a base payout for finishing, plus a
 * *performance bonus* that is larger the faster the best lap is versus the
 * track's par time, with diminishing returns (a perfect lap isn't worth 10x,
 * and slower is worth far less). Pure and monotonic: a faster best lap always
 * earns more. A race also pays `podiumBonus` for its finishing position —
 * `Progression.recordRace` adds the two.
 */
export interface RewardInput {
  parLapMs: number; // the track's par lap
  bestLapMs: number; // the player's best single lap
  lapsCompleted: number;
}

export const REWARD_MIN = 0;
const REWARD_MAX = 320;
/** Paid for finishing a race… */
export const FINISH_PAY = 75;
/** …and for each lap of it. */
export const LAP_PAY = 10;

export function computeReward(inp: RewardInput): number {
  const { base, pace } = rewardParts(inp);
  return base + pace;
}

/**
 * `computeReward`'s two parts, for the results screen: the payout for
 * finishing (`base`) and the bonus for beating par (`pace`, 0 at or above
 * par).
 */
export function rewardParts(inp: RewardInput): { base: number; pace: number } {
  const base = FINISH_PAY + inp.lapsCompleted * LAP_PAY;
  if (inp.bestLapMs <= 0 || !isFinite(inp.bestLapMs) || inp.parLapMs <= 0) {
    return { base, pace: 0 };
  }
  // ratio > 1 is faster than par. The 1.6 power rewards beating par by more;
  // REWARD_MAX caps it, and slower-than-par laps floor at REWARD_MIN.
  const ratio = inp.parLapMs / inp.bestLapMs;
  const bonus = Math.round((Math.pow(ratio, 1.6) - 1) * 180);
  return { base, pace: Math.min(REWARD_MAX, Math.max(REWARD_MIN, bonus)) };
}

/**
 * Credits for where you finished against the AI field (index 0 = P1): the
 * reason to race the rivals, not just the clock. Nothing off the podium, and
 * nothing when racing alone.
 */
export const PODIUM_BONUS: readonly number[] = [60, 35, 20];

export function podiumBonus(position: number, fieldSize: number): number {
  if (fieldSize < 2 || !Number.isInteger(position) || position < 1) return 0;
  return PODIUM_BONUS[position - 1] ?? 0;
}
