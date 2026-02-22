import { describe, expect, it } from 'vitest';
import { detectPhase } from '../chess/phases';

describe('phase detection', () => {
  it('detects opening by move count', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1';
    expect(detectPhase(fen)).toBe('opening');
  });

  it('detects endgame by piece count', () => {
    const fen = '8/8/8/8/8/4k3/8/4K3 w - - 0 40';
    expect(detectPhase(fen)).toBe('endgame');
  });

  it('detects middlegame otherwise', () => {
    const fen = 'r1bq1rk1/pp2ppbp/2np1np1/2p5/2PPP3/2N1BN2/PP1Q1PPP/R3KB1R w KQ - 2 14';
    expect(detectPhase(fen)).toBe('middlegame');
  });
});
