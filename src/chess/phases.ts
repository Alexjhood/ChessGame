/*
 * File Purpose: Determines opening/middlegame/endgame phase transitions.
 * Key Mechanics: Applies move-count and material thresholds so phase-specific skill Elo can drive move quality.
 */

import { getSimSettings } from '../sim/settings';

export type Phase = 'opening' | 'middlegame' | 'endgame';

const piecePoints: Record<string, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
  P: 1,
  N: 3,
  B: 3,
  R: 5,
  Q: 9,
  K: 0
};

export function materialPointsBySide(fen: string): { white: number; black: number } {
  const board = fen.split(' ')[0] ?? '';
  let white = 0;
  let black = 0;
  for (const ch of board) {
    const pts = piecePoints[ch];
    if (pts === undefined) continue;
    if (/[A-Z]/.test(ch)) white += pts;
    else black += pts;
  }
  return { white, black };
}

export function materialDeficitPoints(fen: string, side: 'white' | 'black'): number {
  const mat = materialPointsBySide(fen);
  if (side === 'white') return Math.max(0, mat.black - mat.white);
  return Math.max(0, mat.white - mat.black);
}

export function detectPhase(fen: string): Phase {
  const settings = getSimSettings();
  const move = Number(fen.split(' ')[5] ?? 1);
  const mat = materialPointsBySide(fen);
  const materialEndgame =
    mat.white < settings.performance.middlegameMinSideMaterialPoints ||
    mat.black < settings.performance.middlegameMinSideMaterialPoints;

  if (move <= settings.performance.openingMaxMove) return 'opening';
  if (move > settings.performance.middlegameMaxMove || materialEndgame) return 'endgame';
  return 'middlegame';
}
