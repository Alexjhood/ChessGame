import type { Title } from './models';

export interface TitleLevel {
  key: Title;
  minRating: number;
  color: string;
}

export const TITLE_LEVELS: TitleLevel[] = [
  { key: 'None', minRating: 0, color: '#b8b0a2' },
  { key: 'CM', minRating: 1800, color: '#4f9edd' },
  { key: 'FM', minRating: 2000, color: '#3da77b' },
  { key: 'IM', minRating: 2200, color: '#9b62db' },
  { key: 'GM', minRating: 2400, color: '#d24b7b' },
  { key: 'WC', minRating: 2700, color: '#f18c2e' }
];

export function titleFromRating(rating: number): Title {
  const sorted = [...TITLE_LEVELS].sort((a, b) => b.minRating - a.minRating);
  return sorted.find((lvl) => rating >= lvl.minRating)?.key ?? 'None';
}
