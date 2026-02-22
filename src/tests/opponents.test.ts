import { describe, expect, it } from 'vitest';
import { generateOpponents } from '../sim/opponents';

describe('opponent generation', () => {
  it('keeps skill averages close to official Elo', () => {
    const opponents = generateOpponents(123, 40, 1400, 120);
    opponents.forEach((opp) => {
      const avgSkill =
        (opp.skills.openingElo +
          opp.skills.middlegameElo +
          opp.skills.endgameElo +
          opp.skills.resilience +
          opp.skills.competitiveness +
          opp.skills.studySkills) /
        6;
      expect(Math.abs(avgSkill - opp.publicRating)).toBeLessThanOrEqual(45);
    });
  });
});
