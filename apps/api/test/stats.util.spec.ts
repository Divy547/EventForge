import { describe, it, expect } from '@jest/globals';
import { computeSuccessRate } from '../src/modules/stats/stats.util.js';

describe('computeSuccessRate', () => {
  it('returns null when no delivery has reached a final state', () => {
    expect(computeSuccessRate(0, 0)).toBeNull();
  });

  it('is 1 when everything final succeeded', () => {
    expect(computeSuccessRate(7, 0)).toBe(1);
  });

  it('is 0 when everything final was dead-lettered', () => {
    expect(computeSuccessRate(0, 3)).toBe(0);
  });

  it('rounds to four decimal places', () => {
    expect(computeSuccessRate(1, 2)).toBe(0.3333);
    expect(computeSuccessRate(2, 1)).toBe(0.6667);
  });
});
