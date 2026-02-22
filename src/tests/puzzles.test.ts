import { describe, expect, it } from 'vitest';
import { puzzleLambdaForElo } from '../sim/weekly';

describe('puzzle reward lambda', () => {
  it('scales by puzzle Elo buckets', () => {
    expect(puzzleLambdaForElo(700)).toBe(1);
    expect(puzzleLambdaForElo(800)).toBe(2);
    expect(puzzleLambdaForElo(950)).toBe(2);
    expect(puzzleLambdaForElo(1001)).toBe(3);
    expect(puzzleLambdaForElo(1250)).toBe(4);
  });
});

