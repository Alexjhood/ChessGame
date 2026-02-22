/*
 * File Purpose: Elo formula tests.
 * Key Mechanics: Checks expected-score and rating delta behavior against known matchup outcomes.
 */

import { describe, expect, it } from 'vitest';
import { expectedScore, kFactor, updateElo } from '../sim/rating';

describe('rating', () => {
  it('expected score is symmetric', () => {
    const a = expectedScore(1200, 1400);
    const b = expectedScore(1400, 1200);
    expect(Number((a + b).toFixed(6))).toBe(1);
  });

  it('selects proper K factors', () => {
    expect(kFactor(900, true)).toBe(40);
    expect(kFactor(1500)).toBe(20);
    expect(kFactor(2300)).toBe(20);
    expect(kFactor(2400)).toBe(10);
    expect(kFactor(2500)).toBe(10);
  });

  it('updates elo in correct direction', () => {
    expect(updateElo(1200, 1400, 1)).toBeGreaterThan(1200);
    expect(updateElo(1400, 1200, 0)).toBeLessThan(1400);
    expect(updateElo(1600, 1600, 0.5)).toBe(1600);
  });
});
