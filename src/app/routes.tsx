/*
 * File Purpose: Primary route and screen composition for gameplay.
 * Key Mechanics: Defines home/dashboard/training/tournament/live flows, puzzle interactions, controls, and tutorial sequencing.
 */

import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import {
  useActions,
  useAvatarDraft,
  useAvatarSetupMode,
  useGame,
  useLastTournament,
  useSelectedTournament,
  useSimSettings,
  useTournamentSim,
  useTournamentStartMode,
  useView,
  useWatchContext
} from '../state/selectors';
import { trainingModules, tournamentTemplates } from '../state/store';
import { ChessBoard } from '../ui/board/ChessBoard';
import { LiveWatch } from '../ui/tournament/LiveWatch';
import { TITLE_LEVELS } from '../sim/titles';
import {
  coachingCostForBatch,
  coachingCostForPurchaseIndex,
  puzzleAttemptsForState,
  puzzleLambdaForElo,
  samplePoisson,
  trainingCreditsForState,
  trainingMeanGain
} from '../sim/weekly';
import type { GameState, SkillRatings } from '../sim/models';
import { paidPlacesRangeForField, payoutForPlace, payoutsForField, prizePoolRangeForEntryFee } from '../sim/payout';
import { monthlyTournamentPool } from '../sim/tournamentPool';
import {
  fetchPuzzleNearElo,
  getPuzzleCacheStats,
  type PuzzleChallenge,
  type PuzzleCacheStats
} from '../sim/puzzles';
import {
  AVATAR_HAIR_COLORS,
  AVATAR_HAIR_STYLES,
  AVATAR_SKIN_TONES,
  type AvatarProfile
} from '../sim/avatar';

const TUTORIAL_DISMISSED_KEY = 'prodigy_chess_tutorial_dismissed_v1';

