/*
 * File Purpose: Browser worker bridge for UCI engine sessions.
 * Key Mechanics: Initializes worker lifecycle, probes capabilities, applies UCI_Elo settings, and runs timed position analysis.
 */

import { parseInfoLine } from './parseUci';

export interface AnalysisCandidate {
  uci: string;
  san?: string;
  cp: number;
  mate?: number;
}

export interface AnalysisResult {
  candidates: AnalysisCandidate[];
  best: AnalysisCandidate;
  rawLines: string[];
}

export interface EngineHandle {
  id: string;
  worker: Worker;
  capabilities: {
    hasLimitStrength: boolean;
    hasUciElo: boolean;
    uciEloMin?: number;
    uciEloMax?: number;
  };
}

export interface AnalyzeOpts {
  movetimeMs: number;
  multiPV: number;
  targetElo?: number;
}

export interface MoveChoice {
  uci: string;
  cp: number;
  reason: 'best' | 'inaccuracy' | 'blunder' | 'sampled';
}

let seq = 0;

function toCp(cp?: number, mate?: number): number {
  if (typeof cp === 'number') return cp;
  if (typeof mate === 'number') {
    return mate > 0 ? 10000 - mate * 20 : -10000 - mate * 20;
  }
  return 0;
}

async function waitForReady(worker: Worker): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const seen: string[] = [];
    const timeout = setTimeout(() => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      const tail = seen.slice(-6).join(' | ');
      reject(new Error(`Stockfish init timeout${tail ? `; last messages: ${tail}` : ''}`));
    }, 12000);

    const onMessage = (evt: MessageEvent) => {
      const line = String(evt.data);
      if (seen.length < 24) seen.push(line);
      if (/abort|SharedArrayBuffer|pthreads|bad memory|failed/i.test(line)) {
        clearTimeout(timeout);
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        reject(new Error(`Stockfish init failed: ${line}`));
        return;
      }
      if (line.includes('readyok')) {
        clearTimeout(timeout);
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        resolve();
      }
    };
    const onError = (evt: ErrorEvent) => {
      clearTimeout(timeout);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      reject(
        new Error(
          `Stockfish worker failed to load: ${evt.message || 'unknown worker error'}${
            evt.filename ? ` @ ${evt.filename}:${evt.lineno}:${evt.colno}` : ''
          }`
        )
      );
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage('isready');
  });
}

async function probeCapabilities(worker: Worker): Promise<EngineHandle['capabilities']> {
  return await new Promise<EngineHandle['capabilities']>((resolve) => {
    const out: EngineHandle['capabilities'] = {
      hasLimitStrength: false,
      hasUciElo: false
    };
    const timeout = setTimeout(() => {
      worker.removeEventListener('message', onMessage);
      resolve(out);
    }, 2500);

    const onMessage = (evt: MessageEvent) => {
      const line = String(evt.data);
      if (line.startsWith('option name UCI_LimitStrength')) {
        out.hasLimitStrength = true;
      } else if (line.startsWith('option name UCI_Elo')) {
        out.hasUciElo = true;
        const minMatch = line.match(/\bmin\s+(-?\d+)/i);
        const maxMatch = line.match(/\bmax\s+(-?\d+)/i);
        if (minMatch) out.uciEloMin = Number(minMatch[1]);
        if (maxMatch) out.uciEloMax = Number(maxMatch[1]);
      } else if (line.startsWith('uciok')) {
        clearTimeout(timeout);
        worker.removeEventListener('message', onMessage);
        resolve(out);
      }
    };

    worker.addEventListener('message', onMessage);
    worker.postMessage('uci');
  });
}

export async function initEngine(): Promise<EngineHandle> {
  const isolated = typeof window !== 'undefined' ? window.crossOriginIsolated : true;
  const hasSab = typeof SharedArrayBuffer !== 'undefined';
  if (!isolated || !hasSab) {
    const host = typeof location !== 'undefined' ? location.host : '';
    const onGithubPages = /github\\.io$/i.test(host);
    const reason = !hasSab ? 'SharedArrayBuffer is unavailable' : 'cross-origin isolation is disabled';
    throw new Error(
      onGithubPages
        ? `Stockfish requires SharedArrayBuffer + cross-origin isolation, which this GitHub Pages host does not provide (${reason}).`
        : `Stockfish unavailable: ${reason}.`
    );
  }
  const worker = new Worker(`${import.meta.env.BASE_URL}stockfish/bridge-worker.js?v=2`);
  try {
    const capabilities = await probeCapabilities(worker);
    await waitForReady(worker);
    return {
      id: `engine_${seq++}`,
      worker,
      capabilities
    };
  } catch (err) {
    worker.terminate();
    throw err;
  }
}

export async function analyzePosition(
  handle: EngineHandle,
  fen: string,
  opts: AnalyzeOpts
): Promise<AnalysisResult> {
  const { worker } = handle;
  const rawLines: string[] = [];

  const result = await new Promise<AnalysisResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.removeEventListener('message', onMessage);
      reject(new Error('Stockfish timeout'));
    }, Math.max(5000, opts.movetimeMs * 10));

    const onMessage = (evt: MessageEvent) => {
      const line = String(evt.data);
      rawLines.push(line);
      if (line.startsWith('bestmove')) {
        clearTimeout(timeout);
        worker.removeEventListener('message', onMessage);

        const parsed = rawLines
          .map((l) => parseInfoLine(l))
          .filter((v): v is NonNullable<typeof v> => Boolean(v))
          .sort((a, b) => a.multipv - b.multipv)
          .slice(0, opts.multiPV)
          .map((p) => ({
            uci: p.pv[0]!,
            cp: toCp(p.cp, p.mate),
            mate: p.mate
          }));

        const uniq = parsed.filter((candidate, idx) => parsed.findIndex((c) => c.uci === candidate.uci) === idx);
        const candidates = uniq.length > 0 ? uniq : [{ uci: line.split(/\s+/)[1] ?? '0000', cp: 0 }];

        resolve({
          candidates,
          best: candidates[0]!,
          rawLines
        });
      }
    };

    worker.addEventListener('message', onMessage);
    if (typeof opts.targetElo === 'number' && handle.capabilities.hasLimitStrength && handle.capabilities.hasUciElo) {
      const min = typeof handle.capabilities.uciEloMin === 'number' ? handle.capabilities.uciEloMin : 1000;
      const max = typeof handle.capabilities.uciEloMax === 'number' ? handle.capabilities.uciEloMax : 3000;
      const target = Math.max(min, Math.min(max, Math.round(opts.targetElo)));
      worker.postMessage('setoption name UCI_LimitStrength value true');
      worker.postMessage(`setoption name UCI_Elo value ${target}`);
    }
    worker.postMessage('ucinewgame');
    worker.postMessage(`setoption name MultiPV value ${Math.max(1, Math.min(opts.multiPV, 8))}`);
    worker.postMessage(`position fen ${fen}`);
    worker.postMessage(`go movetime ${Math.max(8, opts.movetimeMs)}`);
  });

  return result;
}

export function terminateEngine(handle: EngineHandle): void {
  handle.worker.terminate();
}
