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
import { titleFromRating } from './titles';
import { generatePaidPlaces, generatePrizePool, payoutForPlace } from './payout';
import { canTriggerStockfishBalanceDraw, stockfishDrawChanceAtFullMove } from './stockfishDraw';

const MAX_INBOX_MONTHS = 3;
const SKILL_KEYS = [
  'openingElo',
  'middlegameElo',
  'endgameElo',
  'resilience',
  'competitiveness',
  'studySkills'
] as const;

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

function toOppFromPlayer(p: SwissPlayer, map: Record<string, Opponent>): Opponent {
  return map[p.id]!;
}

function averageSkillElo(opponent: Opponent): number {
  const s = opponent.skills;
  return Math.round((s.openingElo + s.middlegameElo + s.endgameElo + s.resilience + s.competitiveness) / 5);
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

export function runSwissTournament(
  state: GameState,
  template: TournamentTemplate,
  options: EloTournamentOptions = {}
): TournamentRun {
  const seed = state.meta.seed + state.week * 9973;
  const rng = createRng(seed);
  const opponents = generateOpponents(seed, 31, template.avgOpponentRating, template.ratingStdDev);

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

  for (let round = 1; round <= template.rounds; round += 1) {
    if (simulatedPlayerGames >= maxPlayerGames) break;
    const pairs = pairSwiss(standings);
    pairs.forEach(([a, b], pairIdx) => {
      const white = pairIdx % 2 === 0 ? a : b;
      const black = pairIdx % 2 === 0 ? b : a;
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
    });

    standings.forEach((p) => {
      p.buchholz = p.oppIds.reduce((acc, oppId) => acc + (standings.find((x) => x.id === oppId)?.score ?? 0), 0);
    });
  }

  standings.sort((a, b) => b.score - a.score || b.buchholz - a.buchholz || b.rating - a.rating);
  const isComplete = simulatedPlayerGames >= totalPlayerGames;

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
    updated.title = titleFromRating(updated.publicRating);
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
      games: historyGames
    });
    updated.history.tournaments = updated.history.tournaments.slice(0, 30);
    updated.history.games.unshift(...historyGames);
    updated.history.games = updated.history.games.slice(0, 120);
    updated.meta.lastPlayedAt = new Date().toISOString();
    updated.inbox.unshift(`Month ${updated.week}: ${template.name} finished, place #${placement}, ${playerScore.toFixed(1)}/${template.rounds}.`);
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
    totalPlayerGames,
    isComplete
  };
}

export async function runSwissTournamentWithEngine(
  state: GameState,
  template: TournamentTemplate,
  onProgress?: (p: TournamentProgress) => void,
  options: { maxPlayerGames?: number; presetPlayerGames?: SimRoundGame[] } = {}
): Promise<TournamentRun> {
  const seed = state.meta.seed + state.week * 9973;
  const rng = createRng(seed);
  const opponents = generateOpponents(seed, 31, template.avgOpponentRating, template.ratingStdDev);

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

  let engine: EngineHandle | null = null;
  let playerDone = 0;
  let playerGameIndex = 0;
  let gamesDone = 0;
  const playerTotal = maxPlayerGames;
  const gamesTotal = template.rounds * Math.floor(participantCount / 2);

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
      if (playerDone >= maxPlayerGames) break;
      const pairs = pairSwiss(standings);
      for (let pairIdx = 0; pairIdx < pairs.length; pairIdx += 1) {
        const [a, b] = pairs[pairIdx]!;
        const white = pairIdx % 2 === 0 ? a : b;
        const black = pairIdx % 2 === 0 ? b : a;
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
      }

      standings.forEach((p) => {
        p.buchholz = p.oppIds.reduce((acc, oppId) => acc + (standings.find((x) => x.id === oppId)?.score ?? 0), 0);
      });
    }
  } finally {
    if (engine) terminateEngine(engine);
  }

  standings.sort((a, b) => b.score - a.score || b.buchholz - a.buchholz || b.rating - a.rating);
  const isComplete = playerDone >= totalPlayerGames;

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
    updated.title = titleFromRating(updated.publicRating);
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
      games: historyGames
    });
    updated.history.tournaments = updated.history.tournaments.slice(0, 30);
    updated.history.games.unshift(...historyGames);
    updated.history.games = updated.history.games.slice(0, 120);
    updated.meta.lastPlayedAt = new Date().toISOString();
    updated.inbox.unshift(`Month ${updated.week}: ${template.name} finished, place #${placement}, ${playerScore.toFixed(1)}/${template.rounds}.`);
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
    totalPlayerGames,
    isComplete
  };
}
