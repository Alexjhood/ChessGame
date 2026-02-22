/*
 * File Purpose: Puzzle dataset loading and challenge selection.
 * Key Mechanics: Selects local puzzles by Elo bands, tracks cache/diagnostics, and returns playable challenge payloads.
 */

import { Chess } from 'chess.js';
import localPuzzlePoolRaw from '../content/lichess_local_puzzles.json';

const LICHESS_API_BASE = 'https://lichess.org/api';
let activeLichessToken = '';
const API_MIN_GAP_MS = 1000;
const API_429_COOLDOWN_MS = 60_000;
let apiQueue: Promise<void> = Promise.resolve();
let nextAllowedAt = 0;
let rateLimitedUntil = 0;
const RECENT_FETCH_TRACE_LIMIT = 30;
const recentFetchTrace: Array<{
  at: string;
  url: string;
  status: number;
  note: string;
  puzzleId?: string;
}> = [];

function pushFetchTrace(entry: { url: string; status: number; note: string; puzzleId?: string }): void {
  recentFetchTrace.unshift({
    at: new Date().toISOString(),
    ...entry
  });
  if (recentFetchTrace.length > RECENT_FETCH_TRACE_LIMIT) {
    recentFetchTrace.length = RECENT_FETCH_TRACE_LIMIT;
  }
}

export interface PuzzleChallenge {
  id: string;
  rating: number;
  startFen: string;
  solution: string[];
  localRef?: string;
  puzzleNo?: number;
  popularity?: number;
  nbPlays?: number;
  themes?: string[];
  openingTags?: string[];
  gameUrl?: string;
}

export function setLichessApiToken(token: string): void {
  activeLichessToken = token.trim();
}

export interface PuzzleApiDebugState {
  now: string;
  rateLimitUntil: string | null;
  cooldownRemainingMs: number;
  queueDelayRemainingMs: number;
  queueDelayUntil: string | null;
  sourceMode: 'local_pool';
  localPoolTotal: number;
  localPoolCursor: number;
  hasToken: boolean;
  tokenLength: number;
}

export function getPuzzleApiDebugState(): PuzzleApiDebugState {
  const nowTs = Date.now();
  const cooldownRemaining = Math.max(0, rateLimitedUntil - nowTs);
  const queueDelayRemaining = Math.max(0, nextAllowedAt - nowTs);
  return {
    now: new Date(nowTs).toISOString(),
    rateLimitUntil: cooldownRemaining > 0 ? new Date(rateLimitedUntil).toISOString() : null,
    cooldownRemainingMs: cooldownRemaining,
    queueDelayRemainingMs: queueDelayRemaining,
    queueDelayUntil: queueDelayRemaining > 0 ? new Date(nextAllowedAt).toISOString() : null,
    sourceMode: 'local_pool',
    localPoolTotal: LOCAL_POOL.length,
    localPoolCursor: loadLocalPoolCursor(),
    hasToken: activeLichessToken.length > 0,
    tokenLength: activeLichessToken.length
  };
}

export function getRecentPuzzleFetchTrace(): Array<{ at: string; url: string; status: number; note: string; puzzleId?: string }> {
  return [...recentFetchTrace];
}

function getRateLimitRemainingMs(): number {
  return Math.max(0, rateLimitedUntil - Date.now());
}

function getQueueDelayRemainingMs(): number {
  return Math.max(0, nextAllowedAt - Date.now());
}

export interface PuzzleDiagnosticStep {
  name: string;
  url: string;
  status: number;
  ok: boolean;
  note: string;
  sample?: string;
}

export interface PuzzleDiagnostics {
  checkedAt: string;
  steps: PuzzleDiagnosticStep[];
  summary: string;
}

export interface PuzzleCacheStats {
  total: number;
  byBand: Array<{ band: string; count: number }>;
}

const PUZZLE_CACHE_KEY = 'lichess_puzzle_cache_v1';
const LOCAL_POOL_CURSOR_KEY = 'lichess_local_puzzle_pool_cursor_v1';
const PUZZLE_BAND_DECK_KEY = 'lichess_puzzle_band_decks_v1';
const PUZZLE_CACHE_LIMIT = 10000;
const LOCAL_POOL: PuzzleChallenge[] = Array.isArray(localPuzzlePoolRaw)
  ? (localPuzzlePoolRaw as PuzzleChallenge[]).map((p, idx) => {
      const puzzleNo = idx + 1;
      const localRef = p.localRef ?? `LP-${String(puzzleNo).padStart(5, '0')}`;
      return {
        ...p,
        localRef,
        puzzleNo
      };
    })
  : [];
