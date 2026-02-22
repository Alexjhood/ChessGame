import type { GameState, SkillRatings, TrainingModule } from './models';
import { clamp, createRng } from './rng';
import { getSimSettings } from './settings';
import { titleFromRating } from './titles';
import { DEFAULT_AVATAR, type AvatarProfile } from './avatar';

const MAX_INBOX_MONTHS = 3;

const skillKeys = [
  'openingElo',
  'middlegameElo',
  'endgameElo',
  'resilience',
  'competitiveness',
  'studySkills'
] as const satisfies (keyof SkillRatings)[];

function clampSkillValue(skill: keyof SkillRatings, value: number): number {
  if (skill === 'studySkills') return clamp(value, 0, 2600);
  return clamp(value, 600, 2600);
}

export function trainingMeanGain(previousTrainings: number): number {
  const settings = getSimSettings();
  return settings.training.baseMeanGain * settings.training.decayPerTraining ** previousTrainings;
}

export function trainingCreditsForState(state: GameState): number {
  const settings = getSimSettings();
  return Math.min(settings.training.maxCreditsPerMonth, settings.training.baseCreditsPerMonth);
}

export function puzzleAttemptsForState(state: GameState): number {
  const settings = getSimSettings();
  const step = Math.max(1, settings.training.puzzleAttemptStudyStep);
  return 1 + Math.floor(Math.max(0, state.skills.studySkills) / step);
}

export function puzzleLambdaForElo(elo: number): number {
  const settings = getSimSettings();
  const base = Math.max(0, settings.training.puzzleLambdaBase);
  const step = Math.max(0, settings.training.puzzleLambdaStep);
  const start = settings.training.puzzleLambdaStartElo;
  const bucket = Math.max(1, settings.training.puzzleLambdaBucketSize);
  if (elo < 700) return 0.5;
  if (elo < start) return base;
  const tiersAbove = Math.floor((elo - start) / bucket) + 1;
  return base + tiersAbove * step;
}

export function samplePoisson(lambda: number, seed: number): number {
  if (lambda <= 0) return 0;
  const rng = createRng(seed);
  const L = Math.exp(-lambda);
  let p = 1;
  let k = 0;
  do {
    k += 1;
    p *= rng.next();
  } while (p > L);
  return Math.max(0, k - 1);
}

export function coachingCostForPurchaseIndex(purchaseIndex: number): number {
  const settings = getSimSettings();
  return settings.training.coachingBaseCost + settings.training.coachingCostStep * purchaseIndex;
}

export function coachingCostForBatch(priorPurchases: number, count: number): number {
  let total = 0;
  for (let i = 0; i < count; i += 1) total += coachingCostForPurchaseIndex(priorPurchases + i);
  return total;
}

export function maxAffordableCoachingPurchases(money: number, priorPurchases: number, requested: number): number {
  let spent = 0;
  let affordable = 0;
  for (let i = 0; i < requested; i += 1) {
    const cost = coachingCostForPurchaseIndex(priorPurchases + i);
    if (spent + cost > money) break;
    spent += cost;
    affordable += 1;
  }
  return affordable;
}

function applySingleTraining(next: GameState, module: TrainingModule, order: number): number {
  const settings = getSimSettings();
  const focus = module.focusSkill;
  const focusCount = next.trainingCounts[focus] ?? 0;
  const mean = trainingMeanGain(focusCount);
  const rng = createRng(next.meta.seed + next.week * 977 + focusCount * 389 + order * 73);
  const sampled = Math.round(rng.normal(mean, Math.max(2, mean * settings.training.randomStdDevRatio)));
  const focusGain = clamp(sampled, settings.training.minGain, settings.training.maxGain);

  next.skills[focus] = clampSkillValue(focus, next.skills[focus] + focusGain);
  next.trainingCounts[focus] = focusCount + 1;
  next.confidence = clamp(next.confidence + 1, -20, 20);

  skillKeys.forEach((key) => {
    if (key === focus) return;
    const hinted = module.effects[key] ?? 0;
    const crossGain = hinted > 0 ? Math.max(1, Math.round(hinted * settings.training.crossGainRatio)) : 0;
    next.skills[key] = clampSkillValue(key, next.skills[key] + crossGain);
  });

  return focusGain;
}

