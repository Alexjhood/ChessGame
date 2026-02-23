/*
 * File Purpose: Tournament performance rating calculations.
 * Key Mechanics: Computes FIDE-style tournament performance from score percentage and average opponent rating.
 */

import { clamp } from './rng';

function dpFromScoreRatio(scoreRatio: number): number {
  const p = clamp(scoreRatio, 0, 1);
  if (p <= 0) return -800;
  if (p >= 1) return 800;
  // Equivalent inverse of the expected-score Elo curve; aligns with FIDE Rp = Ra + dp method.
  const dp = -400 * Math.log10(1 / p - 1);
  return clamp(dp, -800, 800);
}

export function tournamentPerformanceRating(score: number, games: number, averageOpponentRating: number): number {
  if (games <= 0) return Math.round(averageOpponentRating);
  const ratio = score / games;
  const dp = dpFromScoreRatio(ratio);
  return Math.round(averageOpponentRating + dp);
}

