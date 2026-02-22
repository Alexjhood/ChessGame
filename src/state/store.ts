/*
 * File Purpose: Central game state store and actions.
 * Key Mechanics: Manages persistence, route transitions, training/tournament actions, simulation settings, and replay contexts.
 */

import { create } from 'zustand';
import { tournamentTemplates } from '../sim/content/tournaments';
import { trainingModules } from '../sim/content/trainingModules';
import type { GameState, Opponent, TournamentTemplate, TrainingModule } from '../sim/models';
import { runSwissTournament, runSwissTournamentWithEngine, type SimRoundGame } from '../sim/tournaments';
import { applyTrainingMonth, createInitialState } from '../sim/weekly';
import { DEFAULT_SIM_SETTINGS, sanitizeSimSettings, setSimSettings, type SimSettings } from '../sim/settings';
import { DEFAULT_AVATAR, type AvatarProfile } from '../sim/avatar';
import { generateOpponents } from '../sim/opponents';
import { createRng } from '../sim/rng';

const SAVE_KEY = 'prodigy_chess_tycoon_save_v1';
const SETTINGS_KEY = 'prodigy_chess_tycoon_settings_v1';

export interface WatchContext {
  game: SimRoundGame;
  week: number;
  tournamentName: string;
}

export interface TournamentSimState {
  running: boolean;
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
  errorCode?: 'ENGINE_UNAVAILABLE' | 'SIM_FAILED';
}

type TournamentStartMode = 'all' | 'next' | 'watch_next';

interface AppState {
  game: GameState | null;
  previousSkills: GameState['skills'] | null;
  avatarDraft: AvatarProfile;
  avatarSetupMode: 'new' | 'restart' | null;
  simSettings: SimSettings;
  currentView: 'home' | 'avatar_setup' | 'dashboard' | 'training' | 'tournament' | 'history' | 'sandbox' | 'live';
  selectedTournament: TournamentTemplate | null;
  lastTournamentResult: {
    template: TournamentTemplate;
    prizePool: number;
    paidPlaces: number;
    isComplete: boolean;
    simulatedPlayerGames: number;
    totalPlayerGames: number;
    standings: { name: string; score: number; rating: number; ratingDelta: number; isHuman?: boolean }[];
    games: SimRoundGame[];
  } | null;
  tournamentSim: TournamentSimState | null;
  tournamentStartMode: TournamentStartMode | null;
  tournamentRevealCount: number;
  watchContext: WatchContext | null;
  actions: {
    beginNewCareer: () => void;
    beginRestartCareer: () => void;
    finalizeAvatarSetup: () => void;
    updateAvatarDraft: (patch: Partial<AvatarProfile>) => void;
    cancelAvatarSetup: () => void;
    continueCareer: () => void;
    trainMonth: (modules: TrainingModule[], coachingPurchases: number, puzzleCreditsEarned: number) => void;
    chooseTournament: (template: TournamentTemplate) => void;
    clearTournamentSelection: () => void;
    watchNextTournamentGame: (template: TournamentTemplate) => void;
    runTournament: (template: TournamentTemplate, mode?: TournamentStartMode) => Promise<void>;
    runTournamentEloOnly: (template: TournamentTemplate, mode?: TournamentStartMode) => void;
    consumeTournamentStartMode: () => void;
    setTournamentRevealCount: (count: number) => void;
    finishTournamentMonth: () => void;
    prepareWatch: (game: SimRoundGame, tournamentName: string) => void;
    save: () => void;
    loadLocal: () => boolean;
    restartCareer: () => void;
    wipeCareer: () => void;
    loadFromJson: (raw: string) => { ok: boolean; error?: string };
    exportSave: () => string | null;
    updateSimSetting: (section: keyof SimSettings, key: string, value: number) => void;
    resetSimSettings: () => void;
    setView: (view: AppState['currentView']) => void;
    addWatchedGamePgn: (pgn: string, result: '1-0' | '0-1' | '1/2-1/2', white: string, black: string) => void;
  };
}

function safeParse(raw: string | null): GameState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as GameState;
    if (!parsed.meta || !parsed.skills || typeof parsed.week !== 'number') return null;
    return normalizeGameState(parsed);
  } catch {
    return null;
  }
}