const LOCAL_BY_ID = new Map(LOCAL_POOL.map((p) => [p.id, p]));
const LOCAL_META_BY_ID = new Map(LOCAL_POOL.map((p) => [p.id, { localRef: p.localRef, puzzleNo: p.puzzleNo }]));

function withLocalMetadata(puzzle: PuzzleChallenge): PuzzleChallenge {
  const local = LOCAL_META_BY_ID.get(puzzle.id);
  if (!local) return puzzle;
  return {
    ...puzzle,
    localRef: puzzle.localRef ?? local.localRef,
    puzzleNo: puzzle.puzzleNo ?? local.puzzleNo
  };
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function loadLocalPoolCursor(): number {
  if (!canUseStorage()) return 0;
  try {
    const raw = window.localStorage.getItem(LOCAL_POOL_CURSOR_KEY);
    const parsed = Number(raw ?? 0);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.floor(parsed);
  } catch {
    return 0;
  }
}

function saveLocalPoolCursor(cursor: number): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(LOCAL_POOL_CURSOR_KEY, String(Math.max(0, Math.floor(cursor))));
  } catch {
    // ignore storage failures
  }
}

function loadPuzzleCache(): PuzzleChallenge[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(PUZZLE_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (p): p is PuzzleChallenge =>
          Boolean(p) &&
          typeof (p as PuzzleChallenge).id === 'string' &&
          typeof (p as PuzzleChallenge).rating === 'number' &&
          typeof (p as PuzzleChallenge).startFen === 'string' &&
          Array.isArray((p as PuzzleChallenge).solution)
      )
      .map((p) => withLocalMetadata(p));
  } catch {
    return [];
  }
}

function savePuzzleCache(items: PuzzleChallenge[]): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(PUZZLE_CACHE_KEY, JSON.stringify(items.slice(0, PUZZLE_CACHE_LIMIT)));
  } catch {
    // ignore storage failures
  }
}

function mergePuzzleCache(items: PuzzleChallenge[]): void {
  if (items.length === 0) return;
  const existing = loadPuzzleCache();
  const merged = new Map<string, PuzzleChallenge>();
  items.forEach((p) => merged.set(p.id, withLocalMetadata(p)));
  existing.forEach((p) => {
    if (!merged.has(p.id)) merged.set(p.id, withLocalMetadata(p));
  });
  savePuzzleCache([...merged.values()]);
}

function pickRandomFromCacheBand(targetElo: number, halfRange = 100): PuzzleChallenge | null {
  const cache = loadPuzzleCache();
  if (cache.length === 0) return null;
  const r = Math.max(1, Math.floor(halfRange));
  const lo = targetElo - r;
  const hi = targetElo + r;
  const inBand = cache.filter((p) => p.rating >= lo && p.rating <= hi);
  if (inBand.length === 0) return null;
  const idx = Math.floor(Math.random() * inBand.length);
  return inBand[idx] ?? null;
}

type BandDeckState = Record<string, { ids: string[]; cursor: number }>;

function loadBandDeckState(): BandDeckState {
  if (!canUseStorage()) return {};
  try {
    const raw = window.localStorage.getItem(PUZZLE_BAND_DECK_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as BandDeckState;
  } catch {
    return {};
  }
}

function saveBandDeckState(state: BandDeckState): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(PUZZLE_BAND_DECK_KEY, JSON.stringify(state));
  } catch {
    // ignore storage failures
  }
}

function shuffled<T>(arr: T[]): T[] {
  const next = [...arr];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = next[i];
    next[i] = next[j]!;
    next[j] = a!;
  }
  return next;
}

function nextPuzzleFromLocalBand(targetElo: number, halfRange = 100): PuzzleChallenge | null {
  const r = Math.max(1, Math.floor(halfRange));
  const lo = targetElo - r;
  const hi = targetElo + r;
  const candidates = LOCAL_POOL.filter((p) => p.rating >= lo && p.rating <= hi);
  if (candidates.length === 0) return null;
  const bandKey = `${lo}-${hi}`;
  const candidateIds = candidates.map((p) => p.id);
  const state = loadBandDeckState();
  let entry = state[bandKey];
  const currentIds = new Set(entry?.ids ?? []);
  const validDeck =
    Boolean(entry) &&
    entry!.ids.length === candidateIds.length &&
    candidateIds.every((id) => currentIds.has(id));
  if (!validDeck) {
    entry = { ids: shuffled(candidateIds), cursor: 0 };
  }
  if (!entry || entry.ids.length === 0) return null;
  if (entry.cursor >= entry.ids.length) {
    entry.ids = shuffled(candidateIds);
    entry.cursor = 0;
  }
  const selectedId = entry.ids[entry.cursor];
  entry.cursor += 1;
  state[bandKey] = entry;
  saveBandDeckState(state);
  if (!selectedId) return null;
  const pick = LOCAL_BY_ID.get(selectedId) ?? null;
  return pick ? withLocalMetadata(pick) : null;
}

