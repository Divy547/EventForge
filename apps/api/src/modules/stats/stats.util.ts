/**
 * Success rate over deliveries that reached a final state: COMPLETED / (COMPLETED + DEAD_LETTER).
 * PENDING, IN_FLIGHT and FAILED (still retrying) deliveries are undecided and excluded, so an
 * in-progress retry does not count against the rate. Returns null when nothing is final yet.
 */
export function computeSuccessRate(completed: number, deadLetter: number): number | null {
  const finalCount = completed + deadLetter;
  if (finalCount === 0) {
    return null;
  }
  return Math.round((completed / finalCount) * 10000) / 10000;
}
