/*
 * File Purpose: Deterministic random number utilities.
 * Key Mechanics: Provides seeded random helpers for reproducible tournament, training, and reward sampling.
 */

export interface Rng {
  next: () => number;
  int: (min: number, max: number) => number;
  pick: <T>(items: T[]) => T;
  normal: (mean?: number, stdDev?: number) => number;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };

  const int = (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min;

  const pick = <T>(items: T[]): T => {
    if (items.length === 0) {
      throw new Error('Cannot pick from empty array');
    }
    return items[int(0, items.length - 1)]!;
  };

  const normal = (mean = 0, stdDev = 1) => {
    const u1 = Math.max(next(), 1e-8);
    const u2 = Math.max(next(), 1e-8);
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return mean + z0 * stdDev;
  };

  return { next, int, pick, normal };
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