export function getPuzzleCacheStats(): PuzzleCacheStats {
  const cache = loadPuzzleCache();
  const buckets = new Map<string, number>();
  cache.forEach((p) => {
    const lo = Math.floor(p.rating / 200) * 200;
    const hi = lo + 199;
    const band = `${lo}-${hi}`;
    buckets.set(band, (buckets.get(band) ?? 0) + 1);
  });
  const byBand = [...buckets.entries()]
    .sort((a, b) => Number(a[0].split('-')[0]) - Number(b[0].split('-')[0]))
    .map(([band, count]) => ({ band, count }));
  return { total: cache.length, byBand };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function queuedLichessFetch(
  url: string,
  opts: { withAuth: boolean }
): Promise<Response> {
  return await new Promise<Response>((resolve, reject) => {
    apiQueue = apiQueue
      .catch(() => undefined)
      .then(async () => {
        const now = Date.now();
        if (nextAllowedAt > now) {
          await wait(nextAllowedAt - now);
        }

        const headers: Record<string, string> = { Accept: 'application/json' };
        if (opts.withAuth) headers.Authorization = `Bearer ${activeLichessToken}`;

        try {
          const res = await fetch(url, { headers });

          if (res.status === 429) {
            rateLimitedUntil = Date.now() + API_429_COOLDOWN_MS;
            nextAllowedAt = Math.max(nextAllowedAt, rateLimitedUntil);
            pushFetchTrace({
              url,
              status: 429,
              note: `Rate-limited. Cooldown ${Math.ceil(API_429_COOLDOWN_MS / 1000)}s`
            });
            reject(
              new Error(`Lichess rate limit hit (429). Waiting ${Math.ceil(API_429_COOLDOWN_MS / 1000)}s before new requests.`)
            );
            return;
          }

          nextAllowedAt = Math.max(nextAllowedAt, Date.now() + API_MIN_GAP_MS);
          pushFetchTrace({
            url,
            status: res.status,
            note: res.ok ? 'OK' : `HTTP ${res.status}`
          });
          resolve(res);
        } catch (err) {
          pushFetchTrace({
            url,
            status: 0,
            note: err instanceof Error ? err.message : 'Network error'
          });
          reject(err instanceof Error ? err : new Error('Network error'));
        }
      });
  });
}

function extractMovesFromPgn(pgn: string): string[] {
  const parser = new Chess();
  parser.loadPgn(pgn);
  return parser.history();
}

function fenAtInitialPly(pgn: string, initialPly: number): string {
  const history = extractMovesFromPgn(pgn);
  const chess = new Chess();
  for (let i = 0; i < Math.max(0, Math.min(initialPly, history.length)); i += 1) {
    chess.move(history[i]!);
  }
  return chess.fen();
}

function normalizePuzzlePayload(raw: unknown): PuzzleChallenge | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const puzzle = (data.puzzle ?? data) as Record<string, unknown>;
  const game = (data.game ?? {}) as Record<string, unknown>;

  const id = typeof puzzle.id === 'string' ? puzzle.id : null;
  const rating = typeof puzzle.rating === 'number' ? puzzle.rating : Number(puzzle.rating ?? NaN);
  const solution = Array.isArray(puzzle.solution)
    ? puzzle.solution.filter((m): m is string => typeof m === 'string')
    : [];
  const initialPly = typeof puzzle.initialPly === 'number' ? puzzle.initialPly : Number(puzzle.initialPly ?? 0);

  let startFen: string | null = null;
  if (typeof game.fen === 'string') startFen = game.fen;
  if (!startFen && typeof game.pgn === 'string') startFen = fenAtInitialPly(game.pgn, initialPly);
  if (!startFen && typeof data.fen === 'string') startFen = data.fen;

  if (!id || !Number.isFinite(rating) || !startFen || solution.length === 0) return null;
  return withLocalMetadata({ id, rating, startFen, solution });
}

