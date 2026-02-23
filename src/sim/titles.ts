/*
 * File Purpose: Title ladder and progression thresholds.
 * Key Mechanics: Encodes FIDE-aligned rating/norm requirements, resolves active title by gender path, and provides tooltip metadata.
 */

import type { AvatarGender } from './avatar';
import type { Title } from './models';

export type NormTitle = 'E' | 'D' | 'C' | 'B' | 'A' | 'EXPERT' | 'CM' | 'FM' | 'IM' | 'GM' | 'WIM' | 'WGM';

export interface NormProgress {
  E: number;
  D: number;
  C: number;
  B: number;
  A: number;
  EXPERT: number;
  CM: number;
  FM: number;
  GM: number;
  IM: number;
  WIM: number;
  WGM: number;
}

export interface TitleLevel {
  key: Title;
  minRating: number;
  color: string;
  requiredNormTitle?: NormTitle;
  requiredNorms?: number;
}

export interface NormCheckInput {
  games: number;
  score: number;
  averageOpponentRating: number;
  performanceRating: number;
}

export interface NormRule {
  minPerformance: number;
  minAverageOpponent: number;
  minGames: number;
  minScoreRatio: number;
}

const REQUIRED_NORMS = 3;

export const NORM_RULES: Record<NormTitle, NormRule> = {
  E: { minPerformance: 1120, minAverageOpponent: 900, minGames: 5, minScoreRatio: 0.4 },
  D: { minPerformance: 1320, minAverageOpponent: 1080, minGames: 5, minScoreRatio: 0.42 },
  C: { minPerformance: 1520, minAverageOpponent: 1250, minGames: 6, minScoreRatio: 0.42 },
  B: { minPerformance: 1720, minAverageOpponent: 1450, minGames: 6, minScoreRatio: 0.43 },
  A: { minPerformance: 1920, minAverageOpponent: 1650, minGames: 7, minScoreRatio: 0.43 },
  EXPERT: { minPerformance: 2120, minAverageOpponent: 1820, minGames: 7, minScoreRatio: 0.44 },
  CM: { minPerformance: 2320, minAverageOpponent: 2050, minGames: 7, minScoreRatio: 0.45 },
  FM: { minPerformance: 2420, minAverageOpponent: 2150, minGames: 8, minScoreRatio: 0.45 },
  GM: { minPerformance: 2600, minAverageOpponent: 2380, minGames: 9, minScoreRatio: 0.35 },
  IM: { minPerformance: 2450, minAverageOpponent: 2230, minGames: 9, minScoreRatio: 0.35 },
  WGM: { minPerformance: 2400, minAverageOpponent: 2180, minGames: 9, minScoreRatio: 0.35 },
  WIM: { minPerformance: 2250, minAverageOpponent: 2030, minGames: 9, minScoreRatio: 0.35 }
};

export const MALE_TITLE_LEVELS: TitleLevel[] = [
  { key: 'None', minRating: 0, color: '#b8b0a2' },
  { key: 'CM', minRating: 2200, color: '#4f9edd', requiredNormTitle: 'CM', requiredNorms: 2 },
  { key: 'FM', minRating: 2300, color: '#3da77b', requiredNormTitle: 'FM', requiredNorms: 2 },
  { key: 'IM', minRating: 2400, color: '#9b62db', requiredNormTitle: 'IM', requiredNorms: REQUIRED_NORMS },
  { key: 'GM', minRating: 2500, color: '#d24b7b', requiredNormTitle: 'GM', requiredNorms: REQUIRED_NORMS },
  { key: 'WC', minRating: 2700, color: '#f18c2e' }
];

export const FEMALE_TITLE_LEVELS: TitleLevel[] = [
  { key: 'None', minRating: 0, color: '#b8b0a2' },
  { key: 'WCM', minRating: 2000, color: '#57a8dd', requiredNormTitle: 'CM', requiredNorms: 1 },
  { key: 'WFM', minRating: 2100, color: '#4abf8d', requiredNormTitle: 'FM', requiredNorms: 1 },
  { key: 'WIM', minRating: 2200, color: '#a86fe3', requiredNormTitle: 'WIM', requiredNorms: REQUIRED_NORMS },
  { key: 'WGM', minRating: 2300, color: '#e06195', requiredNormTitle: 'WGM', requiredNorms: REQUIRED_NORMS },
  { key: 'WC', minRating: 2700, color: '#f18c2e' }
];

export interface EloScaleLevel {
  id: string;
  minRating: number;
  maxRating: number | null;
  label: string;
  color: string;
  normKey?: NormTitle;
  normCount?: number;
}

export const ELO_SCALE_LEVELS: EloScaleLevel[] = [
  { id: 'novice', minRating: 0, maxRating: 999, label: 'Novice', color: '#b8b0a2' },
  { id: 'class_e', minRating: 1000, maxRating: 1199, label: 'Class E', color: '#90a7d6', normKey: 'E', normCount: 1 },
  { id: 'class_d', minRating: 1200, maxRating: 1399, label: 'Class D', color: '#80b9dd', normKey: 'D', normCount: 1 },
  { id: 'class_c', minRating: 1400, maxRating: 1599, label: 'Class C', color: '#78c3bf', normKey: 'C', normCount: 2 },
  { id: 'class_b', minRating: 1600, maxRating: 1799, label: 'Class B', color: '#76c182', normKey: 'B', normCount: 2 },
  { id: 'class_a', minRating: 1800, maxRating: 1999, label: 'Class A', color: '#9fbf6f', normKey: 'A', normCount: 2 },
  { id: 'expert', minRating: 2000, maxRating: 2199, label: 'Expert', color: '#d6ba62', normKey: 'EXPERT', normCount: 2 },
  { id: 'cm', minRating: 2200, maxRating: 2299, label: 'Candidate Master', color: '#4f9edd', normKey: 'CM', normCount: 2 },
  { id: 'fm', minRating: 2300, maxRating: 2399, label: 'FIDE Master', color: '#3da77b', normKey: 'FM', normCount: 2 },
  { id: 'im', minRating: 2400, maxRating: 2499, label: 'International Master', color: '#9b62db', normKey: 'IM', normCount: 3 },
  { id: 'gm', minRating: 2500, maxRating: 2599, label: 'Grandmaster', color: '#d24b7b', normKey: 'GM', normCount: 3 },
  { id: 'super_gm', minRating: 2600, maxRating: null, label: 'Super Grandmaster', color: '#f18c2e' }
];

