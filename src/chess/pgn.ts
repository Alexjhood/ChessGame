/*
 * File Purpose: PGN formatting and parsing utilities.
 * Key Mechanics: Converts move sequences into readable notation for replay and post-game inspection.
 */

import { Chess } from 'chess.js';

export function pgnFromMoves(movesUci: string[]): string {
  const chess = new Chess();
  movesUci.forEach((uci) => {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci[4] as 'q' | 'r' | 'b' | 'n' | undefined;
    chess.move({ from, to, promotion });
  });
  return chess.pgn();
}
