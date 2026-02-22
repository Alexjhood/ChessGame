/*
 * File Purpose: Monthly pool generation tests.
 * Key Mechanics: Checks event rotation, constraints, and deterministic selection behavior from seed/week inputs.
 */

import { describe, expect, it } from 'vitest';
import { tournamentTemplates } from '../sim/content/tournaments';
import { monthlyTournamentPool } from '../sim/tournamentPool';

describe('monthlyTournamentPool', () => {
  it('returns stable results for same seed and month', () => {
    const a = monthlyTournamentPool(tournamentTemplates, 3, 1234, 6).map((t) => t.id);
    const b = monthlyTournamentPool(tournamentTemplates, 3, 1234, 6).map((t) => t.id);
    expect(a).toEqual(b);
  });

  it('rotates available tournaments month to month', () => {
    const month1 = monthlyTournamentPool(tournamentTemplates, 1, 99, 6).map((t) => t.id);
    const month2 = monthlyTournamentPool(tournamentTemplates, 2, 99, 6).map((t) => t.id);
    expect(month1).not.toEqual(month2);
  });

  it('respects requested pool size', () => {
    const pool = monthlyTournamentPool(tournamentTemplates, 1, 88, 4);
    expect(pool).toHaveLength(4);
  });
});
