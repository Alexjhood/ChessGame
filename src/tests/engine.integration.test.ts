/*
 * File Purpose: Integration tests for engine-to-simulation wiring.
 * Key Mechanics: Validates move generation flow and stockfish integration assumptions at system boundaries.
 */

import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { chooseMove } from '../engine/stockfish';
import type { SkillRatings } from '../sim/models';

const mid: SkillRatings = {
  openingElo: 1400,
  middlegameElo: 1400,
  endgameElo: 1400,
  resilience: 1400,
  competitiveness: 1400,
  studySkills: 1400
};

describe('engine integration', () => {
  it('requires stockfish handle (no fallback when unavailable)', async () => {
    const chess = new Chess();
    await expect(
      chooseMove(null, chess.fen(), {
        skills: mid,
        fatigue: 15,
        confidence: 0,
        playedMoves: [],
        seed: 1000
      })
    ).rejects.toThrow();
  });
});