async function fetchNextPuzzle(): Promise<PuzzleChallenge> {
  const url = `${LICHESS_API_BASE}/puzzle/next`;
  const res = await queuedLichessFetch(url, { withAuth: true });
  if (!res.ok) {
    const sample = (await res.text()).slice(0, 220);
    throw new Error(`Lichess puzzle API failed (${res.status}): ${sample || 'no response body'}`);
  }
  const json = (await res.json()) as unknown;
  const normalized = normalizePuzzlePayload(json);
  if (!normalized) throw new Error('Lichess puzzle payload missing expected fields');
  pushFetchTrace({
    url,
    status: 200,
    note: `Puzzle payload received (${normalized.rating})`,
    puzzleId: normalized.id
  });
  return normalized;
}

function nextPuzzleFromLocalPool(cursor: number): PuzzleChallenge | null {
  if (LOCAL_POOL.length === 0) return null;
  const idx = cursor % LOCAL_POOL.length;
  const pick = LOCAL_POOL[idx];
  if (!pick) return null;
  return {
    id: pick.id,
    rating: pick.rating,
    startFen: pick.startFen,
    solution: [...pick.solution],
    localRef: pick.localRef,
    puzzleNo: pick.puzzleNo,
    popularity: pick.popularity,
    nbPlays: pick.nbPlays,
    themes: pick.themes ? [...pick.themes] : [],
    openingTags: pick.openingTags ? [...pick.openingTags] : [],
    gameUrl: pick.gameUrl
  };
}

export async function fetchDailyPuzzle(): Promise<PuzzleChallenge> {
  const res = await queuedLichessFetch(`${LICHESS_API_BASE}/puzzle/daily`, { withAuth: false });
  if (!res.ok) {
    const sample = (await res.text()).slice(0, 220);
    throw new Error(`Lichess daily puzzle failed (${res.status}): ${sample || 'no response body'}`);
  }
  const json = (await res.json()) as unknown;
  const normalized = normalizePuzzlePayload(json);
  if (!normalized) throw new Error('Lichess daily puzzle payload missing expected fields');
  return normalized;
}

export async function fetchPuzzleNearElo(
  targetElo: number,
  _tolerance = 120,
  _maxPulls = 10,
  onAttempt?: (info: { attempt: number; maxPulls: number; rating: number; dist: number }) => void
): Promise<PuzzleChallenge> {
  const localBandPick = nextPuzzleFromLocalBand(targetElo, 100);
  if (localBandPick) {
    onAttempt?.({
      attempt: 0,
      maxPulls: _maxPulls,
      rating: localBandPick.rating,
      dist: Math.abs(localBandPick.rating - targetElo)
    });
    return withLocalMetadata(localBandPick);
  }
  const cachedBandPick = pickRandomFromCacheBand(targetElo, 100);
  if (cachedBandPick) {
    onAttempt?.({
      attempt: 0,
      maxPulls: _maxPulls,
      rating: cachedBandPick.rating,
      dist: Math.abs(cachedBandPick.rating - targetElo)
    });
    return withLocalMetadata(cachedBandPick);
  }
  const stats = getPuzzleCacheStats();
  throw new Error(
    `No puzzle available in Elo band ${targetElo - 100}-${targetElo + 100}. Local pool total: ${LOCAL_POOL.length}; cache total: ${stats.total}.`
  );
}

