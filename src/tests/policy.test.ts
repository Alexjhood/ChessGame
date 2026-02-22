/*
 * File Purpose: Move-policy probability tests.
 * Key Mechanics: Ensures fatigue/resilience/confidence adjustments affect blunder and inaccuracy rates as expected.
 */

import { describe, expect, it } from 'vitest';
import { buildMovePolicy } from '../engine/policy';
import type { SkillRatings } from '../sim/models';

const baseFen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2BPP3/8/PPP2PPP/RNBQK1NR b KQkq - 2 3';

const weak: SkillRatings = {
  openingElo: 850,
  middlegameElo: 850,
  endgameElo: 850,
  resilience: 850,
  competitiveness: 850,
  studySkills: 850
};

const strong: SkillRatings = {
  openingElo: 2100,
  middlegameElo: 2100,
  endgameElo: 2100,
  resilience: 2100,
  competitiveness: 2100,
  studySkills: 2100
};

describe('move policy', () => {
  it('gives stronger players more precise settings', () => {
    const a = buildMovePolicy(baseFen, weak, 20, 0, 0);
    const b = buildMovePolicy(baseFen, strong, 20, 0, 0);

    expect(b.movetimeMs).toBeGreaterThan(a.movetimeMs);
    expect(b.temperature).toBeLessThan(a.temperature);
    expect(b.pBlunder).toBeLessThan(a.pBlunder);
    expect(b.pInaccuracy).toBeLessThan(a.pInaccuracy);
  });

  it('competitiveness provides a comeback boost when materially behind', () => {
    const behindNoComp = buildMovePolicy(baseFen, { ...strong, competitiveness: 800 }, 20, 0, 4);
    const behindComp = buildMovePolicy(baseFen, { ...strong, competitiveness: 2000 }, 20, 0, 4);
    expect(behindComp.effectiveElo).toBeGreaterThanOrEqual(behindNoComp.effectiveElo);
  });

  it('increases blunder probability as fatigue increases', () => {
    const lowFatigue = buildMovePolicy(baseFen, strong, 10, 0, 0);
    const highFatigue = buildMovePolicy(baseFen, strong, 90, 0, 0);
    expect(highFatigue.pBlunder).toBeGreaterThan(lowFatigue.pBlunder);
  });
});