function normalizeGameState(state: GameState): GameState {
  const next = structuredClone(state);
  next.coachingPurchases ??= 0;
  next.avatar = { ...DEFAULT_AVATAR, ...(next.avatar ?? {}) };
  delete (next.avatar as { gender?: unknown }).gender;
  next.skills.openingElo ??= next.publicRating;
  next.skills.middlegameElo ??= next.publicRating;
  next.skills.endgameElo ??= next.publicRating;
  next.skills.resilience ??= next.publicRating;
  next.skills.competitiveness ??= next.publicRating;
  next.skills.studySkills ??= 0;
  next.recentSkillDeltas ??= {
    openingElo: 0,
    middlegameElo: 0,
    endgameElo: 0,
    resilience: 0,
    competitiveness: 0,
    studySkills: 0
  };
  const defaults = {
    openingElo: 0,
    middlegameElo: 0,
    endgameElo: 0,
    resilience: 0,
    competitiveness: 0,
    studySkills: 0
  };
  next.trainingCounts ??= { ...defaults };
  (Object.keys(defaults) as Array<keyof typeof defaults>).forEach((key) => {
    next.trainingCounts[key] ??= 0;
  });
  next.skills.studySkills ??= 0;
  next.inbox = (next.inbox ?? []).slice(0, 3);
  return next;
}

