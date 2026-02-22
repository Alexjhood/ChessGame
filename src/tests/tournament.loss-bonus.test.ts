/*
 * File Purpose: Lost-game bonus tests.
 * Key Mechanics: Ensures random skill-point bonuses from losses are applied and recorded correctly.
 */

import { describe, expect, it } from 'vitest';
import { tournamentTemplates } from '../sim/content/tournaments';
import { runSwissTournament } from '../sim/tournaments';
import { createInitialState } from '../sim/weekly';

describe('tournament loss bonuses', () => {
  it('adds +1 random skill point per player loss and reflects in monthly deltas', () => {
    const tpl = tournamentTemplates[0]!;
    const state = createInitialState(7777);
    const run = runSwissTournament(state, tpl, { useSkillAverageForAllGames: true });

    const losses = run.roundGames.filter((g) => {
      if (g.white.id === 'player') return g.result === '0-1';
      if (g.black.id === 'player') return g.result === '1-0';
      return false;
    }).length;

    const next = run.updatedState;
    const baseResilienceGain = Math.round(tpl.rounds * 0.9);
    const baseCompetitivenessGain = Math.round(tpl.rounds * 1.2);
    const baseStudyGain = Math.round(tpl.rounds * 0.4);
    const baseTotalGain = baseResilienceGain + baseCompetitivenessGain + baseStudyGain;

    const totalSkillGain =
      (next.skills.openingElo - state.skills.openingElo) +
      (next.skills.middlegameElo - state.skills.middlegameElo) +
      (next.skills.endgameElo - state.skills.endgameElo) +
      (next.skills.resilience - state.skills.resilience) +
      (next.skills.competitiveness - state.skills.competitiveness) +
      (next.skills.studySkills - state.skills.studySkills);

    expect(totalSkillGain).toBe(baseTotalGain + losses);

    const deltaTotal =
      (next.recentSkillDeltas.openingElo ?? 0) +
      (next.recentSkillDeltas.middlegameElo ?? 0) +
      (next.recentSkillDeltas.endgameElo ?? 0) +
      (next.recentSkillDeltas.resilience ?? 0) +
      (next.recentSkillDeltas.competitiveness ?? 0) +
      (next.recentSkillDeltas.studySkills ?? 0);
    expect(deltaTotal).toBe(baseTotalGain + losses);
  });
});
