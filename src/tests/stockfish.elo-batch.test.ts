/*
 * File Purpose: Batch simulation calibration tests for stockfish Elo behavior.
 * Key Mechanics: Runs many pairings to compare observed score rates vs Elo gap expectations.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { initEngine, terminateEngine, type EngineHandle } from '../engine/stockfishWorker';
import { chooseMove } from '../engine/stockfish';
import { applyUciMove, gameResult } from '../chess/chessRules';
import { createRng } from '../sim/rng';
import type { SkillRatings } from '../sim/models';

const RUN_BATCH = process.env.RUN_STOCKFISH_ELO_BATCH === '1';
const LEVELS = [800, 1200, 1600] as const;

type Outcome = 'A' | 'B' | 'D';

interface BatchGame {
  id: number;
  eloA: number;
  eloB: number;
  result: Outcome;
  plies: number;
}

interface MatchupSummary {
  games: number;
  winsA: number;
  winsB: number;
  draws: number;
  scoreA: number;
}

function makeSkills(elo: number): SkillRatings {
  return {
    openingElo: elo,
    middlegameElo: elo,
    endgameElo: elo,
    resilience: elo,
    competitiveness: elo,
    studySkills: elo
  };
}

function expected(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

function materialBalance(chess: Chess): number {
  const values: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  let white = 0;
  let black = 0;
  const board = chess.board();
  for (let rank = 0; rank < board.length; rank += 1) {
    for (let file = 0; file < board[rank]!.length; file += 1) {
      const piece = board[rank]![file];
      if (!piece) continue;
      const v = values[piece.type] ?? 0;
      if (piece.color === 'w') white += v;
      else black += v;
    }
  }
  return white - black;
}

async function playOneGame(engine: EngineHandle, eloA: number, eloB: number, seed: number): Promise<BatchGame> {
  const rng = createRng(seed);
  const chess = new Chess();
  const aIsWhite = rng.next() < 0.5;
  const maxPlies = 220;

  for (let ply = 0; ply < maxPlies; ply += 1) {
    const res = gameResult(chess);
    if (res) {
      const aWon = (res === '1-0' && aIsWhite) || (res === '0-1' && !aIsWhite);
      const bWon = (res === '1-0' && !aIsWhite) || (res === '0-1' && aIsWhite);
      return { id: seed, eloA, eloB, result: aWon ? 'A' : bWon ? 'B' : 'D', plies: ply };
    }

    const whiteToMove = chess.turn() === 'w';
    const moveForA = whiteToMove ? aIsWhite : !aIsWhite;
    const moverElo = moveForA ? eloA : eloB;
    const choice = await chooseMove(engine, chess.fen(), {
      skills: makeSkills(moverElo),
      officialElo: moverElo,
      fatigue: 0,
      confidence: 0,
      seed: seed * 1000 + ply * 13,
      thinkTimeScale: 0.08
    });
    if (choice.uci === '0000') break;
    try {
      applyUciMove(chess, choice.uci);
    } catch {
      break;
    }
  }

  const bal = materialBalance(chess);
  const whiteScore = bal === 0 ? 0.5 : bal > 0 ? 1 : 0;
  const aScore = aIsWhite ? whiteScore : 1 - whiteScore;
  if (aScore === 0.5) return { id: seed, eloA, eloB, result: 'D', plies: maxPlies };
  if (aScore === 1) return { id: seed, eloA, eloB, result: 'A', plies: maxPlies };
  // tiny rating tie-break if material adjudication fails to separate
  const expA = expected(eloA, eloB);
  return { id: seed, eloA, eloB, result: expA >= 0.5 ? 'A' : 'B', plies: maxPlies };
}

describe('manual stockfish elo batch', () => {
  const testCase = RUN_BATCH ? it : it.skip;

  testCase(
    'runs 100 games across random {800,1200,1600} pairings and stores aggregate results',
    async () => {
      const rng = createRng(20260221);
      const totalGames = 100;
      const games: BatchGame[] = [];
      const table: Record<string, MatchupSummary> = {};

      const engine = await initEngine();
      try {
        for (let i = 0; i < totalGames; i += 1) {
          const eloA = LEVELS[rng.int(0, LEVELS.length - 1)]!;
          const eloB = LEVELS[rng.int(0, LEVELS.length - 1)]!;
          // eslint-disable-next-line no-await-in-loop
          const game = await playOneGame(engine, eloA, eloB, 1000 + i);
          games.push(game);

          const key = `${eloA} vs ${eloB}`;
          table[key] ??= { games: 0, winsA: 0, winsB: 0, draws: 0, scoreA: 0 };
          table[key]!.games += 1;
          if (game.result === 'A') {
            table[key]!.winsA += 1;
            table[key]!.scoreA += 1;
          } else if (game.result === 'B') {
            table[key]!.winsB += 1;
          } else {
            table[key]!.draws += 1;
            table[key]!.scoreA += 0.5;
          }
        }
      } finally {
        terminateEngine(engine);
      }

      const rows = Object.entries(table)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([matchup, s]) => ({
          matchup,
          games: s.games,
          winsA: s.winsA,
          winsB: s.winsB,
          draws: s.draws,
          scoreA: Number(s.scoreA.toFixed(1)),
          pctA: Number((s.scoreA / s.games).toFixed(3))
        }));

      const payload = {
        generatedAt: new Date().toISOString(),
        seed: 20260221,
        levels: [...LEVELS],
        games: totalGames,
        rows,
        raw: games
      };

      mkdirSync('analysis', { recursive: true });
      writeFileSync('analysis/stockfish-elo-batch-100.json', JSON.stringify(payload, null, 2));

      // Ensure test actually produced the requested sample size.
      expect(games).toHaveLength(100);
      expect(rows.length).toBeGreaterThan(0);
    },
    600_000
  );
});
