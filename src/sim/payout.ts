import { clamp, createRng } from './rng';

export const PRIZE_MULTIPLIER_MIN = 0.75;
export const PRIZE_MULTIPLIER_MAX = 1.25;
export const PAID_PLACES_MIN_RATIO = 0.2;
const PAYOUT_EXPONENT = 1.08;

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

export function prizePoolRangeForEntryFee(entryFee: number, participants: number): { min: number; max: number } {
  const totalFees = entryFee * participants;
  return {
    min: Math.round(totalFees * PRIZE_MULTIPLIER_MIN),
    max: Math.round(totalFees * PRIZE_MULTIPLIER_MAX)
  };
}

export function generatePrizePool(entryFee: number, participants: number, seed: number, tournamentId: string): number {
  const totalFees = entryFee * participants;
  const rng = createRng(seed + hashString(tournamentId));
  const multiplier = clamp(
    PRIZE_MULTIPLIER_MIN + rng.next() * (PRIZE_MULTIPLIER_MAX - PRIZE_MULTIPLIER_MIN),
    PRIZE_MULTIPLIER_MIN,
    PRIZE_MULTIPLIER_MAX
  );
  return Math.round(totalFees * multiplier);
}

export function paidPlacesForField(participants: number): number {
  return Math.max(1, Math.floor(participants / 2));
}

export function paidPlacesRangeForField(participants: number): { min: number; max: number } {
  const max = paidPlacesForField(participants);
  const min = Math.min(max, Math.max(1, Math.floor(participants * PAID_PLACES_MIN_RATIO)));
  return { min, max };
}

export function generatePaidPlaces(participants: number, seed: number, tournamentId: string): number {
  const { min, max } = paidPlacesRangeForField(participants);
  if (max <= min) return max;
  const rng = createRng(seed + hashString(`${tournamentId}_paid_places`));
  return rng.int(min, max);
}

export function payoutsForField(prizePool: number, participants: number, paidPlaces = paidPlacesForField(participants)): number[] {
  const cappedPaidPlaces = Math.max(1, Math.min(paidPlacesForField(participants), Math.floor(paidPlaces)));
  const weights = Array.from({ length: cappedPaidPlaces }, (_, idx) => 1 / (idx + 1) ** PAYOUT_EXPONENT);
  const weightTotal = weights.reduce((acc, w) => acc + w, 0);
  const raw = weights.map((w) => (prizePool * w) / weightTotal);
  const floored = raw.map((v) => Math.floor(v));
  let remaining = prizePool - floored.reduce((acc, v) => acc + v, 0);

  // Largest-remainder allocation keeps total exactly equal to prizePool.
  const remainders = raw.map((v, idx) => ({ idx, frac: v - floored[idx]! })).sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < remainders.length && remaining > 0; i += 1) {
    floored[remainders[i]!.idx] += 1;
    remaining -= 1;
  }
  return floored;
}

export function payoutForPlace(place: number, prizePool: number, participants: number, paidPlaces = paidPlacesForField(participants)): number {
  if (place < 1) return 0;
  const payouts = payoutsForField(prizePool, participants, paidPlaces);
  return payouts[place - 1] ?? 0;
}
