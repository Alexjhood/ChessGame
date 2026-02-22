/*
 * File Purpose: Move-choice policy from skill, fatigue, and confidence.
 * Key Mechanics: Transforms player attributes into best/inaccuracy/blunder probabilities used when selecting engine lines.
 */

import type { SkillRatings } from '../sim/models';
import { detectPhase, type Phase } from '../chess/phases';
import { clamp, lerp } from '../sim/rng';
import { getSimSettings } from '../sim/settings';

export interface MovePolicy {
  movetimeMs: number;
  multiPV: number;
  temperature: number;
  pInaccuracy: number;
  pBlunder: number;
  pBook: number;
  phase: Phase;
  phaseElo: number;
  effectiveElo: number;
}

const phaseSkillKey: Record<Phase, keyof SkillRatings> = {
  opening: 'openingElo',
  middlegame: 'middlegameElo',
  endgame: 'endgameElo'
};

function normalize(elo: number): number {
  return clamp((elo - 800) / (2200 - 800), 0, 1);
}

export function buildMovePolicy(
  fen: string,
  skills: SkillRatings,
  fatigue: number,
  confidence: number,
  materialDeficit = 0
): MovePolicy {
  const settings = getSimSettings();
  const phase = detectPhase(fen);
  const phaseElo = skills[phaseSkillKey[phase]];

  const compBoost =
    materialDeficit > settings.performance.competitivenessDeficitPoints
      ? settings.performance.competitivenessBoostFactor * skills.competitiveness
      : 0;

  const s = normalize(phaseElo + compBoost);
  const resilienceNorm = normalize(skills.resilience);
  const fatiguePenalty = clamp((fatigue / 120) * (1 - resilienceNorm * 0.45), 0, 0.55);
  const confidenceBuff = clamp(confidence / 60, -0.25, 0.25);
  const adjusted = clamp(s - fatiguePenalty + confidenceBuff, 0, 1);

  const baseBlunder = lerp(0.02, 0.0005, adjusted);
  const baseInacc = lerp(0.06, 0.006, adjusted);
  const fatigueDirectBoost =
    clamp(fatigue / 100, 0, 1) * settings.performance.fatigueBlunderBoostAtMax * (1 - resilienceNorm * 0.5);

  return {
    movetimeMs: Math.round(lerp(42, phase === 'endgame' ? 300 : 240, adjusted)),
    multiPV: Math.round(lerp(1, 3, adjusted)),
    temperature: lerp(0.42, 0.06, adjusted),
    pInaccuracy: clamp(baseInacc, 0.0015, 0.08),
    pBlunder: clamp(baseBlunder + fatigueDirectBoost, 0.0001, 0.04),
    pBook: clamp(0.48 + normalize(skills.openingElo) * 0.46, 0.48, 0.98),
    phase,
    phaseElo,
    effectiveElo: Math.round(800 + adjusted * (2200 - 800))
  };
}
