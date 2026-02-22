import { describe, expect, it } from 'vitest';
import { tournamentTemplates } from '../sim/content/tournaments';
import { runSwissTournament } from '../sim/tournaments';
import { createInitialState } from '../sim/weekly';

function withSkillLevel(level: number) {
  const state = createInitialState(12345);
  state.publicRating = 1000;
  state.skills.openingElo = level;
  state.skills.middlegameElo = level;
  state.skills.endgameElo = level;
  state.skills.resilience = level;
  state.skills.competitiveness = level;
  state.skills.studySkills = level;
  return state;
}

describe('tournament sim uses skill profile for game strength', () => {
  it('higher skill profile performs better against same field', () => {
    const tpl = tournamentTemplates[0]!;
    const weak = withSkillLevel(800);
    const strong = withSkillLevel(1800);

    const weakRun = runSwissTournament(weak, tpl);
    const strongRun = runSwissTournament(strong, tpl);

    const weakPlacement = weakRun.updatedState.history.tournaments[0]!.placement;
    const strongPlacement = strongRun.updatedState.history.tournaments[0]!.placement;

    expect(strongPlacement).toBeLessThan(weakPlacement);
    expect(strongRun.updatedState.publicRating).toBeGreaterThan(weakRun.updatedState.publicRating);
  });
});
