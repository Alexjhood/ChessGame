/*
 * File Purpose: Monthly pool generation tests.
 * Key Mechanics: Checks event rotation, constraints, and deterministic selection behavior from seed/week inputs.
 */

import { describe, expect, it } from 'vitest';
import { tournamentTemplates } from '../sim/content/tournaments';
import { monthlyTournamentPool, WORLD_CHAMPIONSHIP_TEMPLATE } from '../sim/tournamentPool';

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

  it('renames elite 2000+ events to real-event names for high-Elo careers', () => {
    const pool = monthlyTournamentPool(tournamentTemplates, 2, 123, 6, 2100);
    const elite = pool.filter((t) => t.avgOpponentRating >= 2000);
    expect(elite.length).toBeGreaterThan(0);
    expect(elite.every((t) => t.tier === 'Elite Real Event')).toBe(true);
  });

  it('injects world championship match at 2600+', () => {
    const pool = monthlyTournamentPool(tournamentTemplates, 2, 123, 6, 2600);
    expect(pool.some((t) => t.id === WORLD_CHAMPIONSHIP_TEMPLATE.id)).toBe(true);
  });
});
