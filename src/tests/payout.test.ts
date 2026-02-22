import { describe, expect, it } from 'vitest';
import {
  PAID_PLACES_MIN_RATIO,
  PRIZE_MULTIPLIER_MAX,
  PRIZE_MULTIPLIER_MIN,
  generatePaidPlaces,
  generatePrizePool,
  paidPlacesForField,
  paidPlacesRangeForField,
  payoutForPlace,
  payoutsForField
} from '../sim/payout';

describe('payout model', () => {
  it('paid places vary within range and never exceed half', () => {
    const maxPaid = paidPlacesForField(32);
    const range = paidPlacesRangeForField(32);
    expect(maxPaid).toBe(16);
    expect(range.min).toBe(Math.floor(32 * PAID_PLACES_MIN_RATIO));
    const paid = generatePaidPlaces(32, 42, 'event_a');
    expect(paid).toBeGreaterThanOrEqual(range.min);
    expect(paid).toBeLessThanOrEqual(range.max);
  });

  it('payouts sum exactly to prize pool', () => {
    const prizePool = 1379;
    const payouts = payoutsForField(prizePool, 32, 11);
    expect(payouts.reduce((a, b) => a + b, 0)).toBe(prizePool);
    expect(payoutForPlace(12, prizePool, 32, 11)).toBe(0);
  });

  it('prize pool uses fees times random multiplier bounds', () => {
    const fees = 25 * 32;
    const pool = generatePrizePool(25, 32, 99, 'test_open');
    expect(pool).toBeGreaterThanOrEqual(Math.round(fees * PRIZE_MULTIPLIER_MIN));
    expect(pool).toBeLessThanOrEqual(Math.round(fees * PRIZE_MULTIPLIER_MAX));
  });
});
