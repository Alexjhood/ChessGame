import type { TrainingModule } from '../models';

export const trainingModules: TrainingModule[] = [
  {
    id: 'opening_lab',
    label: 'Opening Lab',
    description: 'Build principled opening play and practical first 10-move plans.',
    focusSkill: 'openingElo',
    effects: { openingElo: 18, studySkills: 2 },
    fatigueDelta: 2,
    costMoney: 0
  },
  {
    id: 'middlegame_patterns',
    label: 'Middlegame Patterns',
    description: 'Improve plans, piece activity, and calculation in rich positions.',
    focusSkill: 'middlegameElo',
    effects: { middlegameElo: 18, studySkills: 1 },
    fatigueDelta: 3,
    costMoney: 0
  },
  {
    id: 'endgame_bootcamp',
    label: 'Endgame Bootcamp',
    description: 'Sharpen endgame conversion and technical precision.',
    focusSkill: 'endgameElo',
    effects: { endgameElo: 18, resilience: 2 },
    fatigueDelta: 1,
    costMoney: 0
  },
  {
    id: 'resilience_focus',
    label: 'Resilience Training',
    description: 'Recover better from pressure and reduce fatigue-related mistakes.',
    focusSkill: 'resilience',
    effects: { resilience: 18, studySkills: 1 },
    fatigueDelta: -3,
    costMoney: 0
  },
  {
    id: 'competitive_scrims',
    label: 'Competitive Scrims',
    description: 'Practice comebacks and sharp practical fighting play.',
    focusSkill: 'competitiveness',
    effects: { competitiveness: 18, middlegameElo: 3 },
    fatigueDelta: 4,
    costMoney: 0
  },
  {
    id: 'study_habits_lab',
    label: 'Study Habits Lab',
    description: 'Improve puzzle volume capacity (+1 monthly puzzle attempt per configured study step).',
    focusSkill: 'studySkills',
    effects: { studySkills: 20, openingElo: 2 },
    fatigueDelta: 1,
    costMoney: 0
  }
];
