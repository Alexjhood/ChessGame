import { describe, expect, it } from 'vitest';
import { tournamentTemplates } from '../sim/content/tournaments';
import { runSwissTournament } from '../sim/tournaments';
import { createInitialState } from '../sim/weekly';

describe('tournament standings', () => {
  it('keeps all participants and tracks rating changes', () => {
    const state = createInitialState(777);
    const tpl = tournamentTemplates[0]!;
    const run = runSwissTournament(state, tpl);

    expect(run.standings).toHaveLength(32);
    const deltas = run.standings.map((s) => s.rating - s.initialRating);
    expect(deltas.some((d) => d !== 0)).toBe(true);
  });
});
