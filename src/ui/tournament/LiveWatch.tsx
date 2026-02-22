/*
 * File Purpose: Live and replay game viewer for player boards.
 * Key Mechanics: Runs/plays back move timelines with controls, speed, engine status, per-side stats, and score visualization.
 */

import { Chess } from 'chess.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { applyUciMove, gameResult } from '../../chess/chessRules';
import { pgnFromMoves } from '../../chess/pgn';
import type { WatchContext } from '../../state/store';
import { useActions, useGame } from '../../state/selectors';
import { ChessBoard } from '../board/ChessBoard';
import { chooseMove, type MoveTelemetry } from '../../engine/stockfish';
import { initEngine, terminateEngine, type EngineHandle } from '../../engine/stockfishWorker';
import { materialDeficitPoints } from '../../chess/phases';
import { buildMovePolicy } from '../../engine/policy';

function clamp01(n: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, n));
}

export function LiveWatch({ context, onDone }: { context: WatchContext; onDone: () => void }) {
  const gameState = useGame();
  const actions = useActions();
  const replayMode = Boolean(context.game.movesUci?.length);
  const [moves, setMoves] = useState<string[]>(context.game.movesUci ? [...context.game.movesUci] : []);
  const [viewPly, setViewPly] = useState(0);
  const [status, setStatus] = useState('Ready');
  const [telemetryBySide, setTelemetryBySide] = useState<{ white: MoveTelemetry | null; black: MoveTelemetry | null }>({
    white: null,
    black: null
  });
  const [running, setRunning] = useState(false);
  const [engineFailed, setEngineFailed] = useState(false);
  const [engineErrorDetail, setEngineErrorDetail] = useState('');
  const [speed, setSpeed] = useState(1);
  const [evalWhiteCpByPly, setEvalWhiteCpByPly] = useState<number[]>([]);
  const [moveQualities, setMoveQualities] = useState<Array<1 | 2 | 3 | 4 | null>>(
    context.game.movesUci ? Array.from({ length: context.game.movesUci.length }, () => null) : []
  );
  const engineRef = useRef<EngineHandle | null>(null);
  const finishedRef = useRef(false);
  const analysisErrorStreakRef = useRef(0);
  const movesRef = useRef<string[]>([]);
  const viewPlyRef = useRef(0);

  useEffect(() => {
    movesRef.current = moves;
  }, [moves]);

  useEffect(() => {
    viewPlyRef.current = viewPly;
  }, [viewPly]);

  const sides = useMemo(() => {
    const whiteIsPlayer = context.game.white.id === 'player';
    const blackIsPlayer = context.game.black.id === 'player';
    const playerSkills = gameState?.skills;

    return {
      white: {
        name: context.game.white.name,
        skills: whiteIsPlayer && playerSkills ? playerSkills : context.game.white.skills,
        fatigue: whiteIsPlayer ? gameState?.fatigue ?? 10 : 20,
        confidence: whiteIsPlayer ? gameState?.confidence ?? 0 : 0
      },
      black: {
        name: context.game.black.name,
        skills: blackIsPlayer && playerSkills ? playerSkills : context.game.black.skills,
        fatigue: blackIsPlayer ? gameState?.fatigue ?? 10 : 18,
        confidence: blackIsPlayer ? gameState?.confidence ?? 0 : 0
      }
    };
  }, [context.game, gameState]);

  useEffect(() => {
    setMoves(context.game.movesUci ? [...context.game.movesUci] : []);
    setMoveQualities(context.game.movesUci ? Array.from({ length: context.game.movesUci.length }, () => null) : []);
    setEvalWhiteCpByPly([]);
    setViewPly(0);
    setRunning(false);
    finishedRef.current = false;
    analysisErrorStreakRef.current = 0;
  }, [context.game.movesUci, context.game.round, context.game.white.id, context.game.black.id]);

  useEffect(() => {
    let active = true;
    if (replayMode) return () => undefined;
    initEngine()
      .then((engine) => {
        if (!active) {
          terminateEngine(engine);
          return;
        }
        engineRef.current = engine;
        setEngineFailed(false);
        setEngineErrorDetail('');
      })
      .catch((err) => {
        setEngineFailed(true);
        const detail = err instanceof Error ? err.message : 'unknown engine startup error';
        setEngineErrorDetail(detail);
        setStatus(`Stockfish unavailable. Live simulation cannot run. (${detail})`);
      });

    return () => {
      active = false;
      if (engineRef.current) {
        terminateEngine(engineRef.current);
        engineRef.current = null;
      }
    };
  }, [replayMode]);

  const chessFromTimeline = (timeline: string[], ply: number): Chess => {
    const chess = new Chess();
    const safePly = Math.min(Math.max(0, ply), timeline.length);
    for (let i = 0; i < safePly; i += 1) {
      const uci = timeline[i];
      if (!uci) continue;
      try {
        applyUciMove(chess, uci);
      } catch {
        break;
      }
    }
    return chess;
  };

  const displayFen = useMemo(() => chessFromTimeline(moves, viewPly).fen(), [moves, viewPly]);
  const lastMoveUci = viewPly > 0 ? moves[viewPly - 1] ?? null : null;
  const capturedPieces = useMemo(() => {
    const chess = new Chess();
    const white: string[] = [];
    const black: string[] = [];
    const safePly = Math.max(0, Math.min(viewPly, moves.length));
    for (let i = 0; i < safePly; i += 1) {
      const uci = moves[i];
      if (!uci) continue;
      const moved = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: (uci[4] as 'q' | 'r' | 'b' | 'n' | undefined) ?? 'q'
      });
      if (!moved?.captured) continue;
      if (moved.color === 'w') {
        black.push(moved.captured);
      } else {
        white.push(moved.captured.toUpperCase());
      }
    }
    return { white, black };
  }, [moves, viewPly]);
  const policyPreview = useMemo(
    () => ({
      white: buildMovePolicy(displayFen, sides.white.skills, sides.white.fatigue, sides.white.confidence, 0),
      black: buildMovePolicy(displayFen, sides.black.skills, sides.black.fatigue, sides.black.confidence, 0)
    }),
    [displayFen, sides.black.confidence, sides.black.fatigue, sides.black.skills, sides.white.confidence, sides.white.fatigue, sides.white.skills]
  );

  const publicRatingForSide = (side: 'white' | 'black'): number => {
    const piece = side === 'white' ? context.game.white : context.game.black;
    const isPlayer = piece.id === 'player';
    if (isPlayer) return gameState?.publicRating ?? piece.publicRating;
    return piece.publicRating;
  };

  const finishGame = (chess: Chess, finalMoves = movesRef.current.slice(0, viewPlyRef.current)) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const result = gameResult(chess) ?? '1/2-1/2';
    const pgn = pgnFromMoves(finalMoves);
    if (!replayMode) {
      actions.addWatchedGamePgn(pgn, result, sides.white.name, sides.black.name);
    }
    setStatus(`Game over: ${result}`);
    setRunning(false);
    analysisErrorStreakRef.current = 0;
  };

  const tick = async () => {
    const timeline = movesRef.current;
    const currentPly = viewPlyRef.current;

    if (currentPly < timeline.length) {
      const nextPly = currentPly + 1;
      viewPlyRef.current = nextPly;
      setViewPly(nextPly);
      setStatus(`Reviewing move ${nextPly}/${timeline.length}`);
      return;
    }

    if (replayMode) {
      setStatus('Replay complete.');
      setRunning(false);
      return;
    }

    const chess = chessFromTimeline(timeline, currentPly);
    if (gameResult(chess)) {
      finishGame(chess, timeline.slice(0, currentPly));
      return;
    }

    const turn = chess.turn() === 'w' ? 'white' : 'black';
    const side = sides[turn];
    const deficit = materialDeficitPoints(chess.fen(), turn);
    if (!engineRef.current) {
      setRunning(false);
      setStatus('Stockfish unavailable. Return and retry after engine files are available.');
      return;
    }
    let choice;
    try {
      const sideOfficialElo = turn === 'white' ? publicRatingForSide('white') : publicRatingForSide('black');
      choice = await chooseMove(engineRef.current, chess.fen(), {
        skills: side.skills,
        officialElo: sideOfficialElo,
        fatigue: side.fatigue,
        confidence: side.confidence,
        materialDeficitPoints: deficit,
        playedMoves: timeline.slice(0, currentPly),
        seed: Date.now() + currentPly * 17
      });
      analysisErrorStreakRef.current = 0;
    } catch {
      analysisErrorStreakRef.current += 1;
      if (analysisErrorStreakRef.current < 3) {
        setStatus(`Engine analysis hiccup. Retrying... (${analysisErrorStreakRef.current}/2)`);
        return;
      }
      setRunning(false);
      setStatus('Engine analysis failed repeatedly. Please retry.');
      return;
    }

    if (choice.uci === '0000') {
      finishGame(chess, timeline.slice(0, currentPly));
      return;
    }

    try {
      const summary = applyUciMove(chess, choice.uci);
      const nextMoves = [...timeline.slice(0, currentPly), summary.uci];
      movesRef.current = nextMoves;
      viewPlyRef.current = nextMoves.length;
      setMoves(nextMoves);
      setMoveQualities((prev) => [...prev.slice(0, currentPly), (choice.selectedRank >= 4 ? 4 : choice.selectedRank) as 1 | 2 | 3 | 4]);
      setViewPly(nextMoves.length);
      setEvalWhiteCpByPly((prev) => [...prev, turn === 'white' ? choice.cp : -choice.cp]);
      setTelemetryBySide((prev) => ({ ...prev, [turn]: choice.telemetry }));
      setStatus(`${side.name} played ${summary.san} (${choice.reason})`);
    } catch {
      const legal = chess.moves({ verbose: true });
      if (legal.length === 0) {
        setStatus('No legal fallback move available. Ending game.');
        finishGame(chess, timeline.slice(0, currentPly));
        return;
      }
      const fallback = legal[Math.floor(Math.random() * legal.length)]!;
      const fallbackSummary = chess.move(fallback);
      if (!fallbackSummary) {
        setStatus('Fallback move failed, ending game safely.');
        finishGame(chess, timeline.slice(0, currentPly));
        return;
      }
      const fallbackUci = `${fallbackSummary.from}${fallbackSummary.to}${fallbackSummary.promotion ?? ''}`;
      const nextMoves = [...timeline.slice(0, currentPly), fallbackUci];
      movesRef.current = nextMoves;
      viewPlyRef.current = nextMoves.length;
      setMoves(nextMoves);
      setMoveQualities((prev) => [...prev.slice(0, currentPly), 4]);
      setViewPly(nextMoves.length);
      setStatus('Engine returned invalid move. Applied random legal fallback.');
      return;
    }

    if (gameResult(chess)) {
      finishGame(chess, movesRef.current.slice(0, viewPlyRef.current));
    }
  };

  useEffect(() => {
    if (!running) return;
    const id = window.setTimeout(() => {
      void tick();
    }, Math.max(80, 850 / speed));
    return () => clearTimeout(id);
  }, [running, speed, moves, viewPly]);

  const skipToResult = async () => {
    setRunning(false);
    if (replayMode) {
      setViewPly(movesRef.current.length);
      setStatus('Jumped to final position.');
      return;
    }
    setStatus('Skipping to result...');
    for (let i = 0; i < 320; i += 1) {
      const chess = chessFromTimeline(movesRef.current, viewPlyRef.current);
      if (gameResult(chess)) break;
      // eslint-disable-next-line no-await-in-loop
      await tick();
    }
    finishGame(chessFromTimeline(movesRef.current, viewPlyRef.current), movesRef.current.slice(0, viewPlyRef.current));
  };

  const evalCp = viewPly > 0 ? evalWhiteCpByPly[Math.min(viewPly - 1, evalWhiteCpByPly.length - 1)] : undefined;
  const drawChance = typeof evalCp === 'number' ? clamp01(0.34 - Math.min(0.24, Math.abs(evalCp) / 600), 0.08, 0.34) : 0.34;
  const baseWhite = typeof evalCp === 'number' ? clamp01(1 / (1 + Math.exp(-evalCp / 120)), 0.02, 0.98) : 0.5;
  const whiteWin = baseWhite * (1 - drawChance);
  const blackWin = (1 - baseWhite) * (1 - drawChance);
  const leaderText =
    typeof evalCp !== 'number'
      ? 'No live eval yet'
      : evalCp > 25
        ? `${sides.white.name} ahead`
        : evalCp < -25
          ? `${sides.black.name} ahead`
          : 'Roughly equal';
  const advantagePct = typeof evalCp === 'number' ? clamp01((evalCp + 450) / 900) * 100 : 50;

  return (
    <section className="panel live-watch">
      <h2>
        {replayMode ? 'Game Replay' : 'Live Watch'}: {context.tournamentName} (Month {context.week})
      </h2>
      <p>
        {sides.white.name} vs {sides.black.name}
      </p>
      <ChessBoard
        fen={displayFen}
        lastMoveUci={lastMoveUci}
        capturedWhite={capturedPieces.white}
        capturedBlack={capturedPieces.black}
        showMoveGraphics
      />
      <div className="button-row">
        <button onClick={() => setRunning((v) => !v)}>{running ? 'Pause' : 'Play'}</button>
        <button
          disabled={viewPly === 0}
          onClick={() => {
            setRunning(false);
            setViewPly((v) => Math.max(0, v - 1));
          }}
        >
          Prev Move
        </button>
        <button
          disabled={viewPly >= moves.length}
          onClick={() => {
            setRunning(false);
            setViewPly((v) => Math.min(moves.length, v + 1));
          }}
        >
          Next Move
        </button>
        <button
          disabled={viewPly === 0}
          onClick={() => {
            setRunning(false);
            setViewPly(0);
          }}
        >
          Start
        </button>
        <button
          disabled={viewPly === moves.length}
          onClick={() => {
            setRunning(false);
            setViewPly(moves.length);
          }}
        >
          End
        </button>
        <button onClick={() => setSpeed(1)}>1x</button>
        <button onClick={() => setSpeed(0.5)}>0.5x</button>
        <button onClick={() => setSpeed(2)}>2x</button>
        <button onClick={() => setSpeed(4)}>4x</button>
        <button onClick={() => void skipToResult()}>Skip to result</button>
      </div>
      {engineFailed ? <p className="lock-reason">Stockfish unavailable for this live game.</p> : null}
      {engineFailed && engineErrorDetail ? (
        <details className="standings-collapse">
          <summary>Engine Error Details</summary>
          <pre>{engineErrorDetail}</pre>
        </details>
      ) : null}
      <p className="cute-note">
        Move position: {viewPly}/{moves.length}
      </p>
      {viewPly > 0 ? (
        <p className="cute-note">
          Last move quality:{' '}
          <span className={`move-quality-tag q${moveQualities[viewPly - 1] ?? 0}`}>
            {moveQualities[viewPly - 1] === 1
              ? '✅ top move'
              : moveQualities[viewPly - 1] === 2
                ? '❗ second best'
                : moveQualities[viewPly - 1] === 3
                  ? '❗ third best'
                  : moveQualities[viewPly - 1] === 4
                    ? '‼ lower than third'
                    : '• not rated (replay)'}
          </span>
        </p>
      ) : null}
      <div className="live-eval-panel">
        <h3>Live Engine Outlook</h3>
        {typeof evalCp === 'number' ? (
          <>
            <p>
              Advantage: <strong>{leaderText}</strong> ({evalCp >= 0 ? '+' : ''}
              {(evalCp / 100).toFixed(2)} pawns from white&apos;s perspective)
            </p>
            <div className="eval-adv-bar" role="img" aria-label={`Advantage bar ${Math.round(advantagePct)} percent`}>
              <div className="eval-adv-fill" style={{ width: `${advantagePct}%` }} />
            </div>
            <div className="eval-prob-row">
              <span>{sides.white.name} win: {(whiteWin * 100).toFixed(1)}%</span>
              <span>Draw: {(drawChance * 100).toFixed(1)}%</span>
              <span>{sides.black.name} win: {(blackWin * 100).toFixed(1)}%</span>
            </div>
            <div className="eval-trend">
              {evalWhiteCpByPly.slice(-32).map((cp, idx) => {
                const h = 14 + clamp01(Math.abs(cp) / 50, 0, 14) * 4;
                return (
                  <span
                    key={`${idx}-${cp}`}
                    className={cp >= 0 ? 'up' : 'down'}
                    style={{ height: `${h}px` }}
                    title={`${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(2)} pawns`}
                  />
                );
              })}
            </div>
          </>
        ) : (
          <p className="cute-note">
            {replayMode
              ? 'Live Stockfish eval is available while simulating. Replay view currently has move list only.'
              : 'Waiting for first Stockfish-evaluated move...'}
          </p>
        )}
      </div>
      <p>{status}</p>
      <div className="live-stats-grid">
        {(['white', 'black'] as const).map((side) => {
          const sideData = sides[side];
          const model = telemetryBySide[side] ?? {
            ...policyPreview[side],
            movetimeMs: policyPreview[side].movetimeMs,
            multiPV: policyPreview[side].multiPV,
            temperature: policyPreview[side].temperature
          };
          return (
            <article key={side} className={`live-stats-card ${side}`}>
              <h3>{sideData.name}</h3>
              <p>
                Official Elo: <strong>{publicRatingForSide(side)}</strong>
              </p>
              <p>
                Current effective Elo: <strong>{model.effectiveElo}</strong>
              </p>
              <div className="policy-strip">
                <span>Phase: {model.phase}</span>
                <span>Phase Elo: {model.phaseElo}</span>
                <span>Blunder%: {(model.pBlunder * 100).toFixed(1)}</span>
                <span>Inacc%: {(model.pInaccuracy * 100).toFixed(1)}</span>
              </div>
              <div className="opponent-skills">
                <div>Opening: {sideData.skills.openingElo}</div>
                <div>Middlegame: {sideData.skills.middlegameElo}</div>
                <div>Endgame: {sideData.skills.endgameElo}</div>
                <div>Resilience: {sideData.skills.resilience}</div>
                <div>Competitiveness: {sideData.skills.competitiveness}</div>
                <div>Study Skills: {sideData.skills.studySkills}</div>
              </div>
            </article>
          );
        })}
      </div>
      <div className="move-list">
        {moves.slice(-24).map((move, idx) => {
          const quality = moveQualities[Math.max(0, moves.length - 24) + idx] ?? null;
          return (
            <span key={`${move}-${idx}`} className={`move-chip ${quality ? `q${quality}` : 'q0'}`}>
              <span className="move-quality-icon">
                {quality === 1 ? '✅' : quality === 2 ? '❗' : quality === 3 ? '❗' : quality === 4 ? '‼' : '•'}
              </span>
              {move}
            </span>
          );
        })}
      </div>
      <button onClick={onDone}>Done</button>
    </section>
  );
}