export async function buildPuzzleDataset(
  targetCount: number,
  onProgress?: (p: {
    pulled: number;
    target: number;
    latestRating?: number;
    cacheTotal: number;
    stage: 'requesting' | 'stored' | 'retry' | 'cooldown' | 'duplicate';
    index: number;
    message?: string;
  }) => void
): Promise<PuzzleCacheStats> {
  const maxTarget = Math.max(1, Math.floor(targetCount));
  if (LOCAL_POOL.length === 0) {
    throw new Error('Local puzzle pool is empty. Rebuild src/content/lichess_local_puzzles.json from analysis CSV.');
  }
  const existingIds = new Set(loadPuzzleCache().map((p) => p.id));
  let pulledCount = 0;
  let localSteps = 0;
  let duplicateCount = 0;
  const maxLocalSteps = Math.max(maxTarget * 100, LOCAL_POOL.length);
  let cursor = loadLocalPoolCursor();
  while (pulledCount < maxTarget && localSteps < maxLocalSteps) {
    const puzzleIndex = pulledCount + 1;
    const beforeStats = getPuzzleCacheStats();
    onProgress?.({
      pulled: pulledCount,
      target: maxTarget,
      cacheTotal: beforeStats.total,
      stage: 'requesting',
      index: puzzleIndex,
      message: `Loading local puzzle ${puzzleIndex}/${maxTarget} from pool cursor ${cursor}.`
    });
    const puzzle = nextPuzzleFromLocalPool(cursor);
    cursor += 1;
    localSteps += 1;
    saveLocalPoolCursor(cursor);
    if (!puzzle) {
      throw new Error('Local puzzle pool lookup failed unexpectedly.');
    }
    pushFetchTrace({
      url: 'local://lichess_local_puzzles.json',
      status: 200,
      note: 'Loaded from local puzzle pool',
      puzzleId: puzzle.id
    });
    if (existingIds.has(puzzle.id)) {
      duplicateCount += 1;
      const stats = getPuzzleCacheStats();
      onProgress?.({
        pulled: pulledCount,
        target: maxTarget,
        latestRating: puzzle.rating,
        cacheTotal: stats.total,
        stage: 'duplicate',
        index: puzzleIndex,
        message: `Duplicate local puzzle id ${puzzle.id}. Advancing cursor... (${duplicateCount} duplicates seen)`
      });
      continue;
    }
    existingIds.add(puzzle.id);
    mergePuzzleCache([puzzle]);
    const stats = getPuzzleCacheStats();
    pulledCount += 1;
    onProgress?.({
      pulled: pulledCount,
      target: maxTarget,
      latestRating: puzzle.rating,
      cacheTotal: stats.total,
      stage: 'stored',
      index: puzzleIndex,
      message: `Stored puzzle ${puzzleIndex}/${maxTarget} (Elo ${puzzle.rating}) from local pool.`
    });
    // eslint-disable-next-line no-await-in-loop
    await wait(10);
  }

  if (pulledCount < maxTarget) {
    const stats = getPuzzleCacheStats();
    throw new Error(
      `Could not add enough unique local puzzles: added ${pulledCount}/${maxTarget} after ${localSteps} local steps (${duplicateCount} duplicates). Cache total: ${stats.total}.`
    );
  }

  return getPuzzleCacheStats();
}

async function probeEndpoint(name: string, url: string, withAuth: boolean): Promise<PuzzleDiagnosticStep> {
  try {
    const res = await queuedLichessFetch(url, { withAuth });
    const body = (await res.text()).slice(0, 220);
    let note = res.ok ? 'OK' : 'Request failed';
    if (res.status === 401) note = 'Unauthorized (token invalid/expired/missing scope)';
    if (res.status === 403) note = 'Forbidden (token lacks permission or endpoint disallows this client)';
    return {
      name,
      url,
      status: res.status,
      ok: res.ok,
      note,
      sample: body
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Network error';
    if (detail.includes('429')) {
      return {
        name,
        url,
        status: 429,
        ok: false,
        note: detail
      };
    }
    return {
      name,
      url,
      status: 0,
      ok: false,
      note: detail
    };
  }
}

export async function runPuzzleDiagnostics(options: { includeNextPuzzleProbe?: boolean } = {}): Promise<PuzzleDiagnostics> {
  const includeNextPuzzleProbe = options.includeNextPuzzleProbe ?? true;
  const steps: PuzzleDiagnosticStep[] = [];
  steps.push(await probeEndpoint('Daily puzzle (public)', `${LICHESS_API_BASE}/puzzle/daily`, false));
  steps.push(await probeEndpoint('Account (auth test)', `${LICHESS_API_BASE}/account`, true));
  if (includeNextPuzzleProbe) {
    steps.push(await probeEndpoint('Next puzzle (auth)', `${LICHESS_API_BASE}/puzzle/next`, true));
  } else {
    steps.push({
      name: 'Next puzzle (auth)',
      url: `${LICHESS_API_BASE}/puzzle/next`,
      status: -1,
      ok: true,
      note: 'Skipped while dataset pull is active (to avoid extending rate-limit cooldown).'
    });
  }

  const authStep = steps.find((s) => s.name.includes('Account'));
  const nextStep = steps.find((s) => s.name.includes('Next puzzle'));
  let summary = 'Diagnostics complete.';
  if (steps.some((s) => s.status === 429 || s.note.includes('429'))) {
    summary = 'Lichess rate limit is active for puzzle pulls. Wait for cooldown, then continue.';
  } else if (authStep && authStep.status === 401) {
    summary = 'Token authentication failed. The API key/token is likely invalid for Lichess OAuth endpoints.';
  } else if (nextStep && nextStep.status === 401) {
    summary = 'Authenticated, but puzzle endpoint rejected token (scope/account permission issue).';
  } else if (steps.some((s) => s.status === 0)) {
    summary = 'Network/CORS issue reaching Lichess from browser runtime.';
  } else if (steps.every((s) => s.ok)) {
    summary = 'All checks passed. Puzzle loading should work.';
  }

  return {
    checkedAt: new Date().toISOString(),
    steps,
    summary
  };
}