export const useAppStore = create<AppState>((set, get) => ({
  game: null,
  previousSkills: null,
  avatarDraft: structuredClone(DEFAULT_AVATAR),
  avatarSetupMode: null,
  simSettings: (() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
      const settings = sanitizeSimSettings(parsed);
      setSimSettings(settings);
      return settings;
    } catch {
      setSimSettings(DEFAULT_SIM_SETTINGS);
      return structuredClone(DEFAULT_SIM_SETTINGS);
    }
  })(),
  currentView: 'home',
  selectedTournament: null,
  lastTournamentResult: null,
  tournamentSim: null,
  tournamentStartMode: null,
  tournamentRevealCount: 0,
  watchContext: null,
  actions: {
    beginNewCareer: () => {
      set({
        avatarDraft: structuredClone(DEFAULT_AVATAR),
        avatarSetupMode: 'new',
        currentView: 'avatar_setup'
      });
    },
    beginRestartCareer: () => {
      const state = get();
      const source = state.game?.avatar ?? DEFAULT_AVATAR;
      set({
        avatarDraft: structuredClone(source),
        avatarSetupMode: 'restart',
        currentView: 'avatar_setup'
      });
    },
    finalizeAvatarSetup: () => {
      const state = get();
      const game = createInitialState(Date.now(), state.avatarDraft);
      set({
        game,
        previousSkills: null,
        currentView: 'dashboard',
        avatarSetupMode: null,
        lastTournamentResult: null,
        selectedTournament: null,
        tournamentSim: null,
        tournamentStartMode: null,
        tournamentRevealCount: 0,
        watchContext: null
      });
      localStorage.setItem(SAVE_KEY, JSON.stringify(game));
    },
    updateAvatarDraft: (patch) => {
      set((state) => ({ avatarDraft: { ...state.avatarDraft, ...patch } }));
    },
    cancelAvatarSetup: () => {
      const state = get();
      set({ currentView: state.avatarSetupMode === 'restart' ? 'dashboard' : 'home', avatarSetupMode: null });
    },
    continueCareer: () => {
      const loaded = safeParse(localStorage.getItem(SAVE_KEY));
      if (loaded) {
        set({
          game: loaded,
          previousSkills: null,
          currentView: 'dashboard',
          selectedTournament: null,
          lastTournamentResult: null,
          tournamentSim: null,
          tournamentStartMode: null,
          tournamentRevealCount: 0,
          watchContext: null
        });
      } else {
        const game = createInitialState();
        set({
          game,
          previousSkills: null,
          currentView: 'dashboard',
          selectedTournament: null,
          lastTournamentResult: null,
          tournamentSim: null,
          tournamentStartMode: null,
          tournamentRevealCount: 0,
          watchContext: null
        });
      }
    },
    trainMonth: (modules, coachingPurchases, puzzleCreditsEarned) => {
      const state = get();
      if (!state.game) return;
      const nextGame = applyTrainingMonth(state.game, modules, coachingPurchases, puzzleCreditsEarned);
      set({ game: nextGame, previousSkills: state.game.skills, currentView: 'dashboard' });
      localStorage.setItem(SAVE_KEY, JSON.stringify(nextGame));
    },
    chooseTournament: (template) => {
      set({
        currentView: 'tournament',
        selectedTournament: template,
        lastTournamentResult: null,
        tournamentSim: null,
        tournamentStartMode: null,
        tournamentRevealCount: 0
      });
    },
    clearTournamentSelection: () => {
      set({ selectedTournament: null, lastTournamentResult: null, tournamentSim: null, tournamentStartMode: null, tournamentRevealCount: 0 });
    },
    watchNextTournamentGame: (template) => {
      const state = get();
      if (!state.game) return;
      const seed = state.game.meta.seed + state.game.week * 9973 + 41;
      const rng = createRng(seed);
      const opp = generateOpponents(seed, 1, template.avgOpponentRating, template.ratingStdDev)[0];
      if (!opp) return;

      const player: Opponent = {
        id: 'player',
        name: state.game.avatar.name,
        publicRating: state.game.publicRating,
        style: 'Solid',
        skills: state.game.skills
      };

      const game: SimRoundGame = rng.next() < 0.5
        ? { round: 1, white: player, black: opp, result: '1/2-1/2' }
        : { round: 1, white: opp, black: player, result: '1/2-1/2' };

      set({
        selectedTournament: template,
        currentView: 'live',
        watchContext: {
          game,
          week: state.game.week,
          tournamentName: template.name
        }
      });
    },
    runTournament: async (template, mode = 'all') => {
      const state = get();
      if (!state.game) return;
      const existing =
        state.lastTournamentResult && state.lastTournamentResult.template.id === template.id ? state.lastTournamentResult : null;
      const alreadySimulated = existing?.simulatedPlayerGames ?? 0;
      const presetPlayerGames = (existing?.games ?? [])
        .filter((g) => g.white.id === 'player' || g.black.id === 'player')
        .slice(0, alreadySimulated);
      const maxPlayerGames = mode === 'all' ? template.rounds : Math.min(template.rounds, alreadySimulated + 1);
      set({
        currentView: 'tournament',
        selectedTournament: template,
        tournamentStartMode: mode,
        tournamentSim: {
          running: true,
          playerDone: 0,
          playerTotal: template.rounds,
          gamesDone: 0,
          gamesTotal: template.rounds * 16,
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
        },
        tournamentRevealCount: alreadySimulated,
        lastTournamentResult: existing
      });
      try {
        const result = await runSwissTournamentWithEngine(
          state.game,
          template,
          (progress) =>
            set({
              tournamentSim: {
                running: true,
                playerDone: progress.playerDone,
                playerTotal: progress.playerTotal,
                gamesDone: progress.gamesDone,
                gamesTotal: progress.gamesTotal,
                round: progress.round,
                board: progress.board,
                message: progress.message,
                currentWhite: progress.currentWhite,
                currentBlack: progress.currentBlack,
                currentWhiteElo: progress.currentWhiteElo,
                currentBlackElo: progress.currentBlackElo,
                currentPly: progress.currentPly,
                currentFullMove: progress.currentFullMove,
                evalWhiteCp: progress.evalWhiteCp
              }
            }),
          { maxPlayerGames, presetPlayerGames }
        );
        set({
          game: result.isComplete ? result.updatedState : state.game,
          previousSkills: result.isComplete ? state.game.skills : state.previousSkills,
          currentView: 'tournament',
          selectedTournament: template,
          tournamentSim: null,
          tournamentRevealCount: result.simulatedPlayerGames,
          lastTournamentResult: {
            template,
            prizePool: result.prizePool,
            paidPlaces: result.paidPlaces,
            isComplete: result.isComplete,
            simulatedPlayerGames: result.simulatedPlayerGames,
            totalPlayerGames: result.totalPlayerGames,
            standings: result.standings.map((s) => ({
              name: s.name,
              score: s.score,
              rating: s.rating,
              ratingDelta: s.rating - s.initialRating,
              isHuman: s.isHuman
            })),
            games: result.roundGames
          },
          watchContext: {
            game: result.watchedCandidate,
            week: state.game.week,
            tournamentName: template.name
          }
        });
        if (result.isComplete) {
          localStorage.setItem(SAVE_KEY, JSON.stringify(result.updatedState));
        }
      } catch (err) {
        const engineUnavailable = err instanceof Error && err.message.includes('ENGINE_UNAVAILABLE');
        const detail = err instanceof Error ? err.message : 'unknown simulation error';
        set({
          tournamentSim: {
            running: false,
            playerDone: 0,
            playerTotal: 0,
            gamesDone: 0,
            gamesTotal: 0,
            round: 0,
            board: 0,
            message: engineUnavailable
              ? `Stockfish is unavailable (${detail}). Retry or simulate full tournament (Elo/probability only).`
              : `Simulation failed (${detail}). Retry or use Elo-only simulation.`,
            currentWhite: undefined,
            currentBlack: undefined,
            currentWhiteElo: undefined,
            currentBlackElo: undefined,
            currentPly: undefined,
            currentFullMove: undefined,
            evalWhiteCp: undefined,
            errorCode: engineUnavailable ? 'ENGINE_UNAVAILABLE' : 'SIM_FAILED'
          },
          currentView: 'tournament'
        });
      }
    },
    runTournamentEloOnly: (template, mode = 'all') => {
      const state = get();
      if (!state.game) return;
      const existing =
        state.lastTournamentResult && state.lastTournamentResult.template.id === template.id ? state.lastTournamentResult : null;
      const alreadySimulated = existing?.simulatedPlayerGames ?? 0;
      const presetPlayerGames = (existing?.games ?? [])
        .filter((g) => g.white.id === 'player' || g.black.id === 'player')
        .slice(0, alreadySimulated);
      const maxPlayerGames = mode === 'all' ? template.rounds : Math.min(template.rounds, alreadySimulated + 1);
      // Use fast Elo/probability tournament simulation without Stockfish.
      const fallbackRun = runSwissTournament(state.game, template, {
        useSkillAverageForAllGames: true,
        maxPlayerGames,
        presetPlayerGames
      });
      set({
        game: fallbackRun.isComplete ? fallbackRun.updatedState : state.game,
        previousSkills: fallbackRun.isComplete ? state.game.skills : state.previousSkills,
        currentView: 'tournament',
        selectedTournament: template,
        tournamentStartMode: mode,
        tournamentRevealCount: fallbackRun.simulatedPlayerGames,
        tournamentSim: null,
        lastTournamentResult: {
          template,
          prizePool: fallbackRun.prizePool,
          paidPlaces: fallbackRun.paidPlaces,
          isComplete: fallbackRun.isComplete,
          simulatedPlayerGames: fallbackRun.simulatedPlayerGames,
          totalPlayerGames: fallbackRun.totalPlayerGames,
          standings: fallbackRun.standings.map((s) => ({
            name: s.name,
            score: s.score,
            rating: s.rating,
            ratingDelta: s.rating - s.initialRating,
            isHuman: s.isHuman
          })),
          games: fallbackRun.roundGames
        },
        watchContext: {
          game: fallbackRun.watchedCandidate,
          week: state.game.week,
          tournamentName: template.name
        }
      });
      if (fallbackRun.isComplete) {
        localStorage.setItem(SAVE_KEY, JSON.stringify(fallbackRun.updatedState));
      }
    },
    consumeTournamentStartMode: () => set({ tournamentStartMode: null }),
    setTournamentRevealCount: (count) => set({ tournamentRevealCount: Math.max(0, Math.floor(count)) }),
    finishTournamentMonth: () => {
      set({
        currentView: 'dashboard',
        selectedTournament: null,
        lastTournamentResult: null,
        tournamentSim: null,
        tournamentStartMode: null,
        tournamentRevealCount: 0,
        watchContext: null
      });
    },
    prepareWatch: (game, tournamentName) => {
      const state = get();
      if (!state.game) return;
      set({
        watchContext: {
          game,
          week: state.game.week,
          tournamentName
        },
        currentView: 'live'
      });
    },
    save: () => {
      const game = get().game;
      if (!game) return;
      localStorage.setItem(SAVE_KEY, JSON.stringify(game));
    },
    loadLocal: () => {
      const loaded = safeParse(localStorage.getItem(SAVE_KEY));
      if (!loaded) return false;
      set({
        game: loaded,
        currentView: 'dashboard',
        selectedTournament: null,
        lastTournamentResult: null,
        tournamentSim: null,
        tournamentStartMode: null,
        tournamentRevealCount: 0,
        watchContext: null
      });
      return true;
    },
    restartCareer: () => {
      const next = createInitialState();
      set({
        game: next,
        previousSkills: null,
        avatarDraft: structuredClone(next.avatar),
        avatarSetupMode: null,
        currentView: 'dashboard',
        selectedTournament: null,
        lastTournamentResult: null,
        tournamentSim: null,
        tournamentStartMode: null,
        tournamentRevealCount: 0,
        watchContext: null
      });
      localStorage.setItem(SAVE_KEY, JSON.stringify(next));
    },
    wipeCareer: () => {
      localStorage.removeItem(SAVE_KEY);
      set({
        game: null,
        previousSkills: null,
        currentView: 'home',
        selectedTournament: null,
        lastTournamentResult: null,
        tournamentSim: null,
        tournamentStartMode: null,
        tournamentRevealCount: 0,
        watchContext: null
      });
    },
    loadFromJson: (raw) => {
      try {
        const parsed = JSON.parse(raw) as GameState;
        if (!parsed.meta || !parsed.skills) {
          return { ok: false, error: 'Invalid save payload.' };
        }
        const normalized = normalizeGameState(parsed);
        set({
          game: normalized,
          previousSkills: null,
          currentView: 'dashboard',
          selectedTournament: null,
          lastTournamentResult: null,
          tournamentSim: null,
          tournamentStartMode: null,
          tournamentRevealCount: 0,
          watchContext: null
        });
        localStorage.setItem(SAVE_KEY, JSON.stringify(normalized));
        return { ok: true };
      } catch {
        return { ok: false, error: 'Could not parse JSON.' };
      }
    },
    exportSave: () => {
      const game = get().game;
      if (!game) return null;
      return JSON.stringify(game, null, 2);
    },
    updateSimSetting: (section, key, value) => {
      const state = get();
      const next: SimSettings = structuredClone(state.simSettings);
      (next[section] as Record<string, number>)[key] = value;
      const sanitized = sanitizeSimSettings(next);
      setSimSettings(sanitized);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(sanitized));
      set({ simSettings: sanitized });
    },
    resetSimSettings: () => {
      const next = structuredClone(DEFAULT_SIM_SETTINGS);
      setSimSettings(next);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      set({ simSettings: next });
    },
    setView: (view) => set({ currentView: view }),
    addWatchedGamePgn: (pgn, result, white, black) => {
      const state = get();
      if (!state.game) return;
      const next = structuredClone(state.game);
      next.history.games.unshift({
        id: `watched_${Date.now()}`,
        white,
        black,
        result,
        pgn,
        round: 0,
        watched: true,
        tournamentId: state.watchContext?.tournamentName ?? 'feature'
      });
      next.history.games = next.history.games.slice(0, 120);
      set({ game: next, previousSkills: state.previousSkills });
      localStorage.setItem(SAVE_KEY, JSON.stringify(next));
    }
  }
}));

export { SAVE_KEY, trainingModules, tournamentTemplates };

export function makeOpponentFromGameSide(name: string, baseRating: number, style: Opponent['style']): Opponent {
  return {
    id: `${name}_${baseRating}`,
    name,
    publicRating: baseRating,
    style,
      skills: {
        openingElo: baseRating,
        middlegameElo: baseRating,
        endgameElo: baseRating,
        resilience: baseRating,
        competitiveness: baseRating,
        studySkills: 0
      }
  };
}
