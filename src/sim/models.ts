export type Title = 'None' | 'CM' | 'FM' | 'IM' | 'GM' | 'WC';

export type StyleTag = 'Solid' | 'Tactical' | 'Aggressive' | 'Endgame';

import type { AvatarProfile } from './avatar';

export interface SkillRatings {
  openingElo: number;
  middlegameElo: number;
  endgameElo: number;
  resilience: number;
  competitiveness: number;
  studySkills: number;
}

export interface Inventory {
  tools: string[];
  coaches: string[];
}

export interface Opponent {
  id: string;
  name: string;
  publicRating: number;
  style: StyleTag;
  skills: SkillRatings;
}

export interface GameRecord {
  id: string;
  white: string;
  black: string;
  result: '1-0' | '0-1' | '1/2-1/2';
  pgn?: string;
  round: number;
  watched: boolean;
  tournamentId: string;
}

export interface TournamentHistory {
  id: string;
  name: string;
  week: number;
  rounds: number;
  placement: number;
  score: number;
  ratingDelta: number;
  prize: number;
  games: GameRecord[];
}

export interface SponsorContract {
  id: string;
  name: string;
  weeklyBonus: number;
  repReq: number;
}

export interface History {
  tournaments: TournamentHistory[];
  games: GameRecord[];
  sponsors: SponsorContract[];
}

export interface GameMeta {
  version: string;
  seed: number;
  createdAt: string;
  lastPlayedAt: string;
}

export interface GameState {
  meta: GameMeta;
  week: number;
  ageYears: number;
  publicRating: number;
  title: Title;
  money: number;
  reputation: number;
  fatigue: number;
  confidence: number;
  coachingPurchases: number;
  avatar: AvatarProfile;
  skills: SkillRatings;
  recentSkillDeltas: Partial<Record<keyof SkillRatings, number>>;
  trainingCounts: Record<keyof SkillRatings, number>;
  inventory: Inventory;
  history: History;
  inbox: string[];
}

export interface TrainingModule {
  id: string;
  label: string;
  description: string;
  focusSkill: keyof SkillRatings;
  effects: Partial<SkillRatings>;
  fatigueDelta: number;
  costMoney: number;
  unlockReq?: {
    reputation?: number;
    money?: number;
  };
}

export interface TournamentTemplate {
  id: string;
  name: string;
  tier?: string;
  rounds: number;
  avgOpponentRating: number;
  ratingStdDev: number;
  entryFee: number;
  travelFatigue: number;
  prizePool: number;
  payoutScale?: {
    first: number;
    second: number;
    third: number;
    top8: number;
  };
  minEloReq?: number;
  reputationReq: number;
}

export interface RoundPairing {
  white: Opponent;
  black: Opponent;
}

export interface SwissPlayer {
  id: string;
  name: string;
  initialRating: number;
  rating: number;
  score: number;
  oppIds: string[];
  buchholz: number;
  isHuman?: boolean;
}

export interface SwissRound {
  round: number;
  pairings: RoundPairing[];
}