// Backward-compatible default ladder used by legacy UI flows.
export const TITLE_LEVELS: TitleLevel[] = MALE_TITLE_LEVELS;

export function emptyNormProgress(): NormProgress {
  return { E: 0, D: 0, C: 0, B: 0, A: 0, EXPERT: 0, CM: 0, FM: 0, GM: 0, IM: 0, WIM: 0, WGM: 0 };
}

export function normalizeNormProgress(raw?: Partial<NormProgress> | null): NormProgress {
  return {
    E: Math.max(0, Math.floor(raw?.E ?? 0)),
    D: Math.max(0, Math.floor(raw?.D ?? 0)),
    C: Math.max(0, Math.floor(raw?.C ?? 0)),
    B: Math.max(0, Math.floor(raw?.B ?? 0)),
    A: Math.max(0, Math.floor(raw?.A ?? 0)),
    EXPERT: Math.max(0, Math.floor(raw?.EXPERT ?? 0)),
    CM: Math.max(0, Math.floor(raw?.CM ?? 0)),
    FM: Math.max(0, Math.floor(raw?.FM ?? 0)),
    GM: Math.max(0, Math.floor(raw?.GM ?? 0)),
    IM: Math.max(0, Math.floor(raw?.IM ?? 0)),
    WIM: Math.max(0, Math.floor(raw?.WIM ?? 0)),
    WGM: Math.max(0, Math.floor(raw?.WGM ?? 0))
  };
}

export function titleLevelsForGender(gender: AvatarGender): TitleLevel[] {
  return gender === 'female' ? FEMALE_TITLE_LEVELS : MALE_TITLE_LEVELS;
}

export function qualifyingNormsForTournament(input: NormCheckInput): NormTitle[] {
  if (input.games <= 0) return [];
  const out: NormTitle[] = [];
  (Object.keys(NORM_RULES) as NormTitle[]).forEach((normTitle) => {
    const rule = NORM_RULES[normTitle];
    if (
      input.games >= rule.minGames &&
      input.score / input.games >= rule.minScoreRatio &&
      input.performanceRating >= rule.minPerformance &&
      input.averageOpponentRating >= rule.minAverageOpponent
    ) {
      out.push(normTitle);
    }
  });
  return out;
}

export function titleFromProgress(params: {
  rating: number;
  gender: AvatarGender;
  norms: NormProgress;
  ratedGamesPlayed: number;
  worldChampionAchieved?: boolean;
}): Title {
  if (params.worldChampionAchieved || params.rating >= 2700) return 'WC';
  const levels = titleLevelsForGender(params.gender);
  let best: Title = 'None';
  for (const level of levels) {
    if (level.key === 'None' || level.key === 'WC') continue;
    if (params.rating < level.minRating) continue;
    if (level.requiredNormTitle && (params.norms[level.requiredNormTitle] ?? 0) < (level.requiredNorms ?? REQUIRED_NORMS)) {
      continue;
    }
    best = level.key;
  }
  return best;
}

export function titleFromRating(rating: number): Title {
  const sorted = [...TITLE_LEVELS].sort((a, b) => b.minRating - a.minRating);
  return sorted.find((lvl) => rating >= lvl.minRating)?.key ?? 'None';
}

export function titleRequirementText(params: {
  level: TitleLevel;
  gender: AvatarGender;
  norms: NormProgress;
  ratedGamesPlayed: number;
}): string {
  if (params.level.key === 'None') return 'No title requirements.';
  if (params.level.key === 'WC') return 'Game-end title: rating 2700+ or win the World Championship match.';
  if (!params.level.requiredNormTitle) return `Requires rating ≥ ${params.level.minRating}.`;
  const rule = NORM_RULES[params.level.requiredNormTitle];
  const have = params.norms[params.level.requiredNormTitle] ?? 0;
  return `Requires rating ≥ ${params.level.minRating} and ${params.level.requiredNorms ?? REQUIRED_NORMS} ${params.level.requiredNormTitle} norms (you have ${have}). Norm event checks: ≥${rule.minGames} games, score ≥${Math.round(rule.minScoreRatio * 100)}%, performance ≥${rule.minPerformance}, and avg opponent rating ≥${rule.minAverageOpponent}.`;
}

export function eloScaleRequirementText(level: EloScaleLevel, norms: NormProgress): string {
  const range = level.maxRating === null ? `${level.minRating}+` : `${level.minRating}-${level.maxRating}`;
  if (!level.normKey || !level.normCount) return `Rating band ${range}. No norm gate for this level.`;
  const have = norms[level.normKey] ?? 0;
  const rule = NORM_RULES[level.normKey];
  return `Rating band ${range}. Requires ${level.normCount} ${level.normKey} norm(s): you have ${have}. Norm check per tournament: ≥${rule.minGames} games, score ≥${Math.round(rule.minScoreRatio * 100)}%, performance ≥${rule.minPerformance}, avg opponent ≥${rule.minAverageOpponent}.`;
}
