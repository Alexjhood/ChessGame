/*
 * File Purpose: Late-game draw trigger mechanics for stockfish runs.
 * Key Mechanics: Applies configurable post-move draw probabilities when engine evaluation indicates near-equality.
 */

import { getSimSettings } from './settings';

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function stockfishDrawChanceAtFullMove(fullMove: number): number {
  const settings = getSimSettings().performance;
  if (fullMove <= settings.stockfishDrawStartMove) return 0;
  const over = fullMove - settings.stockfishDrawStartMove;
  return clamp01(settings.stockfishDrawBaseChance + over * settings.stockfishDrawIncrementPerMove);
}

export function canTriggerStockfishBalanceDraw(evalWhiteCp: number): boolean {
  const thresholdCp = getSimSettings().performance.stockfishDrawBalancedThresholdPoints * 100;
  return Math.abs(evalWhiteCp) <= thresholdCp;
}

