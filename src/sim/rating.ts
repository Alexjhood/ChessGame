import { clamp } from './rng';

export function expectedScore(playerRating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - playerRating) / 400));
}

export function kFactor(rating: number, isProvisional = false): number {
  // FIDE-style K policy:
  // - 40 for provisional/new players (first rating games)
  // - 20 for established players under 2400
  // - 10 for established players at/above 2400
  if (isProvisional) return 40;
  if (rating >= 2400) return 10;
  return 20;
}

export function updateElo(playerRating: number, opponentRating: number, score: 0 | 0.5 | 1, isProvisional = false): number {
  const expected = expectedScore(playerRating, opponentRating);
  const k = kFactor(playerRating, isProvisional);
  const next = playerRating + k * (score - expected);
  return Math.round(clamp(next, 100, 3500));
}
