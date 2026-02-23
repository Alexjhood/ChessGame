/*
 * File Purpose: Simulation settings defaults and normalization.
 * Key Mechanics: Stores tunable gameplay parameters and guards persisted settings with type/number normalization.
 */

export interface SimSettings {
  career: {
    startingElo: number;
  };
  training: {
    baseMeanGain: number;
    decayPerTraining: number;
    randomStdDevRatio: number;
    minGain: number;
    maxGain: number;
    crossGainRatio: number;
    baseCreditsPerMonth: number;
    studySkillCreditStep: number;
    baseStudySkillElo: number;
    maxCreditsPerMonth: number;
    fatigueRecoveryPerUnusedCredit: number;
    coachingBaseCost: number;
    coachingCostStep: number;
    workBaseIncome: number;
    workIncomeStep: number;
    puzzleAttemptStudyStep: number;
    puzzleLambdaBase: number;
    puzzleLambdaStep: number;
    puzzleLambdaStartElo: number;
    puzzleLambdaBucketSize: number;
  };
  performance: {
    maxEffectiveElo: number;
    minEffectiveElo: number;
    drawBiasBase: number;
    fatigueBlunderBoostAtMax: number;
    openingMaxMove: number;
    middlegameMaxMove: number;
    middlegameMinSideMaterialPoints: number;
    competitivenessBoostFactor: number;
    competitivenessDeficitPoints: number;
    sub1350DecisionSpread: number;
    stockfishDrawStartMove: number;
    stockfishDrawBaseChance: number;
    stockfishDrawIncrementPerMove: number;
    stockfishDrawBalancedThresholdPoints: number;
  };
}

export const DEFAULT_SIM_SETTINGS: SimSettings = {
  career: {
    startingElo: 700
  },
  training: {
    baseMeanGain: 50,
    decayPerTraining: 0.9,
    randomStdDevRatio: 0.25,
    minGain: 6,
    maxGain: 120,
    crossGainRatio: 0.18,
    baseCreditsPerMonth: 0,
    studySkillCreditStep: 100,
    baseStudySkillElo: 900,
    maxCreditsPerMonth: 8,
    fatigueRecoveryPerUnusedCredit: 10,
    coachingBaseCost: 50,
    coachingCostStep: 25,
    workBaseIncome: 25,
    workIncomeStep: 10,
    puzzleAttemptStudyStep: 100,
    puzzleLambdaBase: 1,
    puzzleLambdaStep: 1,
    puzzleLambdaStartElo: 800,
    puzzleLambdaBucketSize: 200
  },
  performance: {
    maxEffectiveElo: 2800,
    minEffectiveElo: 700,
    drawBiasBase: 0.18,
    fatigueBlunderBoostAtMax: 0.15,
    openingMaxMove: 20,
    middlegameMaxMove: 60,
    middlegameMinSideMaterialPoints: 20,
    competitivenessBoostFactor: 0.1,
    competitivenessDeficitPoints: 3,
    sub1350DecisionSpread: 1.15,
    stockfishDrawStartMove: 40,
    stockfishDrawBaseChance: 0.01,
    stockfishDrawIncrementPerMove: 0.001,
    stockfishDrawBalancedThresholdPoints: 1.5
  }
};

let activeSettings: SimSettings = structuredClone(DEFAULT_SIM_SETTINGS);

export function getSimSettings(): SimSettings {
  return activeSettings;
}

export function setSimSettings(settings: SimSettings): void {
  activeSettings = structuredClone(settings);
}

export function mergeSimSettings(partial: Partial<SimSettings>): SimSettings {
  const merged: SimSettings = {
    career: {
      ...activeSettings.career,
      ...(partial.career ?? {})
    },
    training: {
      ...activeSettings.training,
      ...(partial.training ?? {})
    },
    performance: {
      ...activeSettings.performance,
      ...(partial.performance ?? {})
    }
  };
  setSimSettings(merged);
  return merged;
}