export function applyTrainingMonth(
  state: GameState,
  modules: TrainingModule[],
  requestedCoachingPurchases = 0,
  puzzleCreditsEarned = 0
): GameState {
  const settings = getSimSettings();
  const next = structuredClone(state);
  const beforeSkills = structuredClone(state.skills);
  const coachingPurchases = maxAffordableCoachingPurchases(state.money, state.coachingPurchases, requestedCoachingPurchases);
  const coachingCost = coachingCostForBatch(state.coachingPurchases, coachingPurchases);
  next.money = Math.max(0, next.money - coachingCost);
  next.coachingPurchases += coachingPurchases;

  const credits = trainingCreditsForState(state) + coachingPurchases + Math.max(0, puzzleCreditsEarned);
  const cappedModules = modules.slice(0, credits);

  const applied: string[] = [];
  cappedModules.forEach((module, idx) => {
    const gain = applySingleTraining(next, module, idx);
    applied.push(`${module.label} (+${gain} ${module.focusSkill})`);
  });

  const unusedCredits = Math.max(0, credits - applied.length);
  const fatigueRecovery = unusedCredits * settings.training.fatigueRecoveryPerUnusedCredit;
  if (fatigueRecovery > 0) next.fatigue = clamp(next.fatigue - fatigueRecovery, 0, 100);

  next.week += 1;
  next.ageYears = Number((next.ageYears + 1 / 12).toFixed(2));
  next.title = titleFromRating(next.publicRating);
  next.meta.lastPlayedAt = new Date().toISOString();
  next.recentSkillDeltas = {
    openingElo: next.skills.openingElo - beforeSkills.openingElo,
    middlegameElo: next.skills.middlegameElo - beforeSkills.middlegameElo,
    endgameElo: next.skills.endgameElo - beforeSkills.endgameElo,
    resilience: next.skills.resilience - beforeSkills.resilience,
    competitiveness: next.skills.competitiveness - beforeSkills.competitiveness,
    studySkills: next.skills.studySkills - beforeSkills.studySkills
  };

  if (applied.length === 0) {
    next.inbox.unshift(
      `Month ${next.week}: Training plan executed. Puzzle credits: ${puzzleCreditsEarned}. Coaching bought: ${coachingPurchases} ($${coachingCost}). Recovered ${fatigueRecovery} fatigue from ${unusedCredits} unused credits.`
    );
  } else {
    next.inbox.unshift(
      `Month ${next.week}: Training complete (${applied.join(', ')}). Puzzle credits: ${puzzleCreditsEarned}. Coaching bought: ${coachingPurchases} ($${coachingCost}). Recovered ${fatigueRecovery} fatigue from ${unusedCredits} unused credits.`
    );
  }
  next.inbox = next.inbox.slice(0, MAX_INBOX_MONTHS);
  return next;
}

export function applyTrainingWeek(state: GameState, module: TrainingModule): GameState {
  return applyTrainingMonth(state, [module], 0);
}

export function createInitialState(seed = Date.now(), avatar: AvatarProfile = DEFAULT_AVATAR): GameState {
  const base = Math.round(clamp(getSimSettings().career.startingElo, 600, 2600));
  const now = new Date().toISOString();
  return {
    meta: { version: '1.0.0', seed, createdAt: now, lastPlayedAt: now },
    week: 1,
    ageYears: 8,
    publicRating: base,
    title: 'None',
    money: 250,
    reputation: 0,
    fatigue: 0,
    confidence: 0,
    coachingPurchases: 0,
    avatar,
    skills: {
      openingElo: base,
      middlegameElo: base,
      endgameElo: base,
      resilience: base,
      competitiveness: base,
      studySkills: 0
    },
    recentSkillDeltas: {
      openingElo: 0,
      middlegameElo: 0,
      endgameElo: 0,
      resilience: 0,
      competitiveness: 0,
      studySkills: 0
    },
    trainingCounts: {
      openingElo: 0,
      middlegameElo: 0,
      endgameElo: 0,
      resilience: 0,
      competitiveness: 0,
      studySkills: 0
    },
    inventory: { tools: [], coaches: [] },
    history: { tournaments: [], games: [], sponsors: [] },
    inbox: ['Welcome to your first month as a chess prodigy manager.']
  };
}
