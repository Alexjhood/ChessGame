/*
 * File Purpose: Monthly tournament availability selection.
 * Key Mechanics: Builds rotating event sets per month/seed so each month offers fresh tournament choices.
 */

import type { TournamentTemplate } from './models';
import { createRng } from './rng';

const ELITE_REAL_EVENT_NAMES = [
  'Tata Steel Masters',
  'Norway Chess',
  'Sinquefield Cup',
  'Superbet Chess Classic',
  'FIDE Grand Swiss',
  'WR Masters Cup',
  'Qatar Masters Open',
  'Biel Grandmaster Festival'
];

export const WORLD_CHAMPIONSHIP_TEMPLATE: TournamentTemplate = {
  id: 'world_championship_match',
  name: 'World Championship Match',
  tier: 'World Championship',
  format: 'round_robin',
  fieldSize: 2,
  rounds: 12,
  avgOpponentRating: 2750,
  ratingStdDev: 35,
  entryFee: 0,
  travelFatigue: 18,
  prizePool: 25000,
  payoutScale: { first: 1, second: 0, third: 0, top8: 0 },
  minEloReq: 2600,
  reputationReq: 80
};

function shuffle<T>(items: T[], seed: number): T[] {
  const rng = createRng(seed);
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

export function monthlyTournamentPool(
  templates: TournamentTemplate[],
  month: number,
  seed: number,
  count = 6,
  playerElo = 0
): TournamentTemplate[] {
  if (templates.length === 0) return [];
  const size = Math.min(count, templates.length);
  const order = shuffle(templates, seed * 31 + 17);
  const start = ((Math.max(1, month) - 1) * size) % order.length;
  const out: TournamentTemplate[] = [];
  for (let i = 0; i < size; i += 1) {
    const item = structuredClone(order[(start + i) % order.length]!);
    if (playerElo >= 2000 && item.avgOpponentRating >= 2000) {
      const nameIdx = (month + i) % ELITE_REAL_EVENT_NAMES.length;
      item.name = ELITE_REAL_EVENT_NAMES[nameIdx] ?? item.name;
      item.tier = 'Elite Real Event';
    }
    out.push(item);
  }
  if (playerElo >= 2600) {
    const alreadyIncluded = out.some((t) => t.id === WORLD_CHAMPIONSHIP_TEMPLATE.id);
    if (!alreadyIncluded) {
      if (out.length >= count && out.length > 0) {
        out[out.length - 1] = structuredClone(WORLD_CHAMPIONSHIP_TEMPLATE);
      } else {
        out.push(structuredClone(WORLD_CHAMPIONSHIP_TEMPLATE));
      }
    }
  }
  return out;
}
