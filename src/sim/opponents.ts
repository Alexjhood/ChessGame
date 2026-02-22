import type { Opponent, SkillRatings, StyleTag } from './models';
import { clamp, createRng } from './rng';

const firstNames = ['Mina', 'Leo', 'Ari', 'Sofia', 'Kai', 'Noah', 'Rin', 'Ivy', 'Zane', 'Milo'];
const lastNames = ['Park', 'Ibrahim', 'Mori', 'Singh', 'Bauer', 'Khan', 'Costa', 'Lee', 'Davis', 'Ivanov'];
const styles: StyleTag[] = ['Solid', 'Tactical', 'Aggressive', 'Endgame'];

function styleSkew(base: number, style: StyleTag): SkillRatings {
  const map: Record<StyleTag, Partial<SkillRatings>> = {
    Solid: { openingElo: 22, middlegameElo: 8, endgameElo: 14, resilience: 14, competitiveness: -12, studySkills: -10 },
    Tactical: { openingElo: -10, middlegameElo: 28, endgameElo: -6, resilience: -10, competitiveness: 24, studySkills: -6 },
    Aggressive: { openingElo: 8, middlegameElo: 30, endgameElo: -14, resilience: -8, competitiveness: 24, studySkills: -6 },
    Endgame: { openingElo: -14, middlegameElo: -4, endgameElo: 38, resilience: 16, competitiveness: -8, studySkills: -8 }
  };

  const baseSkills: SkillRatings = {
    openingElo: base,
    middlegameElo: base,
    endgameElo: base,
    resilience: base,
    competitiveness: base,
    studySkills: base
  };

  Object.entries(map[style]).forEach(([key, delta]) => {
    const typedKey = key as keyof SkillRatings;
    baseSkills[typedKey] = clamp(baseSkills[typedKey] + (delta ?? 0), 600, 2500);
  });

  return baseSkills;
}

function withCenteredVariance(baseRating: number, skills: SkillRatings, seed: number): SkillRatings {
  const rng = createRng(seed);
  const keys: Array<keyof SkillRatings> = [
    'openingElo',
    'middlegameElo',
    'endgameElo',
    'resilience',
    'competitiveness',
    'studySkills'
  ];

  const out: SkillRatings = structuredClone(skills);
  keys.forEach((key) => {
    out[key] = clamp(out[key] + Math.round(rng.normal(0, 22)), 600, 2500);
  });

  const avg = keys.reduce((acc, key) => acc + out[key], 0) / keys.length;
  const shift = Math.round(baseRating - avg);
  keys.forEach((key) => {
    out[key] = clamp(out[key] + shift, 600, 2500);
  });
  return out;
}

export function generateOpponents(seed: number, count: number, avgRating: number, stdDev: number): Opponent[] {
  const rng = createRng(seed);

  return Array.from({ length: count }, (_, idx) => {
    const rating = Math.round(clamp(rng.normal(avgRating, stdDev), 700, 2400));
    const style = styles[rng.int(0, styles.length - 1)]!;
    return {
      id: `opp_${seed}_${idx}`,
      name: `${rng.pick(firstNames)} ${rng.pick(lastNames)}`,
      publicRating: rating,
      style,
      skills: withCenteredVariance(rating, styleSkew(rating, style), seed + idx * 101)
    };
  });
}
