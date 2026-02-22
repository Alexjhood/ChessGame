/*
 * File Purpose: Stockfish draw-trigger tests.
 * Key Mechanics: Checks configurable late-move draw probability conditions and trigger bounds.
 */

import { describe, expect, it } from 'vitest';
import { setSimSettings, DEFAULT_SIM_SETTINGS } from '../sim/settings';
import { canTriggerStockfishBalanceDraw, stockfishDrawChanceAtFullMove } from '../sim/stockfishDraw';

describe('stockfish draw mechanic settings', () => {
  it('starts after configured move and scales per move', () => {
    setSimSettings(structuredClone(DEFAULT_SIM_SETTINGS));
    expect(stockfishDrawChanceAtFullMove(40)).toBe(0);
    expect(stockfishDrawChanceAtFullMove(41)).toBeCloseTo(0.011, 6);
    expect(stockfishDrawChanceAtFullMove(50)).toBeCloseTo(0.02, 6);
  });

  it('only allows draw trigger when eval is within configured balance threshold', () => {
    setSimSettings(structuredClone(DEFAULT_SIM_SETTINGS));
    expect(canTriggerStockfishBalanceDraw(150)).toBe(true);
    expect(canTriggerStockfishBalanceDraw(-150)).toBe(true);
    expect(canTriggerStockfishBalanceDraw(151)).toBe(false);
    expect(canTriggerStockfishBalanceDraw(-151)).toBe(false);
  });
});