function readTutorialDismissed(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeTutorialDismissed(value: boolean): void {
  try {
    localStorage.setItem(TUTORIAL_DISMISSED_KEY, value ? '1' : '0');
  } catch {
    // no-op for private browsing/storage-denied cases
  }
}

function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function cycleOption<T>(arr: T[], current: T, dir: -1 | 1): T {
  const idx = arr.findIndex((v) => v === current);
  const base = idx === -1 ? 0 : idx;
  const next = (base + dir + arr.length) % arr.length;
  return arr[next]!;
}

function AvatarPreview({ avatar }: { avatar: AvatarProfile }) {
  return (
    <div
      className={`chibi-avatar hair-${avatar.hairStyle.toLowerCase()}`}
      style={{ ['--hair-color' as string]: avatar.hairColor, ['--skin-tone' as string]: avatar.skinTone }}
      aria-hidden="true"
    >
      <div className="hair" />
      <div className="face">
        <span className="eye left" />
        <span className="eye right" />
        {avatar.glasses ? <span className="glasses" /> : null}
        <span className="smile" />
      </div>
      <div className="body" />
    </div>
  );
}

function EloMeter({ label, value, delta }: { label: string; value: number; delta?: number }) {
  const pct = Math.max(0, Math.min(100, ((value - 700) / 1600) * 100));
  return (
    <div className="elo-meter">
      <div className="elo-head">
        <span className="elo-title">{label}</span>
        <strong>
          {value}
          {delta && delta > 0 ? <span className="elo-delta"> +{delta}</span> : null}
        </strong>
      </div>
      <div className="elo-track">
        <div className="elo-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function TitleJourney({ rating }: { rating: number }) {
  const currentIndex = TITLE_LEVELS.map((t) => t.key).lastIndexOf(
    TITLE_LEVELS.filter((t) => rating >= t.minRating).slice(-1)[0]?.key ?? 'None'
  );
  const next = TITLE_LEVELS[currentIndex + 1] ?? null;
  const base = TITLE_LEVELS[currentIndex]?.minRating ?? 0;
  const toward = next ? Math.max(0, Math.min(100, ((rating - base) / (next.minRating - base)) * 100)) : 100;

  return (
    <div className="title-journey">
      <div className="title-current" style={{ borderColor: TITLE_LEVELS[currentIndex]?.color }}>
        <span className="title-label">Current Title</span>
        <strong>{TITLE_LEVELS[currentIndex]?.key ?? 'None'}</strong>
      </div>
      <div className="title-progress">
        <div className="title-progress-fill" style={{ width: `${toward}%` }} />
      </div>
      <p className="title-next">
        {next ? `Next: ${next.key} at Elo ${next.minRating}` : 'Top Rank Reached: World Champion'}
      </p>
      <div className="title-ladder">
        {TITLE_LEVELS.map((level, idx) => {
          const state = idx < currentIndex ? 'earned' : idx === currentIndex ? 'current' : 'locked';
          return (
            <div key={level.key} className={`title-chip ${state}`} style={{ borderColor: level.color }}>
              <span>{level.key}</span>
              <small>{level.minRating}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const SKILL_LABELS: Record<keyof SkillRatings, string> = {
  openingElo: 'Opening',
  middlegameElo: 'Middlegame',
  endgameElo: 'Endgame',
  resilience: 'Resilience',
  competitiveness: 'Competitiveness',
  studySkills: 'Study Habits'
};

const SKILL_DESCRIPTIONS: Record<keyof SkillRatings, string> = {
  openingElo: 'Controls play quality in the first opening moves (opening max move setting).',
  middlegameElo:
    'Controls play quality from post-opening through move/material transition into endgame (both settings-driven).',
  endgameElo: 'Controls play quality in late positions once move/material endgame conditions are met.',
  resilience:
    'Reduces fatigue penalties and lowers fatigue-driven blunder risk; better resilience means steadier play under stress.',
  competitiveness:
    'If materially behind beyond the configured threshold, grants comeback Elo boost using boostFactor * competitiveness Elo.',
  studySkills:
    'Controls how many puzzles can be attempted each month (1 + floor(study/step)); successful puzzle solving grants extra training credits.'
};

function SkillTooltip({ skill, game }: { skill: keyof SkillRatings; game: GameState }) {
  const current = game.skills[skill];
  const avgGain = trainingMeanGain(game.trainingCounts[skill] ?? 0);
  const projected = Math.round(current + avgGain);
  const valueLabel = skill === 'studySkills' ? 'Current points' : 'Current Elo';
  return (
    <span className="skill-tip-wrap">
      <span className="skill-tip-chip">{SKILL_LABELS[skill]}</span>
      <span className="skill-tip-panel" role="tooltip">
        <strong>{SKILL_LABELS[skill]}</strong>
        <span>
          {valueLabel}: {current}
        </span>
        <span>Avg gain with next study: +{avgGain.toFixed(1)}</span>
        <span>Projected average after study: {projected}</span>
        <span>{SKILL_DESCRIPTIONS[skill]}</span>
      </span>
    </span>
  );
}

function HomeScreen() {
  const actions = useActions();

  const onImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        actions.loadFromJson(reader.result);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="screen home-screen">
      <h1>Tiny Tactics Club</h1>
      <p>Guide your rising chess star month by month from local opens to world-class titles.</p>
      <div className="button-row">
        <button onClick={() => actions.beginNewCareer()}>New Career</button>
        <button onClick={() => actions.continueCareer()}>Continue</button>
        <button onClick={() => actions.loadLocal()}>Load Save</button>
        <button
          onClick={() => {
            if (window.confirm('Clear your local save and return to a fresh start?')) {
              actions.wipeCareer();
            }
          }}
        >
          Full Wipe
        </button>
        <label className="file-label">
          Import Save
          <input
            type="file"
            accept="application/json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onImport(file);
            }}
          />
        </label>
      </div>
    </div>
  );
}

function DashboardScreen() {
  const game = useGame();
  const actions = useActions();
  const simSettings = useSimSettings();
  const [cacheStats, setCacheStats] = useState<PuzzleCacheStats>(() => getPuzzleCacheStats());
  const [tutorialDismissed, setTutorialDismissed] = useState<boolean>(() => readTutorialDismissed());
  const [controlsExpanded, setControlsExpanded] = useState(false);
  useEffect(() => {
    if (!game) actions.continueCareer();
  }, [actions, game]);
  if (!game) return <div className="screen">Loading career...</div>;

  useEffect(() => {
    setCacheStats(getPuzzleCacheStats());
  }, []);
  const tutorialActive = !tutorialDismissed && game.history.tournaments.length === 0 && game.week <= 2;
  const tutorialStepLabel = game.week <= 1 ? 'Training tutorial' : 'Beginner tournament tutorial';
  const fatigueBand = game.fatigue > 40 ? 'critical' : game.fatigue > 20 ? 'warning' : 'ok';

  return (
    <div className="screen dashboard">
      <div className="panel prodigy-card">
        <h2>{game.avatar.name} 🌟</h2>
        <AvatarPreview avatar={game.avatar} />
        <div className="badge-row">
          <span className="badge">🏆 {game.title}</span>
          <span className="badge">📈 Overall Elo {game.publicRating}</span>
        </div>
        <TitleJourney rating={game.publicRating} />
        <StatRow label="Age" value={game.ageYears.toFixed(2)} />
        <StatRow label="Rating" value={game.publicRating} />
        <StatRow label="Title" value={game.title} />
      </div>

      <div className="panel skill-panel">
        <h2>Skill Elos</h2>
        <p className="cute-note">
          Live games use these directly: opening (first opening-limit moves), middlegame (until move/material threshold),
          and endgame. Resilience reduces fatigue errors; competitiveness gives comeback boost when behind in material.
        </p>
        <EloMeter
          label="Opening"
          value={game.skills.openingElo}
          delta={game.recentSkillDeltas.openingElo ?? 0}
        />
        <EloMeter
          label="Middlegame"
          value={game.skills.middlegameElo}
          delta={game.recentSkillDeltas.middlegameElo ?? 0}
        />
        <EloMeter
          label="Endgame"
          value={game.skills.endgameElo}
          delta={game.recentSkillDeltas.endgameElo ?? 0}
        />
        <EloMeter
          label="Resilience"
          value={game.skills.resilience}
          delta={game.recentSkillDeltas.resilience ?? 0}
        />
        <EloMeter
          label="Competitiveness"
          value={game.skills.competitiveness}
          delta={game.recentSkillDeltas.competitiveness ?? 0}
        />
        <EloMeter
          label="Study Skills"
          value={game.skills.studySkills}
          delta={game.recentSkillDeltas.studySkills ?? 0}
        />
      </div>

      <div className="panel week-actions">
        <h2>Month {game.week}</h2>
        {tutorialActive ? (
          <div className="tutorial-box">
            <h3>🎓 First-Time Tutorial</h3>
            <p>
              Current step: <strong>{tutorialStepLabel}</strong>. Follow the guided highlights to complete your first month.
            </p>
            <div className="button-row">
              <button onClick={() => actions.setView(game.week <= 1 ? 'training' : 'tournament')}>
                Go To {game.week <= 1 ? 'Training' : 'Tournament'}
              </button>
              <button
                onClick={() => {
                  writeTutorialDismissed(true);
                  setTutorialDismissed(true);
                }}
              >
                Close Tutorial
              </button>
            </div>
          </div>
        ) : null}
        <p className="cute-note">🌈 One big choice this month. Keep balance between growth and performance.</p>
        <p>Pick one major action this month.</p>
        <p>
          Training credits this month: <strong>{trainingCreditsForState(game)}</strong>
        </p>
        <div className="action-grid">
          <button onClick={() => actions.setView('training')}>Train</button>
          <button onClick={() => actions.setView('tournament')}>Tournament</button>
        </div>
        <div className="inbox">
          <h3>Inbox</h3>
          <ul>
            {game.inbox.slice(0, 3).map((item, idx) => (
              <li key={`${item}-${idx}`}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="panel stats-summary">
        <h2>Status</h2>
        <StatRow label="Money" value={`$${game.money}`} />
        <StatRow label="Reputation" value={game.reputation} />
        <StatRow label="Fatigue" value={game.fatigue} />
        <StatRow label="Confidence" value={game.confidence} />
        {fatigueBand !== 'ok' ? (
          <p className={`fatigue-alert fatigue-alert-${fatigueBand}`}>
            {fatigueBand === 'critical'
              ? 'Critical fatigue (>40): high blunder risk. You should rest this month.'
              : 'Fatigue warning (>20): consider resting this month to recover.'}{' '}
            Open <strong>Train</strong>, leave credits unspent, then click <strong>Advance Month (Rest & Recover)</strong>.
          </p>
        ) : null}
      </div>

      <div className="panel control-dock">
        <div className="training-section-head">
          <h2>Controls</h2>
          <button className="section-toggle-btn" onClick={() => setControlsExpanded((v) => !v)}>
            {controlsExpanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
        {controlsExpanded ? (
          <>
            <div className="control-buttons">
              <button onClick={() => actions.setView('history')}>History</button>
              <button onClick={() => actions.save()}>Save Now</button>
              <button onClick={() => actions.loadLocal()}>Load Save</button>
              <button
                onClick={() => {
                  if (window.confirm('Restart career from age 8? This overwrites the current save.')) {
                    actions.beginRestartCareer();
                  }
                }}
              >
                Restart Career
              </button>
              <button
                onClick={() => {
                  if (window.confirm('Fully wipe local save and return home?')) {
                    actions.wipeCareer();
                  }
                }}
              >
                Full Wipe
              </button>
              <button
                onClick={() => {
                  const payload = actions.exportSave();
                  if (!payload) return;
                  const blob = new Blob([payload], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'tiny_tactics_club_save_v1.json';
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Export Save
              </button>
            </div>
            <details>
              <summary>Simulation Settings</summary>
              <div className="settings-box">
            <label>
              Starting Elo (new/restart career)
              <input
                type="number"
                value={simSettings.career.startingElo}
                onChange={(e) => actions.updateSimSetting('career', 'startingElo', Number(e.target.value))}
              />
            </label>
            <label>
              Training mean gain base
              <input
                type="number"
                value={simSettings.training.baseMeanGain}
                onChange={(e) => actions.updateSimSetting('training', 'baseMeanGain', Number(e.target.value))}
              />
            </label>
            <label>
              Training decay factor
              <input
                type="number"
                step="0.01"
                value={simSettings.training.decayPerTraining}
                onChange={(e) => actions.updateSimSetting('training', 'decayPerTraining', Number(e.target.value))}
              />
            </label>
            <label>
              Training stddev ratio
              <input
                type="number"
                step="0.01"
                value={simSettings.training.randomStdDevRatio}
                onChange={(e) => actions.updateSimSetting('training', 'randomStdDevRatio', Number(e.target.value))}
              />
            </label>
            <label>
              Base credits/month
              <input
                type="number"
                value={simSettings.training.baseCreditsPerMonth}
                onChange={(e) => actions.updateSimSetting('training', 'baseCreditsPerMonth', Number(e.target.value))}
              />
            </label>
            <label>
              Puzzle attempt step (study points)
              <input
                type="number"
                value={simSettings.training.puzzleAttemptStudyStep}
                onChange={(e) => actions.updateSimSetting('training', 'puzzleAttemptStudyStep', Number(e.target.value))}
              />
            </label>
            <label>
              Puzzle lambda base
              <input
                type="number"
                step="0.1"
                value={simSettings.training.puzzleLambdaBase}
                onChange={(e) => actions.updateSimSetting('training', 'puzzleLambdaBase', Number(e.target.value))}
              />
            </label>
            <label>
              Puzzle lambda step per bucket
              <input
                type="number"
                step="0.1"
                value={simSettings.training.puzzleLambdaStep}
                onChange={(e) => actions.updateSimSetting('training', 'puzzleLambdaStep', Number(e.target.value))}
              />
            </label>
            <label>
              Puzzle lambda start Elo
              <input
                type="number"
                value={simSettings.training.puzzleLambdaStartElo}
                onChange={(e) => actions.updateSimSetting('training', 'puzzleLambdaStartElo', Number(e.target.value))}
              />
            </label>
            <label>
              Puzzle lambda Elo bucket size
              <input
                type="number"
                value={simSettings.training.puzzleLambdaBucketSize}
                onChange={(e) => actions.updateSimSetting('training', 'puzzleLambdaBucketSize', Number(e.target.value))}
              />
            </label>
            <div className="puzzle-dataset-settings">
              <p>
                Total puzzles in dataset: <strong>{cacheStats.total}</strong>
              </p>
              <p className="cute-note">
                Puzzle pulling/diagnostics controls are hidden in-game because this build uses the bundled local dataset.
              </p>
              <p className="cute-note">
                Note: backend puzzle tooling is still available for offline dataset rebuilds from{' '}
                <code>analysis/lichess_db_puzzle.csv.zst</code>.
              </p>
            </div>
            <label>
              Coaching base cost
              <input
                type="number"
                value={simSettings.training.coachingBaseCost}
                onChange={(e) => actions.updateSimSetting('training', 'coachingBaseCost', Number(e.target.value))}
              />
            </label>
            <label>
              Coaching cost step
              <input
                type="number"
                value={simSettings.training.coachingCostStep}
                onChange={(e) => actions.updateSimSetting('training', 'coachingCostStep', Number(e.target.value))}
              />
            </label>
            <label>
              Fatigue recovery per unused credit
              <input
                type="number"
                value={simSettings.training.fatigueRecoveryPerUnusedCredit}
                onChange={(e) =>
                  actions.updateSimSetting('training', 'fatigueRecoveryPerUnusedCredit', Number(e.target.value))
                }
              />
            </label>
            <label>
              Effective Elo cap
              <input
                type="number"
                value={simSettings.performance.maxEffectiveElo}
                onChange={(e) => actions.updateSimSetting('performance', 'maxEffectiveElo', Number(e.target.value))}
              />
            </label>
            <label>
              Opening max move
              <input
                type="number"
                value={simSettings.performance.openingMaxMove}
                onChange={(e) => actions.updateSimSetting('performance', 'openingMaxMove', Number(e.target.value))}
              />
            </label>
            <label>
              Middlegame max move
              <input
                type="number"
                value={simSettings.performance.middlegameMaxMove}
                onChange={(e) => actions.updateSimSetting('performance', 'middlegameMaxMove', Number(e.target.value))}
              />
            </label>
            <label>
              Endgame material trigger (side points)
              <input
                type="number"
                value={simSettings.performance.middlegameMinSideMaterialPoints}
                onChange={(e) =>
                  actions.updateSimSetting('performance', 'middlegameMinSideMaterialPoints', Number(e.target.value))
                }
              />
            </label>
            <label>
              Competitiveness boost factor
              <input
                type="number"
                step="0.01"
                value={simSettings.performance.competitivenessBoostFactor}
                onChange={(e) =>
                  actions.updateSimSetting('performance', 'competitivenessBoostFactor', Number(e.target.value))
                }
              />
            </label>
            <label>
              Competitiveness deficit threshold (piece points)
              <input
                type="number"
                step="0.5"
                value={simSettings.performance.competitivenessDeficitPoints}
                onChange={(e) =>
                  actions.updateSimSetting('performance', 'competitivenessDeficitPoints', Number(e.target.value))
                }
              />
            </label>
            <label>
              Fatigue blunder boost at max fatigue
              <input
                type="number"
                step="0.01"
                value={simSettings.performance.fatigueBlunderBoostAtMax}
                onChange={(e) =>
                  actions.updateSimSetting('performance', 'fatigueBlunderBoostAtMax', Number(e.target.value))
                }
              />
            </label>
            <label>
              Sub-1350 decision spread calibration
              <input
                type="number"
                step="0.05"
                value={simSettings.performance.sub1350DecisionSpread}
                onChange={(e) => actions.updateSimSetting('performance', 'sub1350DecisionSpread', Number(e.target.value))}
              />
            </label>
            <label>
              Stockfish draw start move
              <input
                type="number"
                value={simSettings.performance.stockfishDrawStartMove}
                onChange={(e) => actions.updateSimSetting('performance', 'stockfishDrawStartMove', Number(e.target.value))}
              />
            </label>
            <label>
              Stockfish draw base chance (0-1)
              <input
                type="number"
                step="0.001"
                value={simSettings.performance.stockfishDrawBaseChance}
                onChange={(e) => actions.updateSimSetting('performance', 'stockfishDrawBaseChance', Number(e.target.value))}
              />
            </label>
            <label>
              Stockfish draw chance increase per move (0-1)
              <input
                type="number"
                step="0.0001"
                value={simSettings.performance.stockfishDrawIncrementPerMove}
                onChange={(e) =>
                  actions.updateSimSetting('performance', 'stockfishDrawIncrementPerMove', Number(e.target.value))
                }
              />
            </label>
            <label>
              Stockfish draw balance threshold (pawn points)
              <input
                type="number"
                step="0.1"
                value={simSettings.performance.stockfishDrawBalancedThresholdPoints}
                onChange={(e) =>
                  actions.updateSimSetting('performance', 'stockfishDrawBalancedThresholdPoints', Number(e.target.value))
                }
              />
            </label>
                <button onClick={() => actions.resetSimSettings()}>Reset Settings</button>
              </div>
            </details>
          </>
        ) : (
          <p className="cute-note">Controls are collapsed.</p>
        )}
      </div>
    </div>
  );
}

function AvatarSetupScreen() {
  const actions = useActions();
  const draft = useAvatarDraft();
  const mode = useAvatarSetupMode();

  return (
    <div className="screen">
      <div className="panel avatar-setup">
        <h2>{mode === 'restart' ? 'Restart With New Avatar' : 'Create Your Chess Star Avatar'}</h2>
        <AvatarPreview avatar={draft} />
        <label className="avatar-name">
          Name
          <input
            type="text"
            value={draft.name}
            maxLength={20}
            onChange={(e) => actions.updateAvatarDraft({ name: e.target.value })}
          />
        </label>

        <div className="avatar-row">
          <span>Skin Tone</span>
          <button
            onClick={() => actions.updateAvatarDraft({ skinTone: cycleOption(AVATAR_SKIN_TONES, draft.skinTone, -1) })}
          >
            ◀
          </button>
          <span className="swatch" style={{ background: draft.skinTone }} />
          <button
            onClick={() => actions.updateAvatarDraft({ skinTone: cycleOption(AVATAR_SKIN_TONES, draft.skinTone, 1) })}
          >
            ▶
          </button>
        </div>

        <div className="avatar-row">
          <span>Hair Color</span>
          <button
            onClick={() => actions.updateAvatarDraft({ hairColor: cycleOption(AVATAR_HAIR_COLORS, draft.hairColor, -1) })}
          >
            ◀
          </button>
          <span className="swatch" style={{ background: draft.hairColor }} />
          <button
            onClick={() => actions.updateAvatarDraft({ hairColor: cycleOption(AVATAR_HAIR_COLORS, draft.hairColor, 1) })}
          >
            ▶
          </button>
        </div>

        <div className="avatar-row">
          <span>Hair Style</span>
          <button
            onClick={() => actions.updateAvatarDraft({ hairStyle: cycleOption(AVATAR_HAIR_STYLES, draft.hairStyle, -1) })}
          >
            ◀
          </button>
          <strong>{draft.hairStyle}</strong>
          <button
            onClick={() => actions.updateAvatarDraft({ hairStyle: cycleOption(AVATAR_HAIR_STYLES, draft.hairStyle, 1) })}
          >
            ▶
          </button>
        </div>

        <div className="avatar-row">
          <span>Glasses</span>
          <button onClick={() => actions.updateAvatarDraft({ glasses: !draft.glasses })}>◀</button>
          <strong>{draft.glasses ? 'On' : 'Off'}</strong>
          <button onClick={() => actions.updateAvatarDraft({ glasses: !draft.glasses })}>▶</button>
        </div>

        <div className="button-row">
          <button disabled={draft.name.trim().length === 0} onClick={() => actions.finalizeAvatarSetup()}>
            {mode === 'restart' ? 'Restart Career' : 'Start Career'}
          </button>
          <button onClick={() => actions.cancelAvatarSetup()}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function TrainingScreen() {
  const actions = useActions();
  const game = useGame();
  const simSettings = useSimSettings();
  const [tutorialDismissed, setTutorialDismissed] = useState<boolean>(() => readTutorialDismissed());
  const [plannedModuleIds, setPlannedModuleIds] = useState<string[]>([]);
  const [plannedCoaching, setPlannedCoaching] = useState(0);
  const [puzzleTargetElo, setPuzzleTargetElo] = useState(500);
  const [puzzleChallenge, setPuzzleChallenge] = useState<PuzzleChallenge | null>(null);
  const [puzzleCursor, setPuzzleCursor] = useState(0);
  const [puzzleFen, setPuzzleFen] = useState('start');
  const [puzzleSideToMove, setPuzzleSideToMove] = useState<'white' | 'black'>('white');
  const [puzzleSelectedSquare, setPuzzleSelectedSquare] = useState<string | null>(null);
  const [puzzleHighlightSquares, setPuzzleHighlightSquares] = useState<string[]>([]);
  const [puzzleStatus, setPuzzleStatus] = useState('Pick a puzzle level and load a puzzle.');
  const [puzzleLoading, setPuzzleLoading] = useState(false);
  const [puzzleUsed, setPuzzleUsed] = useState(0);
  const [puzzleCreditsEarned, setPuzzleCreditsEarned] = useState(0);
  const [puzzleOutcome, setPuzzleOutcome] = useState<'active' | 'solved' | 'failed' | null>(null);
  const [puzzleFailureLine, setPuzzleFailureLine] = useState<string[]>([]);
  const [puzzleReplayPly, setPuzzleReplayPly] = useState<number | null>(null);
  const [puzzleRewardPopup, setPuzzleRewardPopup] = useState<{ visible: boolean; reward: number; ref: string } | null>(null);
  const [puzzleExpanded, setPuzzleExpanded] = useState(true);
  const [allocationExpanded, setAllocationExpanded] = useState(false);
  const puzzleChessRef = useRef<Chess | null>(null);
  if (!game) return <Navigate to="/" replace />;
  const trainingTutorialActive = !tutorialDismissed && game.history.tournaments.length === 0 && game.week <= 1;

  const puzzleLevelOptions = [500, 700, 900, 1100, 1300, 1500, 1700, 1900, 2100];
  const maxPuzzleAttempts = puzzleAttemptsForState(game);
  const remainingPuzzleAttempts = Math.max(0, maxPuzzleAttempts - puzzleUsed);
  const baseCredits = trainingCreditsForState(game);
  const coachingCost = coachingCostForBatch(game.coachingPurchases, plannedCoaching);
  const credits = baseCredits + plannedCoaching + puzzleCreditsEarned;
  const selectedModules = useMemo(
    () =>
      plannedModuleIds
        .map((id) => trainingModules.find((m) => m.id === id))
        .filter((m): m is (typeof trainingModules)[number] => Boolean(m)),
    [plannedModuleIds]
  );
  const used = selectedModules.length;
  const totalCost = coachingCost;
  const moduleCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    plannedModuleIds.forEach((id) => {
      counts[id] = (counts[id] ?? 0) + 1;
    });
    return counts;
  }, [plannedModuleIds]);

  const canAdd = (_moduleId: string) => {
    if (used >= credits) return false;
    return true;
  };

  useEffect(() => {
    setPuzzleUsed(0);
    setPuzzleCreditsEarned(0);
    setPuzzleChallenge(null);
    setPuzzleCursor(0);
    setPuzzleFen('start');
    setPuzzleSideToMove('white');
    setPuzzleSelectedSquare(null);
    setPuzzleHighlightSquares([]);
    setPuzzleOutcome(null);
    setPuzzleFailureLine([]);
    setPuzzleReplayPly(null);
    setPuzzleRewardPopup(null);
    setPuzzleExpanded(true);
    setAllocationExpanded(false);
    setPuzzleStatus('Pick a puzzle level and load a puzzle.');
  }, [game.week]);

  const clearPuzzleSelection = () => {
    setPuzzleSelectedSquare(null);
    setPuzzleHighlightSquares([]);
  };

  const legalTargets = (chess: Chess, square: string): string[] =>
    chess
      .moves({ square: square as never, verbose: true })
      .map((m) => m.to)
      .filter((to) => typeof to === 'string') as string[];

  const applyUci = (chess: Chess, uci: string) =>
    chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: (uci[4] as 'q' | 'r' | 'b' | 'n' | undefined) ?? 'q'
    });

  const buildSolutionLine = (challenge: PuzzleChallenge): string[] => {
    const replay = new Chess(challenge.startFen);
    const line: string[] = [];
    challenge.solution.forEach((uci, idx) => {
      const turn = replay.turn();
      const moveNo = Math.floor(idx / 2) + 1;
      const moved = applyUci(replay, uci);
      if (!moved) {
        line.push(`${moveNo}${turn === 'w' ? '.' : '...'} ${uci}`);
        return;
      }
      line.push(`${moveNo}${turn === 'w' ? '.' : '...'} ${moved.san}`);
    });
    return line;
  };

  const puzzleRef = (challenge: PuzzleChallenge): string => {
    if (typeof challenge.puzzleNo === 'number') return `#${challenge.puzzleNo}`;
    if (challenge.localRef) return challenge.localRef;
    return challenge.id;
  };

  const finishSolvedPuzzle = (challenge: PuzzleChallenge, seedOffset: number) => {
    const lambda = puzzleLambdaForElo(challenge.rating);
    const sampledReward = samplePoisson(lambda, game.meta.seed + game.week * 1301 + seedOffset * 97);
    const reward = Math.max(1, sampledReward);
    const ref = puzzleRef(challenge);
    setPuzzleCreditsEarned((v) => v + reward);
    setPuzzleUsed((v) => v + 1);
    setPuzzleOutcome('solved');
    setPuzzleFailureLine([]);
    setPuzzleReplayPly(challenge.solution.length);
    setPuzzleRewardPopup({ visible: true, reward, ref });
    setPuzzleStatus(
      `Solved ${ref} (Elo ${challenge.rating}). Reward: +${reward} training credits (Poisson λ=${lambda.toFixed(1)}).`
    );
  };

  const loadPuzzle = async (targetEloOverride?: number) => {
    if (remainingPuzzleAttempts <= 0) return;
    const targetElo = targetEloOverride ?? puzzleTargetElo;
    setPuzzleLoading(true);
    clearPuzzleSelection();
    setPuzzleOutcome(null);
    setPuzzleFailureLine([]);
    setPuzzleReplayPly(null);
    setPuzzleStatus(`Loading puzzle near Elo ${targetElo}...`);
    try {
      const challenge = await fetchPuzzleNearElo(targetElo, 120, 10, ({ attempt, maxPulls, rating, dist }) => {
        setPuzzleStatus(
          `Searching puzzle near Elo ${targetElo}... attempt ${attempt}/${maxPulls} (got ${rating}, Δ${dist}).`
        );
      });
      const chess = new Chess(challenge.startFen);
      const openingUci = challenge.solution[0];
      if (!openingUci) {
        throw new Error('Puzzle line is empty.');
      }
      const opening = applyUci(chess, openingUci);
      if (!opening) {
        throw new Error(`Puzzle opening move is invalid: ${openingUci}`);
      }
      if (challenge.solution.length < 2) {
        throw new Error('Puzzle has no continuation after opening move.');
      }
      puzzleChessRef.current = chess;
      setPuzzleSideToMove(chess.turn() === 'w' ? 'white' : 'black');
      setPuzzleChallenge(challenge);
      setPuzzleCursor(1);
      setPuzzleFen(chess.fen());
      const yourMoves = Math.ceil((challenge.solution.length - 1) / 2);
      setPuzzleStatus(
        `Puzzle ${puzzleRef(challenge)} loaded (Elo ${challenge.rating}). Opponent opened with ${opening.san}. Your turn. Required moves: ${yourMoves}.`
      );
      setPuzzleOutcome('active');
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'unknown error';
      setPuzzleStatus(`Could not load puzzle from local dataset: ${detail}`);
      setPuzzleOutcome(null);
      setPuzzleChallenge(null);
      puzzleChessRef.current = null;
    } finally {
      setPuzzleLoading(false);
    }
  };

  const onPuzzleSquareClick = (square: string) => {
    if (!puzzleChallenge || puzzleOutcome !== 'active') return;
    const chess = puzzleChessRef.current;
    if (!chess) return;

    const picked = chess.get(square as never);
    if (!puzzleSelectedSquare) {
      if (picked && picked.color === chess.turn()) {
        setPuzzleSelectedSquare(square);
        setPuzzleHighlightSquares(legalTargets(chess, square));
      }
      return;
    }

    if (square === puzzleSelectedSquare) {
      clearPuzzleSelection();
      return;
    }

    if (picked && picked.color === chess.turn()) {
      setPuzzleSelectedSquare(square);
      setPuzzleHighlightSquares(legalTargets(chess, square));
      return;
    }

    const move = chess.move({
      from: puzzleSelectedSquare,
      to: square,
      promotion: 'q'
    });
    clearPuzzleSelection();
    if (!move) return;

    const uci = `${move.from}${move.to}${move.promotion ?? ''}`;
    const expected = puzzleChallenge.solution[puzzleCursor];
    if (!expected || uci !== expected) {
      chess.undo();
      setPuzzleFen(chess.fen());
      setPuzzleOutcome('failed');
      setPuzzleUsed((v) => v + 1);
      setPuzzleFailureLine(buildSolutionLine(puzzleChallenge));
      setPuzzleReplayPly(0);
      setPuzzleStatus(`Incorrect move on ${puzzleRef(puzzleChallenge)}. Puzzle attempt consumed. Review the correct line below.`);
      return;
    }

    let cursor = puzzleCursor + 1;
    setPuzzleFen(chess.fen());
    if (cursor >= puzzleChallenge.solution.length) {
      setPuzzleCursor(cursor);
      finishSolvedPuzzle(puzzleChallenge, puzzleUsed);
      return;
    }

    const reply = puzzleChallenge.solution[cursor];
    if (reply) {
      const r = applyUci(chess, reply);
      if (r) cursor += 1;
    }
    setPuzzleCursor(cursor);
    setPuzzleFen(chess.fen());
    if (cursor >= puzzleChallenge.solution.length) {
      finishSolvedPuzzle(puzzleChallenge, puzzleUsed);
      return;
    }
    setPuzzleStatus(`Correct. Keep calculating... (${cursor}/${puzzleChallenge.solution.length} moves)`);
  };

  const replayFenAtPly = (challenge: PuzzleChallenge, ply: number): string => {
    const replay = new Chess(challenge.startFen);
    const capped = Math.max(0, Math.min(challenge.solution.length, ply));
    for (let i = 0; i < capped; i += 1) {
      const uci = challenge.solution[i];
      if (!uci) break;
      const moved = applyUci(replay, uci);
      if (!moved) break;
    }
    return replay.fen();
  };

  const jumpPuzzleReplay = (targetPly: number) => {
    if (!puzzleChallenge || !puzzleOutcome || puzzleOutcome === 'active') return;
    const clamped = Math.max(0, Math.min(puzzleChallenge.solution.length, targetPly));
    setPuzzleReplayPly(clamped);
    setPuzzleFen(replayFenAtPly(puzzleChallenge, clamped));
    clearPuzzleSelection();
  };

  const puzzleDisplayPly = puzzleOutcome && puzzleOutcome !== 'active' ? (puzzleReplayPly ?? 0) : puzzleCursor;
  const shouldGuidePuzzles = remainingPuzzleAttempts > 0;
  const shouldGuideAllocation = remainingPuzzleAttempts <= 0;
  const highlightStartTrainingMonth = remainingPuzzleAttempts === 0 && credits - used === 0;
  const fatigueBand = game.fatigue > 40 ? 'critical' : game.fatigue > 20 ? 'warning' : 'ok';
  const shouldGuideRest = fatigueBand !== 'ok';
  const highlightRestAction = shouldGuideRest && remainingPuzzleAttempts === 0;
  const highlightPuzzleCollapse = shouldGuideAllocation && puzzleExpanded;
  const highlightAllocationExpand = shouldGuideAllocation && !allocationExpanded;
  const highlightPuzzleButtons = shouldGuidePuzzles && puzzleExpanded;
  const tutorialPuzzleDone = puzzleOutcome === 'solved' || puzzleCreditsEarned > 0;
  const tutorialCreditsAllocated = used > 0;
  const puzzleStarted = Boolean(puzzleChallenge) || puzzleUsed > 0 || puzzleCursor > 0 || puzzleOutcome !== null;
  const puzzleLastMoveUci = useMemo(() => {
    if (!puzzleChallenge || puzzleDisplayPly <= 0) return null;
    return puzzleChallenge.solution[puzzleDisplayPly - 1] ?? null;
  }, [puzzleChallenge, puzzleDisplayPly]);
  const puzzleCaptured = useMemo(() => {
    if (!puzzleChallenge) return { white: [] as string[], black: [] as string[] };
    const chess = new Chess(puzzleChallenge.startFen);
    const white: string[] = [];
    const black: string[] = [];
    const safePly = Math.max(0, Math.min(puzzleChallenge.solution.length, puzzleDisplayPly));
    for (let i = 0; i < safePly; i += 1) {
      const uci = puzzleChallenge.solution[i];
      if (!uci) continue;
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: (uci[4] as 'q' | 'r' | 'b' | 'n' | undefined) ?? 'q'
      });
      if (!move?.captured) continue;
      if (move.color === 'w') {
        black.push(move.captured);
      } else {
        white.push(move.captured.toUpperCase());
      }
    }
    return { white, black };
  }, [puzzleChallenge, puzzleDisplayPly]);

  const addOne = (moduleId: string) => {
    if (!canAdd(moduleId)) return;
    setPlannedModuleIds((prev) => [...prev, moduleId]);
  };

  const removeOne = (moduleId: string) => {
    setPlannedModuleIds((prev) => {
      const idx = prev.lastIndexOf(moduleId);
      if (idx < 0) return prev;
      const next = [...prev];
      next.splice(idx, 1);
      return next;
    });
  };

  const distributeRemainingEqually = () => {
    const remaining = credits - used;
    if (remaining <= 0) return;
    setPlannedModuleIds((prev) => {
      const next = [...prev];
      for (let i = 0; i < remaining; i += 1) {
        next.push(trainingModules[i % trainingModules.length]!.id);
      }
      return next;
    });
  };

  const clearPlan = () => {
    setPlannedModuleIds([]);
    setPlannedCoaching(0);
  };

  const reduceCoachingCredit = () => {
    if (plannedCoaching <= 0) return;
    const nextCoaching = plannedCoaching - 1;
    const maxSelectable = baseCredits + nextCoaching;
    setPlannedCoaching(nextCoaching);
    setPlannedModuleIds((prev) => prev.slice(0, maxSelectable));
  };

  const addCoachingCredit = () => {
    if (coachingCost + coachingCostForPurchaseIndex(game.coachingPurchases + plannedCoaching) > game.money) {
      return;
    }
    setPlannedCoaching((v) => v + 1);
  };

  return (
    <div className="screen">
      {puzzleRewardPopup?.visible ? (
        <div className="puzzle-reward-overlay" onClick={() => setPuzzleRewardPopup(null)} role="presentation">
          <div
            className="puzzle-reward-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Puzzle reward"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="puzzle-reward-close"
              aria-label="Close reward popup"
              onClick={() => setPuzzleRewardPopup(null)}
            >
              ×
            </button>
            <h3>Congratulations!</h3>
            <p>
              You solved puzzle <strong>{puzzleRewardPopup.ref}</strong>.
            </p>
            <p className="puzzle-reward-points">
              You earned <strong>+{puzzleRewardPopup.reward}</strong> training points to spend.
            </p>
            <p className="cute-note">Click anywhere outside this popup to close.</p>
          </div>
        </div>
      ) : null}
      <h2>Training Picker</h2>
      {shouldGuideRest ? (
        <div className={`panel fatigue-alert fatigue-alert-${fatigueBand}`}>
          <h3>{fatigueBand === 'critical' ? 'Fatigue Critical' : 'Fatigue Warning'}</h3>
          <p>
            Current fatigue: <strong>{game.fatigue}</strong>. To rest: keep some or all credits unspent, then click{' '}
            <strong>Advance Month (Rest & Recover)</strong>. Each unspent credit reduces fatigue.
          </p>
        </div>
      ) : null}
      {trainingTutorialActive ? (
        <div className="panel tutorial-box">
          <h3>🎓 Training Tutorial</h3>
          <p>Complete these steps for your first month:</p>
          <ul>
            <li>{tutorialPuzzleDone ? '✅' : '⬜'} Solve one puzzle (recommended: Elo 500 button).</li>
            <li>{tutorialCreditsAllocated ? '✅' : '⬜'} Allocate at least one training credit.</li>
            <li>⬜ Click <strong>Start Training Month</strong> to finish this month and unlock the tournament tutorial.</li>
          </ul>
          <div className="button-row">
            <button
              onClick={() => {
                setPuzzleTargetElo(500);
                void loadPuzzle(500);
              }}
              disabled={puzzleLoading || remainingPuzzleAttempts <= 0}
            >
              Load Tutorial Puzzle (500)
            </button>
            <button
              onClick={() => {
                writeTutorialDismissed(true);
                setTutorialDismissed(true);
              }}
            >
              Close Tutorial
            </button>
          </div>
        </div>
      ) : null}
      <div className="panel">
        <h3>Skill Mechanics (Hover)</h3>
        <div className="skill-tip-row">
          {(Object.keys(SKILL_LABELS) as Array<keyof SkillRatings>).map((skill) => (
            <SkillTooltip key={skill} skill={skill} game={game} />
          ))}
        </div>
        <p>
          Monthly credits: <strong>{credits}</strong> (Base {baseCredits} + Coaching {plannedCoaching}) | Used:{' '}
          <strong>{used}</strong> | Puzzle bonus: <strong>{puzzleCreditsEarned}</strong> | Remaining:{' '}
          <strong>{credits - used}</strong>
        </p>
        <p className={`cute-note training-guide ${shouldGuidePuzzles ? 'guide-puzzle' : 'guide-allocate'}`}>
          {shouldGuideRest
            ? 'Fatigue is high. Solve puzzles only if you want more options, then leave credits unspent and click Advance Month (Rest & Recover).'
            : shouldGuidePuzzles
            ? 'Next step: solve puzzles first to earn training credits.'
            : highlightStartTrainingMonth
              ? 'Great. You have used all puzzle attempts and spent all credits. Start the training month.'
              : 'Next step: collapse puzzles and allocate your credits to skills.'}
        </p>
        <div className={`panel puzzle-panel training-section ${shouldGuidePuzzles ? 'guided-panel' : ''}`}>
          <div className="training-section-head">
            <h3>Step 1: Puzzle Training</h3>
            <button
              className={`section-toggle-btn ${highlightPuzzleCollapse ? 'guided-target' : ''}`}
              onClick={() => setPuzzleExpanded((v) => !v)}
            >
              {puzzleExpanded ? 'Collapse' : 'Expand'}
            </button>
          </div>
          <p className="cute-note">
            Puzzle attempts this month: <strong>{maxPuzzleAttempts}</strong> | Used: <strong>{puzzleUsed}</strong> |
            Remaining: <strong>{remainingPuzzleAttempts}</strong>
          </p>
          {puzzleExpanded ? (
            <>
              <div className={`puzzle-tier-row ${highlightPuzzleButtons ? 'guided-target' : ''}`}>
                {puzzleLevelOptions.map((elo) => {
                  const lambda = puzzleLambdaForElo(elo);
                  return (
                    <button
                      key={elo}
                      className={`puzzle-tier-btn ${puzzleTargetElo === elo ? 'active' : ''}`}
                      onClick={() => {
                        setPuzzleTargetElo(elo);
                        void loadPuzzle(elo);
                      }}
                      disabled={puzzleLoading || remainingPuzzleAttempts <= 0}
                    >
                      <strong>{elo}</strong>
                      <small>Avg reward {lambda.toFixed(1)}</small>
                    </button>
                  );
                })}
              </div>
              <p className={puzzleOutcome === 'failed' ? 'puzzle-fail-text' : ''}>{puzzleStatus}</p>
              {puzzleOutcome === 'failed' && puzzleFailureLine.length > 0 ? (
                <div className="puzzle-fail-box">
                  <strong>Puzzle Failed</strong>
                  <p>Correct solution line:</p>
                  <div className="puzzle-solution-line">{puzzleFailureLine.join(' ')}</div>
                </div>
              ) : null}
              {puzzleChallenge ? (
                <div className="puzzle-board-wrap">
                  <p>
                    Puzzle Ref: <strong>{puzzleRef(puzzleChallenge)}</strong> | Puzzle Elo:{' '}
                    <strong>{puzzleChallenge.rating}</strong> | Solution progress: {puzzleCursor}/
                    {puzzleChallenge.solution.length} (includes opening move) | You play:{' '}
                    <strong>{puzzleSideToMove}</strong> (side to move)
                  </p>
                  <p className="cute-note">
                    Source ID: <strong>{puzzleChallenge.id}</strong>
                    {puzzleChallenge.localRef ? (
                      <>
                        {' '}| Local ref: <strong>{puzzleChallenge.localRef}</strong>
                      </>
                    ) : null}
                    {typeof puzzleChallenge.popularity === 'number' ? (
                      <>
                        {' '}| Popularity: <strong>{puzzleChallenge.popularity}</strong>
                      </>
                    ) : null}
                    {typeof puzzleChallenge.nbPlays === 'number' ? (
                      <>
                        {' '}| Plays: <strong>{puzzleChallenge.nbPlays}</strong>
                      </>
                    ) : null}
                  </p>
                  <div className="puzzle-meta-wrap">
                    <div className="puzzle-meta-row">
                      <strong>Themes:</strong>
                      {(puzzleChallenge.themes ?? []).length > 0 ? (
                        <>
                          {(puzzleChallenge.themes ?? []).slice(0, 10).map((tag) => (
                            <span key={`theme-${tag}`} className="puzzle-tag">
                              {tag}
                            </span>
                          ))}
                          {(puzzleChallenge.themes ?? []).length > 10 ? (
                            <span className="puzzle-tag">+{(puzzleChallenge.themes ?? []).length - 10} more</span>
                          ) : null}
                        </>
                      ) : (
                        <span className="puzzle-tag muted">none</span>
                      )}
                    </div>
                    <div className="puzzle-meta-row">
                      <strong>Opening tags:</strong>
                      {(puzzleChallenge.openingTags ?? []).length > 0 ? (
                        <>
                          {(puzzleChallenge.openingTags ?? []).slice(0, 6).map((tag) => (
                            <span key={`opening-${tag}`} className="puzzle-tag opening">
                              {tag}
                            </span>
                          ))}
                          {(puzzleChallenge.openingTags ?? []).length > 6 ? (
                            <span className="puzzle-tag opening">+{(puzzleChallenge.openingTags ?? []).length - 6} more</span>
                          ) : null}
                        </>
                      ) : (
                        <span className="puzzle-tag muted">none</span>
                      )}
                    </div>
                  </div>
                  <ChessBoard
                    fen={puzzleFen}
                    onSquareClick={puzzleOutcome === 'active' ? onPuzzleSquareClick : undefined}
                    selectedSquare={puzzleSelectedSquare}
                    highlightedSquares={puzzleHighlightSquares}
                    orientation={puzzleSideToMove}
                    lastMoveUci={puzzleLastMoveUci}
                    capturedWhite={puzzleCaptured.white}
                    capturedBlack={puzzleCaptured.black}
                    showMoveGraphics
                  />
                  {puzzleOutcome && puzzleOutcome !== 'active' ? (
                    <div className="button-row">
                      <button disabled={(puzzleReplayPly ?? 0) <= 0} onClick={() => jumpPuzzleReplay(0)}>
                        Start
                      </button>
                      <button disabled={(puzzleReplayPly ?? 0) <= 0} onClick={() => jumpPuzzleReplay((puzzleReplayPly ?? 0) - 1)}>
                        Prev
                      </button>
                      <button
                        disabled={(puzzleReplayPly ?? 0) >= puzzleChallenge.solution.length}
                        onClick={() => jumpPuzzleReplay((puzzleReplayPly ?? 0) + 1)}
                      >
                        Next
                      </button>
                      <button
                        disabled={(puzzleReplayPly ?? 0) >= puzzleChallenge.solution.length}
                        onClick={() => jumpPuzzleReplay(puzzleChallenge.solution.length)}
                      >
                        End
                      </button>
                    </div>
                  ) : null}
                  {puzzleOutcome && puzzleOutcome !== 'active' ? (
                    <p className="cute-note">
                      Replay step: <strong>{puzzleReplayPly ?? 0}</strong> / {puzzleChallenge.solution.length}. Puzzle is
                      complete; board input is locked.
                    </p>
                  ) : null}
                  {puzzleOutcome && puzzleOutcome !== 'active' ? (
                    <div className="button-row">
                      <button disabled={puzzleLoading || remainingPuzzleAttempts <= 0} onClick={() => void loadPuzzle()}>
                        Load Next Puzzle
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <p className="cute-note">Puzzle section collapsed.</p>
          )}
        </div>
        <div className={`panel training-section ${shouldGuideAllocation ? 'guided-panel' : ''}`}>
          <div className="training-section-head">
            <h3>Step 2: Allocate Credits</h3>
            <button
              className={`section-toggle-btn ${highlightAllocationExpand ? 'guided-target' : ''}`}
              onClick={() => setAllocationExpanded((v) => !v)}
            >
              {allocationExpanded ? 'Collapse' : 'Expand'}
            </button>
          </div>
          {allocationExpanded ? (
            <>
              <p>
                Coaching cost this month: <strong>${totalCost}</strong> / Money: <strong>${game.money}</strong>
              </p>
              <div className="button-row">
                <button disabled={plannedCoaching <= 0} onClick={reduceCoachingCredit}>
                  - Coaching Credit
                </button>
                <button
                  disabled={coachingCost + coachingCostForPurchaseIndex(game.coachingPurchases + plannedCoaching) > game.money}
                  onClick={addCoachingCredit}
                >
                  + Coaching Credit (${coachingCostForPurchaseIndex(game.coachingPurchases + plannedCoaching)})
                </button>
                <button disabled={credits - used <= 0} onClick={distributeRemainingEqually}>
                  Distribute Remaining Equally
                </button>
              </div>
              <div className="grid-list training-module-grid">
                {trainingModules.map((module) => (
                  <article key={module.id} className="panel card">
                    <h3>{module.label}</h3>
                    <p>{module.description}</p>
                    <p>
                      Focus: <SkillTooltip skill={module.focusSkill} game={game} />
                    </p>
                    <p>Cost: Free (uses 1 training credit)</p>
                    <p>Fatigue Δ: +0 (training adds no fatigue)</p>
                    <p>
                      Planned credits: <strong>{moduleCounts[module.id] ?? 0}</strong>
                    </p>
                    <div className="button-row">
                      <button disabled={!canAdd(module.id)} onClick={() => addOne(module.id)}>
                        + Add Credit
                      </button>
                      <button disabled={(moduleCounts[module.id] ?? 0) === 0} onClick={() => removeOne(module.id)}>
                        - Remove Credit
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <p className="cute-note">Credit allocation section collapsed.</p>
          )}
        </div>
        <p className="cute-note">
          Study Habits now controls puzzle attempts (+1 every {simSettings.training.puzzleAttemptStudyStep} points).
        </p>
        <div className="button-row">
          <button
            className={highlightStartTrainingMonth || highlightRestAction ? 'guided-target' : ''}
            onClick={() => {
              actions.trainMonth(selectedModules, plannedCoaching, puzzleCreditsEarned);
              clearPlan();
            }}
          >
            {used === 0 ? 'Advance Month (Rest & Recover)' : 'Start Training Month'}
          </button>
          <button disabled={used === 0 && plannedCoaching === 0} onClick={clearPlan}>
            Clear Plan
          </button>
        </div>
      </div>
      {puzzleStarted ? <p className="lock-reason">Puzzle run started. Finish this month from training before going back.</p> : null}
      <button disabled={puzzleStarted} onClick={() => actions.setView('dashboard')}>
        Back
      </button>
    </div>
  );
}

function TournamentScreen() {
  const actions = useActions();
  const game = useGame();
  const result = useLastTournament();
  const selectedTournament = useSelectedTournament();
  const tournamentSim = useTournamentSim();
  const tournamentStartMode = useTournamentStartMode();
  const [tutorialDismissed, setTutorialDismissed] = useState<boolean>(() => readTutorialDismissed());

  if (!game) return <Navigate to="/" replace />;

  const playerGames = useMemo(
    () => result?.games.filter((g) => g.white.id === 'player' || g.black.id === 'player') ?? [],
    [result]
  );
  const hasStockfishGameData = useMemo(
    () => playerGames.some((g) => Boolean(g.pgn) || (g.movesUci?.length ?? 0) > 0),
    [playerGames]
  );
  const totalPlayerGames = result?.totalPlayerGames ?? selectedTournament?.rounds ?? 0;
  const simulatedPlayerGames = result?.simulatedPlayerGames ?? 0;
  const visibleGames = playerGames;
  const monthlyEvents = useMemo(
    () => monthlyTournamentPool(tournamentTemplates, game.week, game.meta.seed, 6),
    [game.meta.seed, game.week]
  );
  const beginnerTournament = useMemo(() => {
    const sorted = [...monthlyEvents].sort(
      (a, b) =>
        (a.minEloReq ?? 0) - (b.minEloReq ?? 0) ||
        a.avgOpponentRating - b.avgOpponentRating ||
        a.entryFee - b.entryFee
    );
    return sorted[0] ?? null;
  }, [monthlyEvents]);
  const tournamentTutorialActive = !tutorialDismissed && game.history.tournaments.length === 0 && game.week >= 2;

  useEffect(() => {
    if (!result || !tournamentStartMode) return;
    if (tournamentStartMode === 'watch_next') {
      const target = playerGames[playerGames.length - 1];
      actions.consumeTournamentStartMode();
      if (target) {
        // Open a live simulation view (not replay) for the newly advanced game slot.
        actions.prepareWatch({ ...target, movesUci: undefined, pgn: undefined }, result.template.name);
      }
      return;
    }
    actions.consumeTournamentStartMode();
  }, [actions, playerGames, result, tournamentStartMode]);

  const simEvalCp = tournamentSim?.evalWhiteCp;
  const simEvalPawns = typeof simEvalCp === 'number' ? simEvalCp / 100 : 0;
  const simEvalAbs = Math.abs(simEvalPawns);
  const simScoreBarPct =
    typeof simEvalCp === 'number'
      ? Math.max(4, Math.min(96, 50 + (Math.max(-500, Math.min(500, simEvalCp)) / 500) * 50))
      : 50;
  const simLeader =
    typeof simEvalCp !== 'number'
      ? 'Balanced'
      : simEvalCp > 20
        ? tournamentSim?.currentWhite ?? 'White'
        : simEvalCp < -20
          ? tournamentSim?.currentBlack ?? 'Black'
          : 'Balanced';
  const simLeadText =
    typeof simEvalCp !== 'number'
      ? 'Awaiting move eval...'
      : simLeader === 'Balanced'
        ? 'Roughly equal'
        : `${simLeader} +${simEvalAbs.toFixed(2)} pawns`;
  const simWhiteElo = tournamentSim?.currentWhiteElo;
  const simBlackElo = tournamentSim?.currentBlackElo;
  const simEloDelta =
    typeof simWhiteElo === 'number' && typeof simBlackElo === 'number' ? simWhiteElo - simBlackElo : null;
  const simEloText =
    simEloDelta === null
      ? null
      : simEloDelta === 0
        ? 'Relative Elo: even'
        : `Relative Elo: ${simEloDelta > 0 ? '+' : ''}${simEloDelta} (${simEloDelta > 0 ? `${tournamentSim?.currentWhite ?? 'White'} higher` : `${tournamentSim?.currentBlack ?? 'Black'} higher`})`;
  const tournamentStarted = Boolean(result) || Boolean(tournamentSim?.running);
  const tournamentComplete = Boolean(result?.isComplete);
  const mainBackLocked = tournamentStarted && !tournamentComplete;

  return (
    <div className="screen">
      {tournamentTutorialActive ? (
        <div className="panel tutorial-box">
          <h3>🎓 Beginner Tournament Tutorial</h3>
          <p>
            Pick a beginner event{beginnerTournament ? ` (recommended: ${beginnerTournament.name})` : ''}, then run your first event.
            Start with <strong>Watch Next Game Live</strong> or <strong>Simulate Next Game (Stockfish)</strong>.
          </p>
          <p className="cute-note">You can leave this tutorial or the tournament view at any time.</p>
          <div className="button-row">
            {beginnerTournament ? (
              <button
                disabled={Boolean(selectedTournament) || Boolean(result)}
                onClick={() => actions.chooseTournament(beginnerTournament)}
              >
                Select Beginner Tournament
              </button>
            ) : null}
            <button
              onClick={() => {
                writeTutorialDismissed(true);
                setTutorialDismissed(true);
              }}
            >
              Close Tutorial
            </button>
            <button disabled={mainBackLocked} onClick={() => actions.finishTournamentMonth()}>
              Exit Tournament View
            </button>
          </div>
        </div>
      ) : null}
      {result ? (
        <div className="panel">
          <h2>{result.template.name}</h2>
          {tournamentSim?.running ? (
            <div className="panel sim-loading">
              <div className="spinner" aria-hidden="true" />
              <h3>Simulating Tournament Games...</h3>
              <p>{tournamentSim.message}</p>
              <p>
                Player games: {tournamentSim.playerDone}/{tournamentSim.playerTotal} | All boards: {tournamentSim.gamesDone}/
                {tournamentSim.gamesTotal}
              </p>
              <p>
                Current: Round {tournamentSim.round}, Board {tournamentSim.board}
              </p>
              {tournamentSim.currentWhite && tournamentSim.currentBlack ? (
                <p>
                  Live board: {tournamentSim.currentWhite} vs {tournamentSim.currentBlack} | Move{' '}
                  {tournamentSim.currentFullMove ?? 0} (ply {tournamentSim.currentPly ?? 0})
                </p>
              ) : null}
              {tournamentSim.currentWhite && tournamentSim.currentBlack && simEloText ? (
                <p>
                  {tournamentSim.currentWhite} Elo {tournamentSim.currentWhiteElo ?? '-'} vs {tournamentSim.currentBlack} Elo{' '}
                  {tournamentSim.currentBlackElo ?? '-'} | {simEloText}
                </p>
              ) : null}
              <div className="sim-eval-panel">
                <div className="sim-eval-head">
                  <strong>Live score</strong>
                  <span>{simLeadText}</span>
                </div>
                <div className="sim-eval-bar" role="img" aria-label={`Current board eval ${simLeadText}`}>
                  <div className="sim-eval-fill" style={{ width: `${simScoreBarPct}%` }} />
                </div>
                <div className="sim-eval-labels">
                  <span>{tournamentSim.currentWhite ?? 'White'}</span>
                  <span>{tournamentSim.currentBlack ?? 'Black'}</span>
                </div>
              </div>
              <p>
                Progress:{' '}
                {tournamentSim.playerTotal > 0
                  ? Math.round((tournamentSim.playerDone / tournamentSim.playerTotal) * 100)
                  : 0}
                % player games
              </p>
            </div>
          ) : null}
          <div className="button-row">
            <button
              disabled={Boolean(tournamentSim?.running) || result.isComplete}
              onClick={() => void actions.runTournament(result.template, 'all')}
            >
              Simulate All Remaining (Stockfish)
            </button>
            <button
              disabled={Boolean(tournamentSim?.running) || result.isComplete}
              onClick={() => actions.runTournamentEloOnly(result.template, 'all')}
            >
              Simulate All Remaining (Elo)
            </button>
            <button
              disabled={Boolean(tournamentSim?.running) || result.isComplete}
              onClick={() => void actions.runTournament(result.template, 'next')}
            >
              Simulate Next Game (Stockfish)
            </button>
            <button
              disabled={Boolean(tournamentSim?.running) || result.isComplete}
              onClick={() => void actions.runTournament(result.template, 'watch_next')}
            >
              Watch Next Game Live
            </button>
            {hasStockfishGameData ? (
              <button
                disabled={playerGames.length === 0}
                onClick={() => actions.prepareWatch(playerGames[playerGames.length - 1]!, result.template.name)}
              >
                Rewatch Last Simulated
              </button>
            ) : null}
          </div>
          {!hasStockfishGameData ? <p className="cute-note">Elo-only simulation: no live game replay available.</p> : null}
          <p className="cute-note">
            Simulated games shown: {simulatedPlayerGames}/{totalPlayerGames}
          </p>
          <h3>Standings</h3>
          <p className="cute-note">
            Final prize pool: ${result.prizePool} | Paid places: top {result.paidPlaces} of {result.standings.length}
          </p>
          {!result.isComplete ? <p className="cute-note">Provisional standings after simulated games.</p> : null}
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Score</th>
                <th>Rating</th>
                <th>Elo Δ</th>
                <th>Prize</th>
              </tr>
            </thead>
            <tbody>
              {result.standings.slice(0, 10).map((s, idx) => (
                <tr key={`${s.name}-${idx}`} className={s.isHuman ? 'highlight' : ''}>
                  <td>{idx + 1}</td>
                  <td>{s.name}</td>
                  <td>{s.score.toFixed(1)}</td>
                  <td>{s.rating}</td>
                  <td
                    className={
                      s.ratingDelta > 0 ? 'elo-delta-positive' : s.ratingDelta < 0 ? 'elo-delta-negative' : 'elo-delta-neutral'
                    }
                  >
                    {s.ratingDelta > 0 ? '+' : ''}
                    {s.ratingDelta}
                  </td>
                  <td>${payoutForPlace(idx + 1, result.prizePool, result.standings.length, result.paidPlaces)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <details className="standings-collapse">
            <summary>Show Full Standings ({result.standings.length} players)</summary>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Score</th>
                  <th>Rating</th>
                  <th>Elo Δ</th>
                  <th>Prize</th>
                </tr>
              </thead>
              <tbody>
                {result.standings.map((s, idx) => (
                  <tr key={`${s.name}-full-${idx}`} className={s.isHuman ? 'highlight' : ''}>
                    <td>{idx + 1}</td>
                    <td>{s.name}</td>
                    <td>{s.score.toFixed(1)}</td>
                    <td>{s.rating}</td>
                    <td
                      className={
                        s.ratingDelta > 0 ? 'elo-delta-positive' : s.ratingDelta < 0 ? 'elo-delta-negative' : 'elo-delta-neutral'
                      }
                    >
                      {s.ratingDelta > 0 ? '+' : ''}
                      {s.ratingDelta}
                    </td>
                    <td>${payoutForPlace(idx + 1, result.prizePool, result.standings.length, result.paidPlaces)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>

          <h4>Round Results (Your Games)</h4>
          <ul className="round-results-list">
            {visibleGames.map((g, idx) => (
                <li key={`${g.round}-${idx}`} className="round-result-item">
                  R{g.round}: {g.white.name} vs {g.black.name} ({g.result})
                  {g.playerEloChange ? (
                    <div
                      className={`elo-change-line ${
                        g.playerEloChange.score === 1
                          ? 'result-win'
                          : g.playerEloChange.score === 0.5
                            ? 'result-draw'
                            : 'result-loss'
                      }`}
                    >
                      Elo {g.playerEloChange.before} {'->'} {g.playerEloChange.after} ({g.playerEloChange.delta >= 0 ? '+' : ''}
                      {g.playerEloChange.delta}) | Opp {g.playerEloChange.opponentRating} | Exp{' '}
                      {g.playerEloChange.expected} | Score {g.playerEloChange.score}
                    </div>
                  ) : null}
                  <div className="button-row">
                    {hasStockfishGameData ? (
                      <button className="watch-live-btn" onClick={() => actions.prepareWatch(g, result.template.name)}>
                        Rewatch Game
                      </button>
                    ) : null}
                    {g.pgn ? (
                      <details>
                        <summary>Step-by-step PGN</summary>
                        <pre>{g.pgn}</pre>
                      </details>
                    ) : null}
                  </div>
                </li>
              ))}
            {visibleGames.length === 0 ? <li>No games simulated yet.</li> : null}
          </ul>
          {simulatedPlayerGames >= totalPlayerGames ? (
            <div className="tournament-complete-bar">
              <p>Tournament complete. End this month and return to the month planner.</p>
              <button className="travel-home-btn" onClick={() => actions.finishTournamentMonth()}>
                Travel Home
              </button>
            </div>
          ) : null}
          <div className="button-row">
            <button disabled={!result.isComplete} onClick={() => actions.finishTournamentMonth()}>
              Exit Tournament View
            </button>
          </div>
          {!result.isComplete ? <p className="lock-reason">Tournament in progress. Complete it before leaving this screen.</p> : null}
        </div>
      ) : selectedTournament ? (
        <div className="panel">
          <h2>{selectedTournament.name}</h2>
          <p>Tier: {selectedTournament.tier ?? 'Open'}</p>
          <p>Rounds: {selectedTournament.rounds}</p>
          <p>Entry Fee: ${selectedTournament.entryFee}</p>
          <p>Avg Opponent Elo: {selectedTournament.avgOpponentRating}</p>
          <p className="cute-note">
            You selected this event. Choose a simulation mode.
          </p>
          {tournamentSim?.running ? (
            <div className="panel sim-loading">
              <div className="spinner" aria-hidden="true" />
              <h3>Simulating Tournament Games...</h3>
              <p>{tournamentSim.message}</p>
              <p>
                Player games: {tournamentSim.playerDone}/{tournamentSim.playerTotal} | All boards: {tournamentSim.gamesDone}/
                {tournamentSim.gamesTotal}
              </p>
              <p>
                Current: Round {tournamentSim.round}, Board {tournamentSim.board}
              </p>
              {tournamentSim.currentWhite && tournamentSim.currentBlack ? (
                <p>
                  Live board: {tournamentSim.currentWhite} vs {tournamentSim.currentBlack} | Move{' '}
                  {tournamentSim.currentFullMove ?? 0} (ply {tournamentSim.currentPly ?? 0})
                </p>
              ) : null}
              {tournamentSim.currentWhite && tournamentSim.currentBlack && simEloText ? (
                <p>
                  {tournamentSim.currentWhite} Elo {tournamentSim.currentWhiteElo ?? '-'} vs {tournamentSim.currentBlack} Elo{' '}
                  {tournamentSim.currentBlackElo ?? '-'} | {simEloText}
                </p>
              ) : null}
              <div className="sim-eval-panel">
                <div className="sim-eval-head">
                  <strong>Live score</strong>
                  <span>{simLeadText}</span>
                </div>
                <div className="sim-eval-bar" role="img" aria-label={`Current board eval ${simLeadText}`}>
                  <div className="sim-eval-fill" style={{ width: `${simScoreBarPct}%` }} />
                </div>
                <div className="sim-eval-labels">
                  <span>{tournamentSim.currentWhite ?? 'White'}</span>
                  <span>{tournamentSim.currentBlack ?? 'Black'}</span>
                </div>
              </div>
            </div>
          ) : null}
          {!tournamentSim?.running && tournamentSim && tournamentSim.message ? (
            <p className="lock-reason">{tournamentSim.message}</p>
          ) : null}
          <div className="button-row">
            <button disabled={Boolean(tournamentSim?.running)} onClick={() => actions.runTournamentEloOnly(selectedTournament, 'all')}>
              Simulate All Games (Elo Avg Skills)
            </button>
            <button disabled={Boolean(tournamentSim?.running)} onClick={() => void actions.runTournament(selectedTournament, 'all')}>
              Simulate All Games (Stockfish)
            </button>
            <button disabled={Boolean(tournamentSim?.running)} onClick={() => void actions.runTournament(selectedTournament, 'next')}>
              Simulate Next Game (Stockfish)
            </button>
            <button disabled={Boolean(tournamentSim?.running)} onClick={() => void actions.runTournament(selectedTournament, 'watch_next')}>
              Watch Live
            </button>
            {tournamentSim && !tournamentSim.running && tournamentSim.errorCode ? (
              <>
                <button onClick={() => void actions.runTournament(selectedTournament, 'all')}>Retry</button>
                <button onClick={() => actions.runTournamentEloOnly(selectedTournament, 'all')}>
                  Simulate Full Tournament (Elo Only)
                </button>
              </>
            ) : null}
            <button disabled={Boolean(tournamentSim?.running)} onClick={() => actions.clearTournamentSelection()}>
              Back To Monthly Tournaments
            </button>
            <button disabled={Boolean(tournamentSim?.running)} onClick={() => actions.finishTournamentMonth()}>
              Exit Tournament View
            </button>
          </div>
        </div>
      ) : (
        <>
          <h2>Tournament Picker</h2>
          <p className="cute-note">This month&apos;s event slate rotates each month.</p>
          <div className="grid-list">
            {monthlyEvents
              .slice()
              .sort((a, b) => (a.minEloReq ?? 0) - (b.minEloReq ?? 0))
              .map((tpl) => {
                const reasons: string[] = [];
                if (game.money < tpl.entryFee) reasons.push(`Need $${tpl.entryFee} entry fee`);
                if (game.reputation < tpl.reputationReq) reasons.push(`Need reputation ${tpl.reputationReq}`);
                if (game.publicRating < (tpl.minEloReq ?? 0)) reasons.push(`Need Elo ${tpl.minEloReq}`);
                const locked = reasons.length > 0;
                const participantCount = 32;
                const poolRange = prizePoolRangeForEntryFee(tpl.entryFee, participantCount);
                const paidPlacesRange = paidPlacesRangeForField(participantCount);
                const examplePool = tpl.entryFee * participantCount;
                const previewPayouts = payoutsForField(examplePool, participantCount, paidPlacesRange.max);

                return (
                  <article key={tpl.id} className={`panel card tournament-card ${locked ? 'locked' : 'open'}`}>
                    <h3>{tpl.name}</h3>
                    <p>Tier: {tpl.tier ?? 'Open'}</p>
                    <p>Rounds: {tpl.rounds}</p>
                    <p>Avg Opponent: {tpl.avgOpponentRating}</p>
                    <p>Min Elo: {tpl.minEloReq ?? 0}</p>
                    <p>Rep Req: {tpl.reputationReq}</p>
                    <p>Entry: ${tpl.entryFee}</p>
                    <p>Prize Pool: ${poolRange.min} - ${poolRange.max} (fees x 0.75-1.25)</p>
                    <div className="prize-box">
                      <strong>Payout Preview (example at 1.0x)</strong>
                      <span>Paid Places: Top {paidPlacesRange.min}-{paidPlacesRange.max} / {participantCount}</span>
                      <span>1st: ${previewPayouts[0] ?? 0}</span>
                      <span>2nd: ${previewPayouts[1] ?? 0}</span>
                      <span>3rd: ${previewPayouts[2] ?? 0}</span>
                      <span>Last Paid (at max depth {paidPlacesRange.max}th): ${previewPayouts[paidPlacesRange.max - 1] ?? 0}</span>
                    </div>
                    <p>Travel Fatigue: +{tpl.travelFatigue}</p>
                    <button disabled={locked} onClick={() => actions.chooseTournament(tpl)}>
                      {locked ? 'Locked' : 'Enter Tournament'}
                    </button>
                    {locked ? (
                      <p className="lock-reason">🔒 {reasons.join(' • ')}</p>
                    ) : (
                      <p className="open-reason">✅ Eligible now</p>
                    )}
                  </article>
                );
              })}
          </div>
        </>
      )}

      {mainBackLocked ? <p className="lock-reason">Tournament already started. Finish all rounds, then use Travel Home.</p> : null}
      <button disabled={mainBackLocked} onClick={() => actions.setView('dashboard')}>
        Back
      </button>
      <button onClick={() => actions.setView('sandbox')}>Engine Sandbox</button>
    </div>
  );
}

function HistoryScreen() {
  const actions = useActions();
  const game = useGame();
  if (!game) return <Navigate to="/" replace />;

  return (
    <div className="screen">
      <h2>History</h2>
      <div className="panel">
        <h3>Tournaments</h3>
        <ul>
          {game.history.tournaments.slice(0, 12).map((t) => (
            <li key={t.id}>
              Month {t.week}: {t.name} | Place #{t.placement} | {t.score.toFixed(1)} pts | Δ{t.ratingDelta}
            </li>
          ))}
        </ul>
      </div>
      <div className="panel">
        <h3>Saved PGNs</h3>
        <ul>
          {game.history.games
            .filter((g) => g.pgn)
            .slice(0, 8)
            .map((g) => (
              <li key={g.id}>
                {g.white} vs {g.black} {g.result}
                <details>
                  <summary>PGN</summary>
                  <pre>{g.pgn}</pre>
                </details>
              </li>
            ))}
        </ul>
      </div>
      <button onClick={() => actions.setView('dashboard')}>Back</button>
    </div>
  );
}

function SandboxScreen() {
  const actions = useActions();

  return (
    <div className="screen">
      <h2>Engine Sandbox</h2>
      <p>Adjust side strengths by selecting live watch game presets.</p>
      <div className="panel">
        <ChessBoard fen="start" />
        <p>Use Tournament → Watch Live to run full engine-vs-engine with your current stats profile.</p>
      </div>
      <button onClick={() => actions.setView('dashboard')}>Back</button>
    </div>
  );
}

function LiveScreen() {
  const watchContext = useWatchContext();
  const actions = useActions();
  if (!watchContext) return <Navigate to="/dashboard" replace />;

  return (
    <div className="screen">
      <LiveWatch context={watchContext} onDone={() => actions.setView('tournament')} />
      <button onClick={() => actions.setView('tournament')}>Back To Tournament</button>
    </div>
  );
}

function ViewRouter() {
  const view = useView();
  const actions = useActions();
  const game = useGame();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const byView = {
      home: '/',
      avatar_setup: '/avatar-setup',
      dashboard: '/dashboard',
      training: '/training',
      tournament: '/tournament',
      history: '/history',
      sandbox: '/sandbox',
      live: '/live'
    } as const;
    const target = byView[view];
    if (location.pathname !== target) {
      navigate(target, { replace: true });
    }
  }, [location.pathname, navigate, view]);

  useEffect(() => {
    if (location.pathname === '/dashboard' && !game) {
      actions.continueCareer();
    }
  }, [actions, game, location.pathname]);

  return null;
}

export function AppRoutes() {
  return (
    <>
      <ViewRouter />
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/avatar-setup" element={<AvatarSetupScreen />} />
        <Route path="/dashboard" element={<DashboardScreen />} />
        <Route path="/training" element={<TrainingScreen />} />
        <Route path="/tournament" element={<TournamentScreen />} />
        <Route path="/history" element={<HistoryScreen />} />
        <Route path="/sandbox" element={<SandboxScreen />} />
        <Route path="/live" element={<LiveScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
