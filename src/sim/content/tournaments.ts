/*
 * File Purpose: Tournament template content definitions.
 * Key Mechanics: Provides event pools with fees, field sizes, rounds, and prize characteristics consumed each month.
 */

import type { TournamentTemplate } from '../models';

export const tournamentTemplates: TournamentTemplate[] = [
  {
    id: 'school_chess_festival',
    name: 'School Chess Festival',
    tier: 'Starter',
    rounds: 5,
    avgOpponentRating: 780,
    ratingStdDev: 90,
    entryFee: 10,
    travelFatigue: 3,
    prizePool: 120,
    payoutScale: { first: 0.34, second: 0.24, third: 0.16, top8: 0.05 },
    minEloReq: 0,
    reputationReq: 0
  },
  {
    id: 'park_weekend_open',
    name: 'Park Weekend Open',
    tier: 'Starter',
    rounds: 6,
    avgOpponentRating: 860,
    ratingStdDev: 100,
    entryFee: 18,
    travelFatigue: 4,
    prizePool: 220,
    payoutScale: { first: 0.36, second: 0.24, third: 0.14, top8: 0.05 },
    minEloReq: 700,
    reputationReq: 0
  },
  {
    id: 'city_swiss_open',
    name: 'City Swiss Open',
    tier: 'Club',
    rounds: 7,
    avgOpponentRating: 950,
    ratingStdDev: 120,
    entryFee: 30,
    travelFatigue: 6,
    prizePool: 400,
    payoutScale: { first: 0.4, second: 0.24, third: 0.13, top8: 0.045 },
    minEloReq: 850,
    reputationReq: 0
  },
  {
    id: 'district_youth_cup',
    name: 'District Youth Cup',
    tier: 'Club',
    rounds: 7,
    avgOpponentRating: 1120,
    ratingStdDev: 120,
    entryFee: 55,
    travelFatigue: 8,
    prizePool: 760,
    payoutScale: { first: 0.42, second: 0.24, third: 0.12, top8: 0.04 },
    minEloReq: 1000,
    reputationReq: 6
  },
  {
    id: 'regional_challenger',
    name: 'Regional Challenger',
    tier: 'Regional',
    rounds: 7,
    avgOpponentRating: 1250,
    ratingStdDev: 140,
    entryFee: 80,
    travelFatigue: 9,
    prizePool: 1200,
    payoutScale: { first: 0.45, second: 0.25, third: 0.12, top8: 0.04 },
    minEloReq: 1150,
    reputationReq: 10
  },
  {
    id: 'state_junior_masters',
    name: 'State Junior Masters',
    tier: 'Regional',
    rounds: 8,
    avgOpponentRating: 1420,
    ratingStdDev: 150,
    entryFee: 110,
    travelFatigue: 10,
    prizePool: 1800,
    payoutScale: { first: 0.47, second: 0.24, third: 0.11, top8: 0.038 },
    minEloReq: 1325,
    reputationReq: 18
  },
  {
    id: 'masters_weekend',
    name: 'Masters Weekend Swiss',
    tier: 'National',
    rounds: 9,
    avgOpponentRating: 1550,
    ratingStdDev: 170,
    entryFee: 140,
    travelFatigue: 12,
    prizePool: 3200,
    payoutScale: { first: 0.5, second: 0.23, third: 0.1, top8: 0.035 },
    minEloReq: 1450,
    reputationReq: 25
  },
  {
    id: 'national_candidate_open',
    name: 'National Candidate Open',
    tier: 'National',
    rounds: 9,
    avgOpponentRating: 1780,
    ratingStdDev: 180,
    entryFee: 220,
    travelFatigue: 14,
    prizePool: 5200,
    payoutScale: { first: 0.52, second: 0.22, third: 0.095, top8: 0.03 },
    minEloReq: 1650,
    reputationReq: 34
  },
  {
    id: 'continental_invitational',
    name: 'Continental Invitational',
    tier: 'Elite',
    rounds: 9,
    avgOpponentRating: 2050,
    ratingStdDev: 170,
    entryFee: 350,
    travelFatigue: 16,
    prizePool: 9000,
    payoutScale: { first: 0.55, second: 0.2, third: 0.09, top8: 0.028 },
    minEloReq: 1900,
    reputationReq: 50
  },
  {
    id: 'global_grand_prix',
    name: 'Global Grand Prix',
    tier: 'Elite',
    rounds: 10,
    avgOpponentRating: 2320,
    ratingStdDev: 140,
    entryFee: 600,
    travelFatigue: 20,
    prizePool: 18000,
    payoutScale: { first: 0.58, second: 0.19, third: 0.08, top8: 0.025 },
    minEloReq: 2200,
    reputationReq: 72
  }
];
