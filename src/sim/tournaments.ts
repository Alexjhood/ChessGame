/*
 * File Purpose: Tournament simulation engine.
 * Key Mechanics: Simulates pairings/results, supports Elo-only and Stockfish paths, tracks standings, payouts, fatigue, and logs.
 */

import type { GameRecord, GameState, Opponent, SwissPlayer, TournamentTemplate } from './models';
import { Chess } from 'chess.js';
import { applyUciMove, gameResult } from '../chess/chessRules';
import { materialDeficitPoints } from '../chess/phases';
import { chooseMove } from '../engine/stockfish';
import { initEngine, terminateEngine, type EngineHandle } from '../engine/stockfishWorker';
import { generateOpponents } from './opponents';
import { updateElo } from './rating';
import { clamp, createRng } from './rng';
import { getSimSettings } from './settings';
import { qualifyingNormsForTournament, titleFromProgress, titleFromRating } from './titles';
import { generatePaidPlaces, generatePrizePool, payoutForPlace } from './payout';
import { canTriggerStockfishBalanceDraw, stockfishDrawChanceAtFullMove } from './stockfishDraw';
import { tournamentPerformanceRating } from './performance';

const MAX_INBOX_MONTHS = 3;
const SKILL_KEYS = [
  'openingElo',
  'middlegameElo',
  'endgameElo',
  'resilience',
  'competitiveness',
  'studySkills'
] as const;
const WORLD_CHAMPION_NAMES = ['Arjun Valev', 'Mikael Soren', 'Levon Petrov', 'Rafael Kova', 'Daniil Sato', 'Nikolai Grun'];

function clampSkillValue(skill: keyof GameState['skills'], value: number): number {
  if (skill === 'studySkills') return clamp(value, 0, 2600);
  return clamp(value, 600, 2600);
}

export interface SimRoundGame {
  round: number;
  white: Opponent;
  black: Opponent;
  result: '1-0' | '0-1' | '1/2-1/2';
  movesUci?: string[];
  pgn?: string;
  playerEloChange?: {
    before: number;
    after: number;
    delta: number;
    opponentRating: number;
    expected: number;
    score: 0 | 0.5 | 1;
  };
}

export interface TournamentRun {
  updatedState: GameState;
  standings: SwissPlayer[];
  roundGames: SimRoundGame[];
  watchedCandidate: SimRoundGame;
  prizePool: number;
  paidPlaces: number;
  simulatedPlayerGames: number;
  totalPlayerGames: number;
  isComplete: boolean;
}

export interface TournamentProgress {
  playerDone: number;
  playerTotal: number;
  gamesDone: number;
  gamesTotal: number;
  round: number;
  board: number;
  message: string;
  currentWhite?: string;
  currentBlack?: string;
  currentWhiteElo?: number;
  currentBlackElo?: number;
  currentPly?: number;
  currentFullMove?: number;
  evalWhiteCp?: number;
}

export interface EloTournamentOptions {
  useSkillAverageForAllGames?: boolean;
  maxPlayerGames?: number;
  presetPlayerGames?: SimRoundGame[];
}

