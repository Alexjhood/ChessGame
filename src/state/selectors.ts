import { useAppStore } from './store';

export const useGame = () => useAppStore((s) => s.game);
export const useActions = () => useAppStore((s) => s.actions);
export const useView = () => useAppStore((s) => s.currentView);
export const useSelectedTournament = () => useAppStore((s) => s.selectedTournament);
export const useLastTournament = () => useAppStore((s) => s.lastTournamentResult);
export const useTournamentSim = () => useAppStore((s) => s.tournamentSim);
export const useTournamentStartMode = () => useAppStore((s) => s.tournamentStartMode);
export const useTournamentRevealCount = () => useAppStore((s) => s.tournamentRevealCount);
export const useWatchContext = () => useAppStore((s) => s.watchContext);
export const useSimSettings = () => useAppStore((s) => s.simSettings);
export const usePreviousSkills = () => useAppStore((s) => s.previousSkills);
export const useAvatarDraft = () => useAppStore((s) => s.avatarDraft);
export const useAvatarSetupMode = () => useAppStore((s) => s.avatarSetupMode);
