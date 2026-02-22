import { Chess, type Move } from 'chess.js';

export interface MoveSummary {
  san: string;
  uci: string;
}

export function createGame(fen?: string): Chess {
  return new Chess(fen);
}

export function legalMoves(chess: Chess): Move[] {
  return chess.moves({ verbose: true });
}

export function applyUciMove(chess: Chess, uci: string): MoveSummary {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci[4] as 'q' | 'r' | 'b' | 'n' | undefined;
  const move = chess.move({ from, to, promotion });
  if (!move) {
    throw new Error(`Illegal move: ${uci}`);
  }
  return { san: move.san, uci: `${move.from}${move.to}${move.promotion ?? ''}` };
}

export function gameResult(chess: Chess): '1-0' | '0-1' | '1/2-1/2' | null {
  if (chess.isCheckmate()) {
    return chess.turn() === 'w' ? '0-1' : '1-0';
  }
  // For simulation we intentionally ignore claim-based draw states
  // (e.g. threefold/fifty-move) to avoid premature artificial endings.
  if (!chess.isStalemate() && !chess.isInsufficientMaterial()) return null;
  return '1/2-1/2';
}