export function sanitizeSimSettings(raw: unknown): SimSettings {
  const merged = {
    ...DEFAULT_SIM_SETTINGS,
    ...(typeof raw === 'object' && raw ? (raw as Partial<SimSettings>) : {}),
    career: {
      ...DEFAULT_SIM_SETTINGS.career,
      ...(typeof raw === 'object' && raw && 'career' in (raw as object)
        ? ((raw as Partial<SimSettings>).career ?? {})
        : {})
    },
    training: {
      ...DEFAULT_SIM_SETTINGS.training,
      ...(typeof raw === 'object' && raw && 'training' in (raw as object)
        ? ((raw as Partial<SimSettings>).training ?? {})
        : {})
    },
    performance: {
      ...DEFAULT_SIM_SETTINGS.performance,
      ...(typeof raw === 'object' && raw && 'performance' in (raw as object)
        ? ((raw as Partial<SimSettings>).performance ?? {})
        : {})
    }
  } satisfies SimSettings;

  return {
    career: {
      startingElo: Number(merged.career.startingElo)
    },
    training: {
      baseMeanGain: Number(merged.training.baseMeanGain),
      decayPerTraining: Number(merged.training.decayPerTraining),
      randomStdDevRatio: Number(merged.training.randomStdDevRatio),
      minGain: Number(merged.training.minGain),
      maxGain: Number(merged.training.maxGain),
      crossGainRatio: Number(merged.training.crossGainRatio),
      baseCreditsPerMonth: Number(merged.training.baseCreditsPerMonth),
      studySkillCreditStep: Number(merged.training.studySkillCreditStep),
      baseStudySkillElo: Number(merged.training.baseStudySkillElo),
      maxCreditsPerMonth: Number(merged.training.maxCreditsPerMonth),
      fatigueRecoveryPerUnusedCredit: Number(merged.training.fatigueRecoveryPerUnusedCredit),
      coachingBaseCost: Number(merged.training.coachingBaseCost),
      coachingCostStep: Number(merged.training.coachingCostStep),
      workBaseIncome: Number(merged.training.workBaseIncome),
      workIncomeStep: Number(merged.training.workIncomeStep),
      puzzleAttemptStudyStep: Number(merged.training.puzzleAttemptStudyStep),
      puzzleLambdaBase: Number(merged.training.puzzleLambdaBase),
      puzzleLambdaStep: Number(merged.training.puzzleLambdaStep),
      puzzleLambdaStartElo: Number(merged.training.puzzleLambdaStartElo),
      puzzleLambdaBucketSize: Number(merged.training.puzzleLambdaBucketSize)
    },
    performance: {
      maxEffectiveElo: Number(merged.performance.maxEffectiveElo),
      minEffectiveElo: Number(merged.performance.minEffectiveElo),
      drawBiasBase: Number(merged.performance.drawBiasBase),
      fatigueBlunderBoostAtMax: Number(merged.performance.fatigueBlunderBoostAtMax),
      openingMaxMove: Number(merged.performance.openingMaxMove),
      middlegameMaxMove: Number(merged.performance.middlegameMaxMove),
      middlegameMinSideMaterialPoints: Number(merged.performance.middlegameMinSideMaterialPoints),
      competitivenessBoostFactor: Number(merged.performance.competitivenessBoostFactor),
      competitivenessDeficitPoints: Number(merged.performance.competitivenessDeficitPoints),
      sub1350DecisionSpread: Number(merged.performance.sub1350DecisionSpread),
      stockfishDrawStartMove: Number(merged.performance.stockfishDrawStartMove),
      stockfishDrawBaseChance: Number(merged.performance.stockfishDrawBaseChance),
      stockfishDrawIncrementPerMove: Number(merged.performance.stockfishDrawIncrementPerMove),
      stockfishDrawBalancedThresholdPoints: Number(merged.performance.stockfishDrawBalancedThresholdPoints)
    }
  };
}
