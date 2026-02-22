import type { SkillRatings } from '../sim/models';
import { clamp, createRng } from '../sim/rng';
import { buildMovePolicy } from './policy';
import { analyzePosition, initEngine, terminateEngine, type EngineHandle, type MoveChoice } from './stockfishWorker';
import { loadOpeningBook, pickBookMove } from './openingBook';
import { getSimSettings } from '../sim/settings';

export interface MoveTelemetry {
  phase: 'opening' | 'middlegame' | 'endgame';
  phaseElo: number;
  effectiveElo: number;
  targetUciElo: number;
  movetimeMs: number;
  multiPV: number;
  temperature: number;
  pInaccuracy: number;
  pBlunder: number;
}

export interface ChosenMove extends MoveChoice {
  telemetry: MoveTelemetry;
}

interface Sub1350MoveMix {
  second: number;
  third: number;
  fourth: number;
}

export function buildSub1350MoveMix(targetUciElo: number, baseInaccuracy: number, baseBlunder: number): Sub1350MoveMix {
  const spread = Math.max(0, getSimSettings().performance.sub1350DecisionSpread);
  const under = clamp((1350 - targetUciElo) / (1350 - 600), 0, 1) * spread;
  const second = clamp(baseInaccuracy + 0.24 * under, 0, 0.7);
  const third = clamp(baseBlunder + 0.14 * under, 0, 0.45);
  const fourth = clamp(0.1 * under, 0, 0.25);
  const total = second + third + fourth;
  if (total <= 0.95) return { second, third, fourth };
  const scale = 0.95 / total;
  return {
    second: second * scale,
    third: third * scale,
    fourth: fourth * scale
  };
}

export async function chooseMove(
  handle: EngineHandle | null,
  fen: string,
  context: {
    skills: SkillRatings;
    officialElo?: number;
    fatigue: number;
    confidence: number;
    materialDeficitPoints?: number;
    playedMoves?: string[];
    seed?: number;
    thinkTimeScale?: number;
  }
): Promise<ChosenMove> {
  const policy = buildMovePolicy(
    fen,
    context.skills,
    context.fatigue,
    context.confidence,
    context.materialDeficitPoints ?? 0
  );

  const rng = createRng(context.seed ?? Date.now());

  const telemetry: MoveTelemetry = {
    phase: policy.phase,
    phaseElo: policy.phaseElo,
    effectiveElo: policy.effectiveElo,
    targetUciElo: 0,
    movetimeMs: policy.movetimeMs,
    multiPV: policy.multiPV,
    temperature: policy.temperature,
    pInaccuracy: policy.pInaccuracy,
    pBlunder: policy.pBlunder
  };

  try {
    const book = await loadOpeningBook();
    const prepProxy = clamp((context.skills.openingElo - 800) / 1400, 0, 1);
    const bookMove = pickBookMove(book, context.playedMoves ?? [], prepProxy);
    if (bookMove && rng.next() < policy.pBook) {
      return { uci: bookMove, cp: 15, reason: 'best', telemetry };
    }

    if (!handle) {
      throw new Error('ENGINE_UNAVAILABLE');
    }

    const officialBase = typeof context.officialElo === 'number' ? context.officialElo : policy.phaseElo;
    const targetUciElo = Math.round(officialBase * 0.35 + policy.phaseElo * 0.65);
    telemetry.targetUciElo = targetUciElo;
    const subMix = buildSub1350MoveMix(targetUciElo, policy.pInaccuracy, policy.pBlunder);

    const analysis = await analyzePosition(handle, fen, {
      movetimeMs: Math.max(8, Math.round(policy.movetimeMs * (context.thinkTimeScale ?? 1))),
      // Need at least top-3 lines to map inaccuracy/blunder probabilities.
      multiPV: Math.max(4, policy.multiPV),
      targetElo: targetUciElo
    });

    const sorted = [...analysis.candidates].sort((a, b) => b.cp - a.cp);
    if (sorted.length === 0) {
      throw new Error('ENGINE_ANALYSIS_EMPTY');
    }

    const draw = rng.next();
    const p4 = subMix.fourth;
    const p3 = subMix.third;
    const p2 = subMix.second;

    if (draw < p4 && sorted.length >= 4) {
      const pick = sorted[3]!;
      return { uci: pick.uci, cp: pick.cp, reason: 'blunder', telemetry };
    }
    if (draw < p4 + p3 && sorted.length >= 3) {
      const pick = sorted[2]!;
      return { uci: pick.uci, cp: pick.cp, reason: 'blunder', telemetry };
    }
    if (draw < p4 + p3 + p2 && sorted.length >= 2) {
      const pick = sorted[1]!;
      return { uci: pick.uci, cp: pick.cp, reason: 'inaccuracy', telemetry };
    }

    const best = sorted[0]!;
    return { uci: best.uci, cp: best.cp, reason: 'best', telemetry };
  } catch (err) {
    throw err instanceof Error ? err : new Error('ENGINE_ANALYSIS_FAILED');
  }
}

export async function withEngine<T>(run: (engine: EngineHandle | null) => Promise<T>): Promise<T> {
  try {
    const handle = await initEngine();
    try {
      return await run(handle);
    } finally {
      terminateEngine(handle);
    }
  } catch {
    return run(null);
  }
}
