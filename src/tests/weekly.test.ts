/*
 * File Purpose: Monthly training tests.
 * Key Mechanics: Covers training gains, coaching credits, rest-based fatigue recovery, and progression bookkeeping.
 */

import { describe, expect, it } from 'vitest';
import { trainingModules } from '../sim/content/trainingModules';
import {
  applyTrainingMonth,
  applyTrainingWeek,
  coachingCostForBatch,
  createInitialState,
  puzzleAttemptsForState,
  trainingCreditsForState,
  trainingMeanGain
} from '../sim/weekly';
import { DEFAULT_SIM_SETTINGS, setSimSettings } from '../sim/settings';

describe('weekly training', () => {
  it('applies module deltas and advances week', () => {
    const initial = createInitialState(42);
    const module = trainingModules.find((m) => m.id === 'opening_lab')!;

    const state = structuredClone(initial);
    state.money = 200;
    const next = applyTrainingMonth(state, [module], 1);

    expect(next.week).toBe(initial.week + 1);
    expect(next.skills.openingElo).toBeGreaterThan(initial.skills.openingElo);
    expect(next.money).toBe(state.money - coachingCostForBatch(0, 1));
    expect(next.confidence).toBeGreaterThan(initial.confidence);
    expect(next.publicRating).toBe(initial.publicRating);
  });

  it('decays average gain by factor 0.9 per repeated training', () => {
    expect(trainingMeanGain(0)).toBe(50);
    expect(trainingMeanGain(1)).toBe(45);
    expect(trainingMeanGain(2)).toBeCloseTo(40.5, 5);
  });

  it('keeps base training credits fixed at zero (study habits no longer adds credits)', () => {
    const state = createInitialState(10);
    expect(trainingCreditsForState(state)).toBe(0);
    state.skills.studySkills = 1000;
    expect(trainingCreditsForState(state)).toBe(0);
  });

  it('converts study habits into monthly puzzle attempts (+1 per 100 points)', () => {
    const state = createInitialState(10);
    expect(puzzleAttemptsForState(state)).toBe(1);
    state.skills.studySkills = 240;
    expect(puzzleAttemptsForState(state)).toBe(3);
  });

  it('converts unused training credits into fatigue recovery', () => {
    const state = createInitialState(11);
    state.fatigue = 40;
    const next = applyTrainingMonth(state, [], 1); // buy 1 coaching credit and leave it unused
    expect(next.fatigue).toBe(
      Math.max(0, 40 - DEFAULT_SIM_SETTINGS.training.fatigueRecoveryPerUnusedCredit)
    );
  });

  it('applies base rest recovery when no training credits are available', () => {
    const state = createInitialState(13);
    state.fatigue = 40;
    const next = applyTrainingMonth(state, [], 0);
    expect(next.fatigue).toBe(30);
  });

  it('coaching purchases add credits and use escalating cost', () => {
    const state = createInitialState(12);
    state.money = 500;
    const module = trainingModules.find((m) => m.id === 'opening_lab')!;
    const next = applyTrainingMonth(state, [module, module], 2);
    expect(next.coachingPurchases).toBe(2);
    expect(next.money).toBe(500 - coachingCostForBatch(0, 2)); // 50 + 75 by default
    expect(next.week).toBe(state.week + 1);
  });

  it('initial state uses configured starting Elo for official and all skill ratings', () => {
    const original = structuredClone(DEFAULT_SIM_SETTINGS);
    try {
      setSimSettings({
        ...DEFAULT_SIM_SETTINGS,
        career: { startingElo: 1234 }
      });
      const state = createInitialState(99);
      expect(state.publicRating).toBe(1234);
      expect(state.skills.openingElo).toBe(1234);
      expect(state.skills.middlegameElo).toBe(1234);
      expect(state.skills.endgameElo).toBe(1234);
      expect(state.skills.resilience).toBe(1234);
      expect(state.skills.competitiveness).toBe(1234);
      expect(state.skills.studySkills).toBe(0);
    } finally {
      setSimSettings(original);
    }
  });
});
