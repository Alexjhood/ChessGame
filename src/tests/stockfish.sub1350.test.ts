import { describe, expect, it } from 'vitest';
import { DEFAULT_SIM_SETTINGS, setSimSettings } from '../sim/settings';
import { buildSub1350MoveMix } from '../engine/stockfish';

describe('sub-1350 move mix', () => {
  it('increases 2nd/3rd/4th probabilities as target Elo drops below 1350', () => {
    setSimSettings(structuredClone(DEFAULT_SIM_SETTINGS));
    const at1400 = buildSub1350MoveMix(1400, 0.02, 0.01);
    const at1200 = buildSub1350MoveMix(1200, 0.02, 0.01);
    const at800 = buildSub1350MoveMix(800, 0.02, 0.01);

    expect(at1400.second).toBeCloseTo(0.02, 6);
    expect(at1400.third).toBeCloseTo(0.01, 6);
    expect(at1400.fourth).toBeCloseTo(0, 6);

    expect(at1200.second).toBeGreaterThan(at1400.second);
    expect(at1200.third).toBeGreaterThan(at1400.third);
    expect(at1200.fourth).toBeGreaterThan(at1400.fourth);

    expect(at800.second).toBeGreaterThan(at1200.second);
    expect(at800.third).toBeGreaterThan(at1200.third);
    expect(at800.fourth).toBeGreaterThan(at1200.fourth);
  });
});

