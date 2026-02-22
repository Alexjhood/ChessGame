import type { TournamentTemplate } from './models';
import { createRng } from './rng';

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
  count = 6
): TournamentTemplate[] {
  if (templates.length === 0) return [];
  const size = Math.min(count, templates.length);
  const order = shuffle(templates, seed * 31 + 17);
  const start = ((Math.max(1, month) - 1) * size) % order.length;
  const out: TournamentTemplate[] = [];
  for (let i = 0; i < size; i += 1) {
    out.push(order[(start + i) % order.length]!);
  }
  return out;
}
