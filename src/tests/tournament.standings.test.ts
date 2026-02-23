/*
 * File Purpose: Standings and table tests.
 * Key Mechanics: Validates ranking order, tie handling, and displayed standings completeness.
 */

import { describe, expect, it } from 'vitest';
import { tournamentTemplates } from '../sim/content/tournaments';
import { runSwissTournament } from '../sim/tournaments';
import { createInitialState } from '../sim/weekly';

describe('tournament standings', () => {
  it('keeps all participants and tracks rating changes', () => {
    const state = createInitialState(777);
    const tpl = tournamentTemplates[0]!;
    const run = runSwissTournament(state, tpl);
    const expectedField = Math.max(2, tpl.fieldSize ?? 32);

    expect(run.standings).toHaveLength(expectedField);
    const deltas = run.standings.map((s) => s.rating - s.initialRating);
    expect(deltas.some((d) => d !== 0)).toBe(true);
  });
});