function expected(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

function sampleResult(whiteElo: number, blackElo: number, seed: number): '1-0' | '0-1' | '1/2-1/2' {
  const settings = getSimSettings();
  const rng = createRng(seed);
  const eWhite = expected(whiteElo, blackElo);
  const drawChance = clamp(settings.performance.drawBiasBase + (1 - Math.abs(eWhite - 0.5) * 2) * 0.12, 0.1, 0.35);
  const roll = rng.next();
  if (roll < drawChance) return '1/2-1/2';
  if (roll < drawChance + (1 - drawChance) * eWhite) return '1-0';
  return '0-1';
}

function scoreOf(result: '1-0' | '0-1' | '1/2-1/2', isWhite: boolean): 0 | 0.5 | 1 {
  if (result === '1/2-1/2') return 0.5;
  return result === '1-0' ? (isWhite ? 1 : 0) : isWhite ? 0 : 1;
}

function points(result: '1-0' | '0-1' | '1/2-1/2', forWhite: boolean): number {
  if (result === '1/2-1/2') return 0.5;
  return result === '1-0' ? (forWhite ? 1 : 0) : forWhite ? 0 : 1;
}

function playerLostGame(game: SimRoundGame): boolean {
  if (game.white.id === 'player') return game.result === '0-1';
  if (game.black.id === 'player') return game.result === '1-0';
  return false;
}

function applyRandomLossSkillBonuses(updated: GameState, roundGames: SimRoundGame[], seed: number): number {
  const playerLosses = roundGames.filter(playerLostGame);
  if (playerLosses.length === 0) return 0;
  const rng = createRng(seed + 8803);
  for (let i = 0; i < playerLosses.length; i += 1) {
    const key = SKILL_KEYS[rng.int(0, SKILL_KEYS.length - 1)]!;
    updated.skills[key] = clampSkillValue(key, updated.skills[key] + 1);
  }
  return playerLosses.length;
}

function pairSwiss(players: SwissPlayer[]): Array<[SwissPlayer, SwissPlayer]> {
  const sorted = [...players].sort((a, b) => b.score - a.score || b.rating - a.rating);
  const unpaired = [...sorted];
  const pairs: Array<[SwissPlayer, SwissPlayer]> = [];
  while (unpaired.length > 1) {
    const a = unpaired.shift()!;
    let matchIdx = unpaired.findIndex((p) => !a.oppIds.includes(p.id));
    if (matchIdx === -1) matchIdx = 0;
    const b = unpaired.splice(matchIdx, 1)[0]!;
    pairs.push([a, b]);
  }
  return pairs;
}

function topCutSizeForFormat(format: NonNullable<TournamentTemplate['format']>): number {
  if (format === 'swiss_top16_rr') return 16;
  if (format === 'swiss_top8_rr') return 8;
  if (format === 'swiss_top4_rr') return 4;
  if (format === 'swiss_top8_ko') return 8;
  if (format === 'swiss_top4_ko') return 4;
  if (format === 'swiss_top2_ko') return 2;
  return 0;
}

function isKnockoutFormat(format: NonNullable<TournamentTemplate['format']>): boolean {
  return format === 'swiss_top8_ko' || format === 'swiss_top4_ko' || format === 'swiss_top2_ko';
}

function buildRoundRobinSchedule(playerIds: string[]): Array<Array<[string, string]>> {
  const list = [...playerIds];
  if (list.length % 2 === 1) list.push('__bye__');
  const n = list.length;
  const rounds = n - 1;
  const schedule: Array<Array<[string, string]>> = [];
  let arr = [...list];
  for (let r = 0; r < rounds; r += 1) {
    const pairings: Array<[string, string]> = [];
    for (let i = 0; i < n / 2; i += 1) {
      const a = arr[i]!;
      const b = arr[n - 1 - i]!;
      if (a === '__bye__' || b === '__bye__') continue;
      const flip = r % 2 === 1;
      pairings.push(flip ? [b, a] : [a, b]);
    }
    schedule.push(pairings);
    arr = [arr[0]!, arr[n - 1]!, ...arr.slice(1, n - 1)];
  }
  return schedule;
}

function formatConfig(template: TournamentTemplate): {
  mode: NonNullable<TournamentTemplate['format']>;
  phase1Rounds: number;
  cutSize: number;
} {
  const mode = template.format ?? 'swiss';
  const cutSize = topCutSizeForFormat(mode);
  const phase1Rounds =
    cutSize > 0
      ? Math.max(1, Math.min(template.rounds, template.phase1Rounds ?? Math.max(3, template.rounds - (cutSize - 1))))
      : template.rounds;
  return { mode, phase1Rounds, cutSize };
}

function knockoutRoundPairings(activeIds: string[]): Array<[string, string]> {
  const pairings: Array<[string, string]> = [];
  for (let i = 0; i < Math.floor(activeIds.length / 2); i += 1) {
    const white = activeIds[i]!;
    const black = activeIds[activeIds.length - 1 - i]!;
    pairings.push([white, black]);
  }
  return pairings;
}

function resolveKnockoutWinner(result: '1-0' | '0-1' | '1/2-1/2', white: SwissPlayer, black: SwissPlayer, seed: number): SwissPlayer {
  if (result === '1-0') return white;
  if (result === '0-1') return black;
  const rng = createRng(seed);
  if (white.rating === black.rating) return rng.next() < 0.5 ? white : black;
  return white.rating > black.rating ? white : black;
}

function estimatedBoardsTotal(template: TournamentTemplate, participantCount: number): number {
  const { mode, phase1Rounds, cutSize } = formatConfig(template);
  const boardsPerRound = Math.floor(participantCount / 2);
  if (mode === 'swiss') return template.rounds * boardsPerRound;
  if (mode === 'round_robin') return Math.min(template.rounds, Math.max(1, participantCount - 1)) * boardsPerRound;
  if (isKnockoutFormat(mode)) {
    let active = Math.min(cutSize, participantCount);
    let phase2Boards = 0;
    for (let r = 0; r < Math.max(0, template.rounds - phase1Rounds) && active > 1; r += 1) {
      phase2Boards += Math.floor(active / 2);
      active = Math.floor(active / 2);
    }
    return phase1Rounds * boardsPerRound + phase2Boards;
  }
  const phase2Rounds = Math.max(0, template.rounds - phase1Rounds);
  const cutBoards = Math.floor(Math.min(cutSize, participantCount) / 2);
  return phase1Rounds * boardsPerRound + phase2Rounds * cutBoards;
}

function toOppFromPlayer(p: SwissPlayer, map: Record<string, Opponent>): Opponent {
  return map[p.id]!;
}

function averageSkillElo(opponent: Opponent): number {
  const s = opponent.skills;
  return Math.round((s.openingElo + s.middlegameElo + s.endgameElo + s.resilience + s.competitiveness) / 5);
}

function applyPerformanceRatings(standings: SwissPlayer[]): void {
  const byId = Object.fromEntries(standings.map((s) => [s.id, s]));
  standings.forEach((player) => {
    const oppRatings = player.oppIds.map((oppId) => byId[oppId]?.initialRating).filter((r): r is number => typeof r === 'number');
    const avgOpp = oppRatings.length > 0 ? oppRatings.reduce((acc, r) => acc + r, 0) / oppRatings.length : player.initialRating;
    player.averageOpponentRating = Math.round(avgOpp);
    player.performanceRating = tournamentPerformanceRating(player.score, Math.max(1, player.oppIds.length), avgOpp);
  });
}

function isWorldChampionship(template: TournamentTemplate): boolean {
  return template.id === 'world_championship_match';
}

function buildWorldChampionshipOpponent(seed: number): Opponent {
  const rng = createRng(seed + 44003);
  const official = rng.int(2700, 2800);
  const name = WORLD_CHAMPION_NAMES[rng.int(0, WORLD_CHAMPION_NAMES.length - 1)] ?? 'World Champion';
  return {
    id: 'world_champion',
    name,
    publicRating: official,
    style: 'Solid',
    skills: {
      openingElo: clamp(official + rng.int(-28, 24), 2500, 2900),
      middlegameElo: clamp(official + rng.int(-20, 30), 2500, 2900),
      endgameElo: clamp(official + rng.int(-16, 22), 2500, 2900),
      resilience: clamp(official + rng.int(-15, 25), 2450, 2900),
      competitiveness: clamp(official + rng.int(-12, 26), 2450, 2900),
      studySkills: 0
    }
  };
}

async function simulatePlayerGameWithEngine(
  engine: EngineHandle | null,
  whiteOpp: Opponent,
  blackOpp: Opponent,
  whiteRating: number,
  blackRating: number,
  state: GameState,
  template: TournamentTemplate,
  round: number,
  seed: number,
  onMoveProgress?: (p: {
    ply: number;
    fullMove: number;
    evalWhiteCp: number;
    white: string;
    black: string;
    whiteElo: number;
    blackElo: number;
  }) => void
): Promise<{ result: '1-0' | '0-1' | '1/2-1/2'; movesUci: string[]; pgn: string }> {
  const chess = new Chess();
  const playedMoves: string[] = [];
  const maxPlies = 260;
  const drawRng = createRng(seed + round * 1009);

  for (let ply = 0; ply < maxPlies; ply += 1) {
    if (gameResult(chess)) break;
    const turn = chess.turn() === 'w' ? 'white' : 'black';
    const side = turn === 'white' ? whiteOpp : blackOpp;
    const isPlayerSide = side.id === 'player';
    const deficit = materialDeficitPoints(chess.fen(), turn);

    const choice = await chooseMove(engine, chess.fen(), {
      skills: side.skills,
      officialElo: side.id === whiteOpp.id ? whiteRating : blackRating,
      fatigue: isPlayerSide ? state.fatigue + template.travelFatigue + round : 18 + template.travelFatigue / 2,
      confidence: isPlayerSide ? state.confidence : 0,
      materialDeficitPoints: deficit,
      playedMoves,
      seed: seed + round * 701 + ply * 37,
      thinkTimeScale: 1.0
    });

    if (choice.uci === '0000') break;

    try {
      const summary = applyUciMove(chess, choice.uci);
      playedMoves.push(summary.uci);
      const fullMove = Math.ceil(playedMoves.length / 2);
      const evalWhiteCp = turn === 'white' ? choice.cp : -choice.cp;
      onMoveProgress?.({
        ply: playedMoves.length,
        fullMove,
        evalWhiteCp,
        white: whiteOpp.name,
        black: blackOpp.name,
        whiteElo: whiteRating,
        blackElo: blackRating
      });
      const drawChance = stockfishDrawChanceAtFullMove(fullMove);
      if (drawChance > 0 && canTriggerStockfishBalanceDraw(evalWhiteCp) && drawRng.next() < drawChance) {
        return {
          result: '1/2-1/2',
          movesUci: playedMoves,
          pgn: chess.pgn()
        };
      }
    } catch {
      break;
    }
  }

  const finished = gameResult(chess);
  return {
    result: finished ?? adjudicateUnfinishedGame(chess, whiteRating, blackRating, seed + round * 1597),
    movesUci: playedMoves,
    pgn: chess.pgn()
  };
}

function materialBalance(chess: Chess): number {
  const values: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  let white = 0;
  let black = 0;
  const board = chess.board();
  for (let rank = 0; rank < board.length; rank += 1) {
    const row = board[rank]!;
    for (let file = 0; file < row.length; file += 1) {
      const piece = row[file];
      if (!piece) continue;
      const value = values[piece.type] ?? 0;
      if (piece.color === 'w') white += value;
      else black += value;
    }
  }
  return white - black;
}

function adjudicateUnfinishedGame(
  chess: Chess,
  whiteRating: number,
  blackRating: number,
  seed: number
): '1-0' | '0-1' | '1/2-1/2' {
  const balance = materialBalance(chess);
  const whiteAdjusted = whiteRating + balance * 45;
  const blackAdjusted = blackRating - balance * 45;
  const rng = createRng(seed);
  const eWhite = expected(whiteAdjusted, blackAdjusted);
  const drawChance = clamp(0.08 + Math.max(0, 0.22 - Math.abs(balance) * 0.03), 0.04, 0.22);
  const roll = rng.next();
  if (roll < drawChance) return '1/2-1/2';
  if (roll < drawChance + (1 - drawChance) * eWhite) return '1-0';
  return '0-1';
}

function applyNormsAndTitleFromStandings(
  updated: GameState,
  standings: SwissPlayer[],
  roundsPlayed: number
): { awardedNorms: string[]; playerPerformance: number; playerAverageOpp: number } {
  const player = standings.find((p) => p.id === 'player');
  const performance = player?.performanceRating ?? updated.publicRating;
  const avgOpp = player?.averageOpponentRating ?? updated.publicRating;
  const playerScore = player?.score ?? 0;
  const awarded = qualifyingNormsForTournament({
    games: roundsPlayed,
    score: playerScore,
    averageOpponentRating: avgOpp,
    performanceRating: performance
  });
  awarded.forEach((normTitle) => {
    updated.normProgress[normTitle] = (updated.normProgress[normTitle] ?? 0) + 1;
  });
  updated.title = titleFromProgress({
    rating: updated.publicRating,
    gender: updated.avatar.gender,
    norms: updated.normProgress,
    ratedGamesPlayed: updated.ratedGamesPlayed,
    worldChampionAchieved: updated.meta.worldChampionAchieved
  });
  return { awardedNorms: awarded, playerPerformance: performance, playerAverageOpp: avgOpp };
}

export function runSwissTournament(
  state: GameState,
  template: TournamentTemplate,
  options: EloTournamentOptions = {}
): TournamentRun {
  if (isWorldChampionship(template)) {
    return runWorldChampionshipElo(state, template, options);
  }
  const seed = state.meta.seed + state.week * 9973;
  const rng = createRng(seed);
  const participantCountTarget = Math.max(2, template.fieldSize ?? 32);
  const opponents = generateOpponents(seed, Math.max(1, participantCountTarget - 1), template.avgOpponentRating, template.ratingStdDev);

  const playerOpponent: Opponent = {
    id: 'player',
    name: state.avatar.name,
    publicRating: state.publicRating,
    style: 'Solid',
    skills: state.skills
  };

  const allOpps = [playerOpponent, ...opponents];
  const participantCount = allOpps.length;
  const prizePool = generatePrizePool(template.entryFee, participantCount, seed, template.id);
  const paidPlaces = generatePaidPlaces(participantCount, seed, template.id);
  const oppMap = Object.fromEntries(allOpps.map((o) => [o.id, o]));
  const standings: SwissPlayer[] = allOpps.map((o) => ({
    id: o.id,
    name: o.name,
    initialRating: o.publicRating,
    rating: o.publicRating,
    score: 0,
    oppIds: [],
    buchholz: 0,
    isHuman: o.id === 'player'
  }));
  const roundGames: SimRoundGame[] = [];
  const totalPlayerGames = template.rounds;
  const presetPlayerGames = options.presetPlayerGames ?? [];
  const maxPlayerGames = Math.max(0, Math.min(totalPlayerGames, options.maxPlayerGames ?? totalPlayerGames));
  let simulatedPlayerGames = 0;
  let playerGameIndex = 0;
  const { mode, phase1Rounds, cutSize } = formatConfig(template);
  const allRoundRobinSchedule =
    mode === 'round_robin' ? buildRoundRobinSchedule(standings.map((s) => s.id)).slice(0, template.rounds) : null;
  let topCutRoundRobinSchedule: Array<Array<[string, string]>> | null = null;
  let knockoutActiveIds: string[] | null = null;
  let completedAllRounds = true;

  for (let round = 1; round <= template.rounds; round += 1) {
    if (simulatedPlayerGames >= maxPlayerGames) {
      completedAllRounds = false;
      break;
    }
    let pairs: Array<[SwissPlayer, SwissPlayer]> = [];
    let forcePairOrder = false;
    if (mode === 'swiss') {
      pairs = pairSwiss(standings);
    } else if (mode === 'round_robin') {
      const idPairs = allRoundRobinSchedule?.[round - 1] ?? [];
      const byId = Object.fromEntries(standings.map((s) => [s.id, s]));
      pairs = idPairs
        .map(([w, b]) => [byId[w], byId[b]] as const)
        .filter((p): p is [SwissPlayer, SwissPlayer] => Boolean(p[0] && p[1]));
      forcePairOrder = true;
    } else if (round <= phase1Rounds) {
      pairs = pairSwiss(standings);
    } else {
      const ranked = [...standings].sort((a, b) => b.score - a.score || b.buchholz - a.buchholz || b.rating - a.rating);
      const byId = Object.fromEntries(standings.map((s) => [s.id, s]));
      if (isKnockoutFormat(mode)) {
        if (!knockoutActiveIds) {
          knockoutActiveIds = ranked.slice(0, Math.min(cutSize, ranked.length)).map((p) => p.id);
        }
        const idPairs = knockoutRoundPairings(knockoutActiveIds);
        pairs = idPairs
          .map(([w, b]) => [byId[w], byId[b]] as const)
          .filter((p): p is [SwissPlayer, SwissPlayer] => Boolean(p[0] && p[1]));
        forcePairOrder = true;
      } else {
        if (!topCutRoundRobinSchedule) {
          const topIds = ranked.slice(0, Math.min(cutSize, ranked.length)).map((p) => p.id);
          topCutRoundRobinSchedule = buildRoundRobinSchedule(topIds).slice(0, Math.max(0, template.rounds - phase1Rounds));
        }
        const idPairs = topCutRoundRobinSchedule[round - phase1Rounds - 1] ?? [];
        pairs = idPairs
          .map(([w, b]) => [byId[w], byId[b]] as const)
          .filter((p): p is [SwissPlayer, SwissPlayer] => Boolean(p[0] && p[1]));
        forcePairOrder = true;
      }
    }
    const knockoutWinners: string[] = [];
    pairs.forEach(([a, b], pairIdx) => {
      const white = forcePairOrder ? a : pairIdx % 2 === 0 ? a : b;
      const black = forcePairOrder ? b : pairIdx % 2 === 0 ? b : a;
      const whiteOpp = toOppFromPlayer(white, oppMap);
      const blackOpp = toOppFromPlayer(black, oppMap);
      const hasPlayer = white.id === 'player' || black.id === 'player';
      let result: SimRoundGame['result'];
      let movesUci: string[] | undefined;
      let pgn: string | undefined;
      if (hasPlayer) {
        simulatedPlayerGames += 1;
        const preset = presetPlayerGames[playerGameIndex];
        playerGameIndex += 1;
        if (preset && preset.white.id === whiteOpp.id && preset.black.id === blackOpp.id) {
          result = preset.result;
          movesUci = preset.movesUci;
          pgn = preset.pgn;
        } else {
          result = sampleResult(averageSkillElo(whiteOpp), averageSkillElo(blackOpp), seed + round * 100 + pairIdx);
        }
      } else {
        result = options.useSkillAverageForAllGames
          ? sampleResult(averageSkillElo(whiteOpp), averageSkillElo(blackOpp), seed + round * 100 + pairIdx)
          : sampleResult(white.rating, black.rating, seed + round * 100 + pairIdx);
      }

      const whitePts = points(result, true);
      const blackPts = points(result, false);
      white.score += whitePts;
      black.score += blackPts;
      white.oppIds.push(black.id);
      black.oppIds.push(white.id);

      const whiteBefore = white.rating;
      const blackBefore = black.rating;
      white.rating = updateElo(whiteBefore, blackBefore, whitePts as 0 | 0.5 | 1);
      black.rating = updateElo(blackBefore, whiteBefore, blackPts as 0 | 0.5 | 1);

      let playerEloChange: SimRoundGame['playerEloChange'];
      if (white.id === 'player' || black.id === 'player') {
        const playerIsWhite = white.id === 'player';
        const score = scoreOf(result, playerIsWhite);
        const opponentRating = playerIsWhite ? blackBefore : whiteBefore;
        const before = playerIsWhite ? whiteBefore : blackBefore;
        const expectedScore = expected(before, opponentRating);
        const after = playerIsWhite ? white.rating : black.rating;
        playerEloChange = {
          before,
          after,
          delta: after - before,
          opponentRating,
          expected: Number(expectedScore.toFixed(3)),
          score
        };
      }

      roundGames.push({ round, white: whiteOpp, black: blackOpp, result, movesUci, pgn, playerEloChange });
      if (isKnockoutFormat(mode) && round > phase1Rounds) {
        knockoutWinners.push(resolveKnockoutWinner(result, white, black, seed + round * 100 + pairIdx).id);
      }
    });
    if (isKnockoutFormat(mode) && round > phase1Rounds && knockoutWinners.length > 0) {
      knockoutActiveIds = knockoutWinners;
    }

    standings.forEach((p) => {
      p.buchholz = p.oppIds.reduce((acc, oppId) => acc + (standings.find((x) => x.id === oppId)?.score ?? 0), 0);
    });
  }

  applyPerformanceRatings(standings);
  standings.sort((a, b) => b.score - a.score || b.buchholz - a.buchholz || b.rating - a.rating);
  const isComplete = completedAllRounds;

  const player = standings.find((p) => p.id === 'player');
  const placement = standings.findIndex((p) => p.id === 'player') + 1;
  const playerScore = player?.score ?? 0;
  const playerRating = player?.rating ?? state.publicRating;
  const ratingDelta = playerRating - state.publicRating;
  const prize = payoutForPlace(placement, prizePool, participantCount, paidPlaces);

  const relevantGames = roundGames.filter((g) => g.white.id === 'player' || g.black.id === 'player');
  const historyGames: GameRecord[] = relevantGames.map((g, idx) => ({
    id: `${template.id}_w${state.week}_g${idx}`,
    white: g.white.name,
    black: g.black.name,
    result: g.result,
    round: g.round,
    watched: false,
    tournamentId: template.id
  }));

  const resolvedTotalPlayerGames = isComplete
    ? roundGames.filter((g) => g.white.id === 'player' || g.black.id === 'player').length
    : totalPlayerGames;
  const updated = structuredClone(state);
  if (isComplete) {
    const beforeSkills = structuredClone(state.skills);
    updated.week += 1;
    updated.ageYears = Number((updated.ageYears + 1 / 12).toFixed(2));
    updated.money = Math.max(0, updated.money - template.entryFee + prize);
    updated.fatigue = clamp(updated.fatigue + template.travelFatigue, 0, 100);
    updated.reputation = clamp(updated.reputation + Math.max(1, 10 - placement), 0, 100);
    updated.skills.resilience = clampSkillValue('resilience', updated.skills.resilience + Math.round(template.rounds * 0.9));
    updated.skills.competitiveness = clampSkillValue(
      'competitiveness',
      updated.skills.competitiveness + Math.round(template.rounds * 1.2)
    );
    updated.skills.studySkills = clampSkillValue('studySkills', updated.skills.studySkills + Math.round(template.rounds * 0.4));
    const lossBonuses = applyRandomLossSkillBonuses(updated, roundGames, seed);
    updated.recentSkillDeltas = {
      openingElo: updated.skills.openingElo - beforeSkills.openingElo,
      middlegameElo: updated.skills.middlegameElo - beforeSkills.middlegameElo,
      endgameElo: updated.skills.endgameElo - beforeSkills.endgameElo,
      resilience: updated.skills.resilience - beforeSkills.resilience,
      competitiveness: updated.skills.competitiveness - beforeSkills.competitiveness,
      studySkills: updated.skills.studySkills - beforeSkills.studySkills
    };
    updated.publicRating = playerRating;
    updated.ratedGamesPlayed += template.rounds;
    const normResult = applyNormsAndTitleFromStandings(updated, standings, template.rounds);
    updated.confidence = clamp(updated.confidence + (ratingDelta > 0 ? 2 : ratingDelta < 0 ? -2 : 0), -20, 20);

    updated.history.tournaments.unshift({
      id: `${template.id}_week_${state.week}`,
      name: template.name,
      week: state.week,
      rounds: template.rounds,
      placement,
      score: playerScore,
      ratingDelta,
      prize,
      performanceRating: normResult.playerPerformance,
      averageOpponentRating: normResult.playerAverageOpp,
      normsAwarded: normResult.awardedNorms,
      games: historyGames
    });
    updated.history.tournaments = updated.history.tournaments.slice(0, 30);
    updated.history.games.unshift(...historyGames);
    updated.history.games = updated.history.games.slice(0, 120);
    updated.meta.lastPlayedAt = new Date().toISOString();
    updated.inbox.unshift(`Month ${updated.week}: ${template.name} finished, place #${placement}, ${playerScore.toFixed(1)}/${template.rounds}.`);
    if (normResult.awardedNorms.length > 0) {
      updated.inbox.unshift(`Month ${updated.week}: Norm earned: ${normResult.awardedNorms.join(', ')}.`);
    }
    if (lossBonuses > 0) {
      updated.inbox.unshift(`Month ${updated.week}: Learned from losses (+${lossBonuses} random skill points from lost games).`);
    }
    updated.inbox = updated.inbox.slice(0, MAX_INBOX_MONTHS);
  }

  const candidateGames = roundGames.filter((g) => g.white.id === 'player' || g.black.id === 'player');
  const watchedCandidate = candidateGames[rng.int(0, Math.max(0, candidateGames.length - 1))] ?? roundGames[0]!;

  return {
    updatedState: updated,
    standings,
    roundGames,
    watchedCandidate,
    prizePool,
    paidPlaces,
    simulatedPlayerGames,
    totalPlayerGames: resolvedTotalPlayerGames,
    isComplete
  };
}

export async function runSwissTournamentWithEngine(
  state: GameState,
  template: TournamentTemplate,
  onProgress?: (p: TournamentProgress) => void,
  options: { maxPlayerGames?: number; presetPlayerGames?: SimRoundGame[] } = {}
): Promise<TournamentRun> {
  if (isWorldChampionship(template)) {
    return runWorldChampionshipWithEngine(state, template, onProgress, options);
  }
  const seed = state.meta.seed + state.week * 9973;
  const rng = createRng(seed);
  const participantCountTarget = Math.max(2, template.fieldSize ?? 32);
  const opponents = generateOpponents(seed, Math.max(1, participantCountTarget - 1), template.avgOpponentRating, template.ratingStdDev);

  const playerOpponent: Opponent = {
    id: 'player',
    name: state.avatar.name,
    publicRating: state.publicRating,
    style: 'Solid',
    skills: state.skills
  };

  const allOpps = [playerOpponent, ...opponents];
  const participantCount = allOpps.length;
  const prizePool = generatePrizePool(template.entryFee, participantCount, seed, template.id);
  const paidPlaces = generatePaidPlaces(participantCount, seed, template.id);
  const oppMap = Object.fromEntries(allOpps.map((o) => [o.id, o]));
  const standings: SwissPlayer[] = allOpps.map((o) => ({
    id: o.id,
    name: o.name,
    initialRating: o.publicRating,
    rating: o.publicRating,
    score: 0,
    oppIds: [],
    buchholz: 0,
    isHuman: o.id === 'player'
  }));
  const roundGames: SimRoundGame[] = [];
  const totalPlayerGames = template.rounds;
  const presetPlayerGames = options.presetPlayerGames ?? [];
  const maxPlayerGames = Math.max(0, Math.min(totalPlayerGames, options.maxPlayerGames ?? totalPlayerGames));
  const { mode, phase1Rounds, cutSize } = formatConfig(template);
  const allRoundRobinSchedule =
    mode === 'round_robin' ? buildRoundRobinSchedule(standings.map((s) => s.id)).slice(0, template.rounds) : null;
  let topCutRoundRobinSchedule: Array<Array<[string, string]>> | null = null;
  let knockoutActiveIds: string[] | null = null;
  let completedAllRounds = true;

  let engine: EngineHandle | null = null;
  let playerDone = 0;
  let playerGameIndex = 0;
  let gamesDone = 0;
  const playerTotal = maxPlayerGames;
  const gamesTotal = estimatedBoardsTotal(template, participantCount);

  onProgress?.({
    playerDone,
    playerTotal,
    gamesDone,
    gamesTotal,
    round: 0,
    board: 0,
    message: 'Preparing tournament simulation...',
    currentWhite: undefined,
    currentBlack: undefined,
    currentWhiteElo: undefined,
    currentBlackElo: undefined,
    currentPly: undefined,
    currentFullMove: undefined,
    evalWhiteCp: undefined
  });
  try {
    engine = await initEngine();
    onProgress?.({
      playerDone,
      playerTotal,
      gamesDone,
      gamesTotal,
      round: 0,
      board: 0,
      message: 'Engine ready. Starting pairings...',
      currentWhite: undefined,
      currentBlack: undefined,
      currentWhiteElo: undefined,
      currentBlackElo: undefined,
      currentPly: undefined,
      currentFullMove: undefined,
      evalWhiteCp: undefined
    });
  } catch {
    throw new Error('ENGINE_UNAVAILABLE');
  }

  try {
    for (let round = 1; round <= template.rounds; round += 1) {
      if (playerDone >= maxPlayerGames) {
        completedAllRounds = false;
        break;
      }
      let pairs: Array<[SwissPlayer, SwissPlayer]> = [];
      let forcePairOrder = false;
      if (mode === 'swiss') {
        pairs = pairSwiss(standings);
      } else if (mode === 'round_robin') {
        const idPairs = allRoundRobinSchedule?.[round - 1] ?? [];
        const byId = Object.fromEntries(standings.map((s) => [s.id, s]));
        pairs = idPairs
          .map(([w, b]) => [byId[w], byId[b]] as const)
          .filter((p): p is [SwissPlayer, SwissPlayer] => Boolean(p[0] && p[1]));
        forcePairOrder = true;
      } else if (round <= phase1Rounds) {
        pairs = pairSwiss(standings);
      } else {
        const ranked = [...standings].sort((a, b) => b.score - a.score || b.buchholz - a.buchholz || b.rating - a.rating);
        const byId = Object.fromEntries(standings.map((s) => [s.id, s]));
        if (isKnockoutFormat(mode)) {
          if (!knockoutActiveIds) {
            knockoutActiveIds = ranked.slice(0, Math.min(cutSize, ranked.length)).map((p) => p.id);
          }
          const idPairs = knockoutRoundPairings(knockoutActiveIds);
          pairs = idPairs
            .map(([w, b]) => [byId[w], byId[b]] as const)
            .filter((p): p is [SwissPlayer, SwissPlayer] => Boolean(p[0] && p[1]));
          forcePairOrder = true;
        } else {
          if (!topCutRoundRobinSchedule) {
            const topIds = ranked.slice(0, Math.min(cutSize, ranked.length)).map((p) => p.id);
            topCutRoundRobinSchedule = buildRoundRobinSchedule(topIds).slice(0, Math.max(0, template.rounds - phase1Rounds));
          }
          const idPairs = topCutRoundRobinSchedule[round - phase1Rounds - 1] ?? [];
          pairs = idPairs
            .map(([w, b]) => [byId[w], byId[b]] as const)
            .filter((p): p is [SwissPlayer, SwissPlayer] => Boolean(p[0] && p[1]));
          forcePairOrder = true;
        }
      }
      const knockoutWinners: string[] = [];
      for (let pairIdx = 0; pairIdx < pairs.length; pairIdx += 1) {
        const [a, b] = pairs[pairIdx]!;
        const white = forcePairOrder ? a : pairIdx % 2 === 0 ? a : b;
        const black = forcePairOrder ? b : pairIdx % 2 === 0 ? b : a;
        const whiteOpp = toOppFromPlayer(white, oppMap);
        const blackOpp = toOppFromPlayer(black, oppMap);

        let result: SimRoundGame['result'];
        let movesUci: string[] | undefined;
        let pgn: string | undefined;
        if (white.id === 'player' || black.id === 'player') {
          const preset = presetPlayerGames[playerGameIndex];
          playerGameIndex += 1;
          if (preset && preset.white.id === whiteOpp.id && preset.black.id === blackOpp.id) {
            result = preset.result;
            movesUci = preset.movesUci;
            pgn = preset.pgn;
            playerDone += 1;
          } else {
          const opponentName = white.id === 'player' ? black.name : white.name;
          onProgress?.({
            playerDone,
            playerTotal,
            gamesDone,
            gamesTotal,
            round,
            board: pairIdx + 1,
            message: `Round ${round}: simulating your game vs ${opponentName}...`
          });
          const fullGame = await simulatePlayerGameWithEngine(
            engine,
            whiteOpp,
            blackOpp,
            white.rating,
            black.rating,
            state,
            template,
            round,
            seed + pairIdx * 101,
            (move) =>
              onProgress?.({
                playerDone,
                playerTotal,
                gamesDone,
                gamesTotal,
                round,
                board: pairIdx + 1,
                message: `Round ${round}: ${move.white} vs ${move.black} | move ${move.fullMove}`,
                currentWhite: move.white,
                currentBlack: move.black,
                currentWhiteElo: move.whiteElo,
                currentBlackElo: move.blackElo,
                currentPly: move.ply,
                currentFullMove: move.fullMove,
                evalWhiteCp: move.evalWhiteCp
              })
          );
          result = fullGame.result;
          movesUci = fullGame.movesUci;
          pgn = fullGame.pgn;
          playerDone += 1;
          }
        } else {
          result = sampleResult(white.rating, black.rating, seed + round * 100 + pairIdx);
        }
        gamesDone += 1;
        onProgress?.({
          playerDone,
          playerTotal,
          gamesDone,
          gamesTotal,
          round,
          board: pairIdx + 1,
          message: `Round ${round}: board ${pairIdx + 1}/${pairs.length} complete`,
          currentWhite: undefined,
          currentBlack: undefined,
          currentWhiteElo: undefined,
          currentBlackElo: undefined,
          currentPly: undefined,
          currentFullMove: undefined,
          evalWhiteCp: undefined
        });

        const whitePts = points(result, true);
        const blackPts = points(result, false);
        white.score += whitePts;
        black.score += blackPts;
        white.oppIds.push(black.id);
        black.oppIds.push(white.id);

        const whiteBefore = white.rating;
        const blackBefore = black.rating;
        white.rating = updateElo(whiteBefore, blackBefore, whitePts as 0 | 0.5 | 1);
        black.rating = updateElo(blackBefore, whiteBefore, blackPts as 0 | 0.5 | 1);

        let playerEloChange: SimRoundGame['playerEloChange'];
        if (white.id === 'player' || black.id === 'player') {
          const playerIsWhite = white.id === 'player';
          const score = scoreOf(result, playerIsWhite);
          const opponentRating = playerIsWhite ? blackBefore : whiteBefore;
          const before = playerIsWhite ? whiteBefore : blackBefore;
          const expectedScore = expected(before, opponentRating);
          const after = playerIsWhite ? white.rating : black.rating;
          playerEloChange = {
            before,
            after,
            delta: after - before,
            opponentRating,
            expected: Number(expectedScore.toFixed(3)),
            score
          };
        }
        roundGames.push({ round, white: whiteOpp, black: blackOpp, result, movesUci, pgn, playerEloChange });
        if (isKnockoutFormat(mode) && round > phase1Rounds) {
          knockoutWinners.push(resolveKnockoutWinner(result, white, black, seed + round * 100 + pairIdx).id);
        }
      }
      if (isKnockoutFormat(mode) && round > phase1Rounds && knockoutWinners.length > 0) {
        knockoutActiveIds = knockoutWinners;
      }

      standings.forEach((p) => {
        p.buchholz = p.oppIds.reduce((acc, oppId) => acc + (standings.find((x) => x.id === oppId)?.score ?? 0), 0);
      });
    }
  } finally {
    if (engine) terminateEngine(engine);
  }

  standings.sort((a, b) => b.score - a.score || b.buchholz - a.buchholz || b.rating - a.rating);
  const isComplete = completedAllRounds;

  const placement = standings.findIndex((p) => p.id === 'player') + 1;
  const playerScore = standings.find((p) => p.id === 'player')?.score ?? 0;
  const playerRating = standings.find((p) => p.id === 'player')?.rating ?? state.publicRating;
  const ratingDelta = playerRating - state.publicRating;
  const prize = payoutForPlace(placement, prizePool, participantCount, paidPlaces);

  const relevantGames = roundGames.filter((g) => g.white.id === 'player' || g.black.id === 'player');
  const historyGames: GameRecord[] = relevantGames.map((g, idx) => ({
    id: `${template.id}_w${state.week}_g${idx}`,
    white: g.white.name,
    black: g.black.name,
    result: g.result,
    pgn: g.pgn,
    round: g.round,
    watched: false,
    tournamentId: template.id
  }));

  const resolvedTotalPlayerGames = isComplete
    ? roundGames.filter((g) => g.white.id === 'player' || g.black.id === 'player').length
    : totalPlayerGames;
  const updated = structuredClone(state);
  if (isComplete) {
    const beforeSkills = structuredClone(state.skills);
    updated.week += 1;
    updated.ageYears = Number((updated.ageYears + 1 / 12).toFixed(2));
    updated.money = Math.max(0, updated.money - template.entryFee + prize);
    updated.fatigue = clamp(updated.fatigue + template.travelFatigue, 0, 100);
    updated.reputation = clamp(updated.reputation + Math.max(1, 10 - placement), 0, 100);
    updated.skills.resilience = clampSkillValue('resilience', updated.skills.resilience + Math.round(template.rounds * 0.9));
    updated.skills.competitiveness = clampSkillValue(
      'competitiveness',
      updated.skills.competitiveness + Math.round(template.rounds * 1.2)
    );
    updated.skills.studySkills = clampSkillValue('studySkills', updated.skills.studySkills + Math.round(template.rounds * 0.4));
    const lossBonuses = applyRandomLossSkillBonuses(updated, roundGames, seed);
    updated.recentSkillDeltas = {
      openingElo: updated.skills.openingElo - beforeSkills.openingElo,
      middlegameElo: updated.skills.middlegameElo - beforeSkills.middlegameElo,
      endgameElo: updated.skills.endgameElo - beforeSkills.endgameElo,
      resilience: updated.skills.resilience - beforeSkills.resilience,
      competitiveness: updated.skills.competitiveness - beforeSkills.competitiveness,
      studySkills: updated.skills.studySkills - beforeSkills.studySkills
    };
    updated.publicRating = playerRating;
    updated.ratedGamesPlayed += template.rounds;
    const normResult = applyNormsAndTitleFromStandings(updated, standings, template.rounds);
    updated.confidence = clamp(updated.confidence + (ratingDelta > 0 ? 2 : ratingDelta < 0 ? -2 : 0), -20, 20);

    updated.history.tournaments.unshift({
      id: `${template.id}_week_${state.week}`,
      name: template.name,
      week: state.week,
      rounds: template.rounds,
      placement,
      score: playerScore,
      ratingDelta,
      prize,
      performanceRating: normResult.playerPerformance,
      averageOpponentRating: normResult.playerAverageOpp,
      normsAwarded: normResult.awardedNorms,
      games: historyGames
    });
    updated.history.tournaments = updated.history.tournaments.slice(0, 30);
    updated.history.games.unshift(...historyGames);
    updated.history.games = updated.history.games.slice(0, 120);
    updated.meta.lastPlayedAt = new Date().toISOString();
    updated.inbox.unshift(`Month ${updated.week}: ${template.name} finished, place #${placement}, ${playerScore.toFixed(1)}/${template.rounds}.`);
    if (normResult.awardedNorms.length > 0) {
      updated.inbox.unshift(`Month ${updated.week}: Norm earned: ${normResult.awardedNorms.join(', ')}.`);
    }
    if (lossBonuses > 0) {
      updated.inbox.unshift(`Month ${updated.week}: Learned from losses (+${lossBonuses} random skill points from lost games).`);
    }
    updated.inbox = updated.inbox.slice(0, MAX_INBOX_MONTHS);
  }

  const candidateGames = roundGames.filter((g) => g.white.id === 'player' || g.black.id === 'player');
  const watchedCandidate = candidateGames[rng.int(0, Math.max(0, candidateGames.length - 1))] ?? roundGames[0]!;

  onProgress?.({
    playerDone,
    playerTotal,
    gamesDone,
    gamesTotal,
    round: Math.min(template.rounds, playerDone),
    board: Math.floor(participantCount / 2),
    message: isComplete ? 'Tournament simulation complete.' : `Simulated ${playerDone}/${totalPlayerGames} player games.`,
    currentWhite: undefined,
    currentBlack: undefined,
    currentWhiteElo: undefined,
    currentBlackElo: undefined,
    currentPly: undefined,
    currentFullMove: undefined,
    evalWhiteCp: undefined
  });
  return {
    updatedState: updated,
    standings,
    roundGames,
    watchedCandidate,
    prizePool,
    paidPlaces,
    simulatedPlayerGames: playerDone,
    totalPlayerGames: resolvedTotalPlayerGames,
    isComplete
  };
}

function runWorldChampionshipElo(state: GameState, template: TournamentTemplate, options: EloTournamentOptions = {}): TournamentRun {
  const seed = state.meta.seed + state.week * 9973 + 9041;
  const rng = createRng(seed);
  const challenger = buildWorldChampionshipOpponent(seed);
  const playerOpponent: Opponent = {
    id: 'player',
    name: state.avatar.name,
    publicRating: state.publicRating,
    style: 'Solid',
    skills: state.skills
  };

  const standings: SwissPlayer[] = [playerOpponent, challenger].map((o) => ({
    id: o.id,
    name: o.name,
    initialRating: o.publicRating,
    rating: o.publicRating,
    score: 0,
    oppIds: [],
    buchholz: 0,
    isHuman: o.id === 'player'
  }));
  const totalPlayerGames = template.rounds;
  const maxPlayerGames = Math.max(0, Math.min(totalPlayerGames, options.maxPlayerGames ?? totalPlayerGames));
  const presetPlayerGames = options.presetPlayerGames ?? [];
  const roundGames: SimRoundGame[] = [];
  let simulatedPlayerGames = 0;
  let playerGameIndex = 0;

  for (let round = 1; round <= template.rounds; round += 1) {
    if (simulatedPlayerGames >= maxPlayerGames) break;
    const player = standings.find((s) => s.id === 'player')!;
    const champ = standings.find((s) => s.id === 'world_champion')!;
    const playerWhite = round % 2 === 1;
    const white = playerWhite ? player : champ;
    const black = playerWhite ? champ : player;
    const whiteOpp = white.id === 'player' ? playerOpponent : challenger;
    const blackOpp = black.id === 'player' ? playerOpponent : challenger;

    let result: SimRoundGame['result'];
    let movesUci: string[] | undefined;
    let pgn: string | undefined;
    const preset = presetPlayerGames[playerGameIndex];
    playerGameIndex += 1;
    if (preset && preset.white.id === whiteOpp.id && preset.black.id === blackOpp.id) {
      result = preset.result;
      movesUci = preset.movesUci;
      pgn = preset.pgn;
    } else {
      const whiteStrength = options.useSkillAverageForAllGames ? averageSkillElo(whiteOpp) : white.rating;
      const blackStrength = options.useSkillAverageForAllGames ? averageSkillElo(blackOpp) : black.rating;
      result = sampleResult(whiteStrength, blackStrength, seed + round * 211);
    }
    simulatedPlayerGames += 1;

    const whitePts = points(result, true);
    const blackPts = points(result, false);
    white.score += whitePts;
    black.score += blackPts;
    white.oppIds.push(black.id);
    black.oppIds.push(white.id);

    const whiteBefore = white.rating;
    const blackBefore = black.rating;
    white.rating = updateElo(whiteBefore, blackBefore, whitePts as 0 | 0.5 | 1);
    black.rating = updateElo(blackBefore, whiteBefore, blackPts as 0 | 0.5 | 1);

    const playerIsWhite = white.id === 'player';
    const score = scoreOf(result, playerIsWhite);
    const opponentRating = playerIsWhite ? blackBefore : whiteBefore;
    const before = playerIsWhite ? whiteBefore : blackBefore;
    const expectedScore = expected(before, opponentRating);
    const after = playerIsWhite ? white.rating : black.rating;
    const playerEloChange: SimRoundGame['playerEloChange'] = {
      before,
      after,
      delta: after - before,
      opponentRating,
      expected: Number(expectedScore.toFixed(3)),
      score
    };

    roundGames.push({ round, white: whiteOpp, black: blackOpp, result, movesUci, pgn, playerEloChange });
  }

  standings.forEach((p) => {
    p.buchholz = p.oppIds.reduce((acc, oppId) => acc + (standings.find((x) => x.id === oppId)?.score ?? 0), 0);
  });
  standings.sort((a, b) => b.score - a.score || b.buchholz - a.buchholz || b.rating - a.rating);
  const isComplete = simulatedPlayerGames >= totalPlayerGames;
  const participantCount = 2;
  const prizePool = template.prizePool;
  const paidPlaces = 1;

  const placement = standings.findIndex((p) => p.id === 'player') + 1;
  const playerScore = standings.find((p) => p.id === 'player')?.score ?? 0;
  const playerRating = standings.find((p) => p.id === 'player')?.rating ?? state.publicRating;
  const ratingDelta = playerRating - state.publicRating;
  const prize = payoutForPlace(placement, prizePool, participantCount, paidPlaces);

  const historyGames: GameRecord[] = roundGames.map((g, idx) => ({
    id: `${template.id}_w${state.week}_g${idx}`,
    white: g.white.name,
    black: g.black.name,
    result: g.result,
    round: g.round,
    watched: false,
    tournamentId: template.id
  }));

  const updated = structuredClone(state);
  if (isComplete) {
    const beforeSkills = structuredClone(state.skills);
    updated.week += 1;
    updated.ageYears = Number((updated.ageYears + 1 / 12).toFixed(2));
    updated.money = Math.max(0, updated.money - template.entryFee + prize);
    updated.fatigue = clamp(updated.fatigue + template.travelFatigue, 0, 100);
    updated.reputation = clamp(updated.reputation + (placement === 1 ? 14 : 7), 0, 100);
    updated.skills.resilience = clampSkillValue('resilience', updated.skills.resilience + Math.round(template.rounds * 1.1));
    updated.skills.competitiveness = clampSkillValue('competitiveness', updated.skills.competitiveness + Math.round(template.rounds * 1.4));
    updated.skills.studySkills = clampSkillValue('studySkills', updated.skills.studySkills + Math.round(template.rounds * 0.5));
    const lossBonuses = applyRandomLossSkillBonuses(updated, roundGames, seed);
    updated.recentSkillDeltas = {
      openingElo: updated.skills.openingElo - beforeSkills.openingElo,
      middlegameElo: updated.skills.middlegameElo - beforeSkills.middlegameElo,
      endgameElo: updated.skills.endgameElo - beforeSkills.endgameElo,
      resilience: updated.skills.resilience - beforeSkills.resilience,
      competitiveness: updated.skills.competitiveness - beforeSkills.competitiveness,
      studySkills: updated.skills.studySkills - beforeSkills.studySkills
    };
    updated.publicRating = playerRating;
    updated.ratedGamesPlayed += template.rounds;
    const normResult = applyNormsAndTitleFromStandings(updated, standings, template.rounds);
    updated.confidence = clamp(updated.confidence + (ratingDelta > 0 ? 3 : ratingDelta < 0 ? -2 : 1), -20, 20);
    if (placement === 1) {
      updated.meta.worldChampionAchieved = true;
    }
    updated.title = titleFromProgress({
      rating: updated.publicRating,
      gender: updated.avatar.gender,
      norms: updated.normProgress,
      ratedGamesPlayed: updated.ratedGamesPlayed,
      worldChampionAchieved: updated.meta.worldChampionAchieved
    });
    updated.history.tournaments.unshift({
      id: `${template.id}_week_${state.week}`,
      name: template.name,
      week: state.week,
      rounds: template.rounds,
      placement,
      score: playerScore,
      ratingDelta,
      prize,
      performanceRating: normResult.playerPerformance,
      averageOpponentRating: normResult.playerAverageOpp,
      normsAwarded: normResult.awardedNorms,
      games: historyGames
    });
    updated.history.tournaments = updated.history.tournaments.slice(0, 30);
    updated.history.games.unshift(...historyGames);
    updated.history.games = updated.history.games.slice(0, 120);
    updated.meta.lastPlayedAt = new Date().toISOString();
    updated.inbox.unshift(
      placement === 1
        ? `Month ${updated.week}: You won the World Championship match ${playerScore.toFixed(1)}-${(template.rounds - playerScore).toFixed(1)}.`
        : `Month ${updated.week}: World Championship match finished, runner-up by score ${playerScore.toFixed(1)}/${template.rounds}.`
    );
    if (normResult.awardedNorms.length > 0) {
      updated.inbox.unshift(`Month ${updated.week}: Norm earned: ${normResult.awardedNorms.join(', ')}.`);
    }
    if (lossBonuses > 0) {
      updated.inbox.unshift(`Month ${updated.week}: Learned from losses (+${lossBonuses} random skill points from lost games).`);
    }
    updated.inbox = updated.inbox.slice(0, MAX_INBOX_MONTHS);
  }

  const watchedCandidate = roundGames[rng.int(0, Math.max(0, roundGames.length - 1))] ?? roundGames[0]!;
  return {
    updatedState: updated,
    standings,
    roundGames,
    watchedCandidate,
    prizePool,
    paidPlaces,
    simulatedPlayerGames,
    totalPlayerGames,
    isComplete
  };
}

async function runWorldChampionshipWithEngine(
  state: GameState,
  template: TournamentTemplate,
  onProgress?: (p: TournamentProgress) => void,
  options: { maxPlayerGames?: number; presetPlayerGames?: SimRoundGame[] } = {}
): Promise<TournamentRun> {
  const seed = state.meta.seed + state.week * 9973 + 9041;
  const rng = createRng(seed);
  const challenger = buildWorldChampionshipOpponent(seed);
  const playerOpponent: Opponent = {
    id: 'player',
    name: state.avatar.name,
    publicRating: state.publicRating,
    style: 'Solid',
    skills: state.skills
  };
  const standings: SwissPlayer[] = [playerOpponent, challenger].map((o) => ({
    id: o.id,
    name: o.name,
    initialRating: o.publicRating,
    rating: o.publicRating,
    score: 0,
    oppIds: [],
    buchholz: 0,
    isHuman: o.id === 'player'
  }));
  const totalPlayerGames = template.rounds;
  const maxPlayerGames = Math.max(0, Math.min(totalPlayerGames, options.maxPlayerGames ?? totalPlayerGames));
  const presetPlayerGames = options.presetPlayerGames ?? [];
  const roundGames: SimRoundGame[] = [];
  const playerTotal = maxPlayerGames;
  const gamesTotal = template.rounds;
  let playerDone = 0;
  let gamesDone = 0;
  let playerGameIndex = 0;
  let engine: EngineHandle | null = null;

  onProgress?.({
    playerDone,
    playerTotal,
    gamesDone,
    gamesTotal,
    round: 0,
    board: 0,
    message: 'Preparing world championship match...',
    currentWhite: undefined,
    currentBlack: undefined,
    currentWhiteElo: undefined,
    currentBlackElo: undefined,
    currentPly: undefined,
    currentFullMove: undefined,
    evalWhiteCp: undefined
  });
  try {
    engine = await initEngine();
  } catch {
    throw new Error('ENGINE_UNAVAILABLE');
  }

  try {
    for (let round = 1; round <= template.rounds; round += 1) {
      if (playerDone >= maxPlayerGames) break;
      const player = standings.find((s) => s.id === 'player')!;
      const champ = standings.find((s) => s.id === 'world_champion')!;
      const playerWhite = round % 2 === 1;
      const white = playerWhite ? player : champ;
      const black = playerWhite ? champ : player;
      const whiteOpp = white.id === 'player' ? playerOpponent : challenger;
      const blackOpp = black.id === 'player' ? playerOpponent : challenger;

      let result: SimRoundGame['result'];
      let movesUci: string[] | undefined;
      let pgn: string | undefined;
      const preset = presetPlayerGames[playerGameIndex];
      playerGameIndex += 1;
      if (preset && preset.white.id === whiteOpp.id && preset.black.id === blackOpp.id) {
        result = preset.result;
        movesUci = preset.movesUci;
        pgn = preset.pgn;
        playerDone += 1;
      } else {
        onProgress?.({
          playerDone,
          playerTotal,
          gamesDone,
          gamesTotal,
          round,
          board: 1,
          message: `Game ${round}/12: ${whiteOpp.name} vs ${blackOpp.name}`
        });
        const fullGame = await simulatePlayerGameWithEngine(
          engine,
          whiteOpp,
          blackOpp,
          white.rating,
          black.rating,
          state,
          template,
          round,
          seed + round * 211,
          (move) =>
            onProgress?.({
              playerDone,
              playerTotal,
              gamesDone,
              gamesTotal,
              round,
              board: 1,
              message: `Game ${round}/12: ${move.white} vs ${move.black} | move ${move.fullMove}`,
              currentWhite: move.white,
              currentBlack: move.black,
              currentWhiteElo: move.whiteElo,
              currentBlackElo: move.blackElo,
              currentPly: move.ply,
              currentFullMove: move.fullMove,
              evalWhiteCp: move.evalWhiteCp
            })
        );
        result = fullGame.result;
        movesUci = fullGame.movesUci;
        pgn = fullGame.pgn;
        playerDone += 1;
      }
      gamesDone += 1;

      const whitePts = points(result, true);
      const blackPts = points(result, false);
      white.score += whitePts;
      black.score += blackPts;
      white.oppIds.push(black.id);
      black.oppIds.push(white.id);

      const whiteBefore = white.rating;
      const blackBefore = black.rating;
      white.rating = updateElo(whiteBefore, blackBefore, whitePts as 0 | 0.5 | 1);
      black.rating = updateElo(blackBefore, whiteBefore, blackPts as 0 | 0.5 | 1);

      const playerIsWhite = white.id === 'player';
      const score = scoreOf(result, playerIsWhite);
      const opponentRating = playerIsWhite ? blackBefore : whiteBefore;
      const before = playerIsWhite ? whiteBefore : blackBefore;
      const expectedScore = expected(before, opponentRating);
      const after = playerIsWhite ? white.rating : black.rating;
      const playerEloChange: SimRoundGame['playerEloChange'] = {
        before,
        after,
        delta: after - before,
        opponentRating,
        expected: Number(expectedScore.toFixed(3)),
        score
      };
      roundGames.push({ round, white: whiteOpp, black: blackOpp, result, movesUci, pgn, playerEloChange });
    }
  } finally {
    if (engine) terminateEngine(engine);
  }

  standings.forEach((p) => {
    p.buchholz = p.oppIds.reduce((acc, oppId) => acc + (standings.find((x) => x.id === oppId)?.score ?? 0), 0);
  });
  standings.sort((a, b) => b.score - a.score || b.buchholz - a.buchholz || b.rating - a.rating);
  const isComplete = playerDone >= totalPlayerGames;
  const participantCount = 2;
  const prizePool = template.prizePool;
  const paidPlaces = 1;
  const placement = standings.findIndex((p) => p.id === 'player') + 1;
  const playerScore = standings.find((p) => p.id === 'player')?.score ?? 0;
  const playerRating = standings.find((p) => p.id === 'player')?.rating ?? state.publicRating;
  const ratingDelta = playerRating - state.publicRating;
  const prize = payoutForPlace(placement, prizePool, participantCount, paidPlaces);
  const historyGames: GameRecord[] = roundGames.map((g, idx) => ({
    id: `${template.id}_w${state.week}_g${idx}`,
    white: g.white.name,
    black: g.black.name,
    result: g.result,
    pgn: g.pgn,
    round: g.round,
    watched: false,
    tournamentId: template.id
  }));

  const updated = structuredClone(state);
  if (isComplete) {
    const beforeSkills = structuredClone(state.skills);
    updated.week += 1;
    updated.ageYears = Number((updated.ageYears + 1 / 12).toFixed(2));
    updated.money = Math.max(0, updated.money - template.entryFee + prize);
    updated.fatigue = clamp(updated.fatigue + template.travelFatigue, 0, 100);
    updated.reputation = clamp(updated.reputation + (placement === 1 ? 14 : 7), 0, 100);
    updated.skills.resilience = clampSkillValue('resilience', updated.skills.resilience + Math.round(template.rounds * 1.1));
    updated.skills.competitiveness = clampSkillValue('competitiveness', updated.skills.competitiveness + Math.round(template.rounds * 1.4));
    updated.skills.studySkills = clampSkillValue('studySkills', updated.skills.studySkills + Math.round(template.rounds * 0.5));
    const lossBonuses = applyRandomLossSkillBonuses(updated, roundGames, seed);
    updated.recentSkillDeltas = {
      openingElo: updated.skills.openingElo - beforeSkills.openingElo,
      middlegameElo: updated.skills.middlegameElo - beforeSkills.middlegameElo,
      endgameElo: updated.skills.endgameElo - beforeSkills.endgameElo,
      resilience: updated.skills.resilience - beforeSkills.resilience,
      competitiveness: updated.skills.competitiveness - beforeSkills.competitiveness,
      studySkills: updated.skills.studySkills - beforeSkills.studySkills
    };
    updated.publicRating = playerRating;
    updated.ratedGamesPlayed += template.rounds;
    const normResult = applyNormsAndTitleFromStandings(updated, standings, template.rounds);
    updated.confidence = clamp(updated.confidence + (ratingDelta > 0 ? 3 : ratingDelta < 0 ? -2 : 1), -20, 20);
    if (placement === 1) {
      updated.meta.worldChampionAchieved = true;
    }
    updated.title = titleFromProgress({
      rating: updated.publicRating,
      gender: updated.avatar.gender,
      norms: updated.normProgress,
      ratedGamesPlayed: updated.ratedGamesPlayed,
      worldChampionAchieved: updated.meta.worldChampionAchieved
    });
    updated.history.tournaments.unshift({
      id: `${template.id}_week_${state.week}`,
      name: template.name,
      week: state.week,
      rounds: template.rounds,
      placement,
      score: playerScore,
      ratingDelta,
      prize,
      performanceRating: normResult.playerPerformance,
      averageOpponentRating: normResult.playerAverageOpp,
      normsAwarded: normResult.awardedNorms,
      games: historyGames
    });
    updated.history.tournaments = updated.history.tournaments.slice(0, 30);
    updated.history.games.unshift(...historyGames);
    updated.history.games = updated.history.games.slice(0, 120);
    updated.meta.lastPlayedAt = new Date().toISOString();
    updated.inbox.unshift(
      placement === 1
        ? `Month ${updated.week}: You won the World Championship match ${playerScore.toFixed(1)}-${(template.rounds - playerScore).toFixed(1)}.`
        : `Month ${updated.week}: World Championship match finished, runner-up by score ${playerScore.toFixed(1)}/${template.rounds}.`
    );
    if (normResult.awardedNorms.length > 0) {
      updated.inbox.unshift(`Month ${updated.week}: Norm earned: ${normResult.awardedNorms.join(', ')}.`);
    }
    if (lossBonuses > 0) {
      updated.inbox.unshift(`Month ${updated.week}: Learned from losses (+${lossBonuses} random skill points from lost games).`);
    }
    updated.inbox = updated.inbox.slice(0, MAX_INBOX_MONTHS);
  }
  const watchedCandidate = roundGames[rng.int(0, Math.max(0, roundGames.length - 1))] ?? roundGames[0]!;
  onProgress?.({
    playerDone,
    playerTotal,
    gamesDone,
    gamesTotal,
    round: Math.min(template.rounds, playerDone),
    board: 1,
    message: isComplete ? 'World Championship match complete.' : `Simulated ${playerDone}/${totalPlayerGames} championship games.`,
    currentWhite: undefined,
    currentBlack: undefined,
    currentWhiteElo: undefined,
    currentBlackElo: undefined,
    currentPly: undefined,
    currentFullMove: undefined,
    evalWhiteCp: undefined
  });

  return {
    updatedState: updated,
    standings,
    roundGames,
    watchedCandidate,
    prizePool,
    paidPlaces,
    simulatedPlayerGames: playerDone,
    totalPlayerGames,
    isComplete
  };
}
