#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const BAND_CENTERS = [500, 700, 900, 1100, 1300, 1500, 1700];
const BAND_RADIUS = 100;
const TOP_X_PER_BAND = Number(process.env.TOP_X_PER_BAND ?? 350);
const SOURCE_ZST = process.env.PUZZLE_ZST_PATH ?? path.resolve(__dirname, 'lichess_db_puzzle.csv.zst');
const OUT_JSON = process.env.PUZZLE_OUT_PATH ?? path.resolve(__dirname, '..', 'src', 'content', 'lichess_local_puzzles.json');

/**
 * Parse a CSV line with basic quote handling.
 * Lichess puzzle rows are simple, but this keeps the parser robust.
 * @param {string} line
 * @returns {string[]}
 */
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function toInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

/**
 * Assign rating to nearest configured band center within radius.
 * @param {number} rating
 * @returns {number | null}
 */
function assignBand(rating) {
  let bestCenter = null;
  let bestDist = Infinity;
  for (const center of BAND_CENTERS) {
    const dist = Math.abs(rating - center);
    if (dist <= BAND_RADIUS && dist < bestDist) {
      bestCenter = center;
      bestDist = dist;
    }
  }
  return bestCenter;
}

/**
 * @param {string} raw
 * @returns {string[]}
 */
function splitSpaceTags(raw) {
  if (!raw) return [];
  return raw
    .split(' ')
    .map((s) => s.trim())
    .filter(Boolean);
}

function bandRangeLabel(center) {
  return `${center - BAND_RADIUS}..${center + BAND_RADIUS}`;
}

async function main() {
  if (!fs.existsSync(SOURCE_ZST)) {
    throw new Error(`Missing source zst file: ${SOURCE_ZST}`);
  }
  if (!Number.isFinite(TOP_X_PER_BAND) || TOP_X_PER_BAND <= 0) {
    throw new Error(`Invalid TOP_X_PER_BAND: ${TOP_X_PER_BAND}`);
  }

  const bands = new Map(BAND_CENTERS.map((center) => [center, []]));
  const bandSeen = new Map(BAND_CENTERS.map((center) => [center, 0]));

  /**
   * Positive when a is better than b.
   * Ranking: popularity desc, nbPlays desc, id asc.
   */
  const compareQuality = (a, b) => {
    if (a.popularity !== b.popularity) return a.popularity - b.popularity;
    if (a.nbPlays !== b.nbPlays) return a.nbPlays - b.nbPlays;
    return b.id.localeCompare(a.id);
  };

  const keepTop = (center, entry) => {
    const bucket = bands.get(center);
    if (!bucket) return;
    bandSeen.set(center, (bandSeen.get(center) ?? 0) + 1);
    if (bucket.length < TOP_X_PER_BAND) {
      bucket.push(entry);
      // worst first, best last
      bucket.sort(compareQuality);
      return;
    }
    const worst = bucket[0];
    if (!worst) return;
    if (compareQuality(entry, worst) > 0) {
      bucket[0] = entry;
      bucket.sort(compareQuality);
    }
  };
  const zstdProc = spawn('zstd', ['-dc', SOURCE_ZST], {
    stdio: ['ignore', 'pipe', 'inherit']
  });

  const rl = readline.createInterface({
    input: zstdProc.stdout,
    crlfDelay: Infinity
  });

  let headerChecked = false;
  let totalRows = 0;
  let inBandRows = 0;
  let malformed = 0;

  for await (const line of rl) {
    if (!headerChecked) {
      headerChecked = true;
      if (!line.startsWith('PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags')) {
        throw new Error('Unexpected CSV header in lichess_db_puzzle.csv.zst');
      }
      continue;
    }

    totalRows += 1;
    const cols = parseCsvLine(line);
    if (cols.length < 10) {
      malformed += 1;
      continue;
    }

    const [id, fen, movesRaw, ratingRaw, , popularityRaw, nbPlaysRaw, themesRaw, gameUrl, openingRaw] = cols;
    const rating = toInt(ratingRaw, NaN);
    if (!id || !fen || !movesRaw || !Number.isFinite(rating)) {
      malformed += 1;
      continue;
    }
    const center = assignBand(rating);
    if (!center) continue;

    inBandRows += 1;
    const entry = {
      id,
      rating,
      popularity: toInt(popularityRaw, 0),
      nbPlays: toInt(nbPlaysRaw, 0),
      startFen: fen,
      solution: movesRaw.split(' ').filter(Boolean),
      themes: splitSpaceTags(themesRaw),
      openingTags: splitSpaceTags(openingRaw),
      gameUrl
    };
    keepTop(center, entry);
  }

  await new Promise((resolve, reject) => {
    zstdProc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`zstd exited with code ${code}`));
    });
    zstdProc.on('error', (err) => reject(err));
  });

  const selected = [];
  const perBandSummary = [];

  for (const center of BAND_CENTERS) {
    const list = bands.get(center) ?? [];
    // convert from worst-first to best-first
    const top = [...list].sort((a, b) => {
      if (b.popularity !== a.popularity) return b.popularity - a.popularity;
      if (b.nbPlays !== a.nbPlays) return b.nbPlays - a.nbPlays;
      return a.id.localeCompare(b.id);
    });
    selected.push(...top);
    perBandSummary.push({
      center,
      range: bandRangeLabel(center),
      available: bandSeen.get(center) ?? 0,
      selected: top.length,
      popularityMin: top.length > 0 ? top[top.length - 1].popularity : null,
      popularityMax: top.length > 0 ? top[0].popularity : null
    });
  }

  selected.sort((a, b) => {
    if (a.rating !== b.rating) return a.rating - b.rating;
    if (b.popularity !== a.popularity) return b.popularity - a.popularity;
    return a.id.localeCompare(b.id);
  });

  const withRefs = selected.map((p, idx) => {
    const puzzleNo = idx + 1;
    return {
      ...p,
      puzzleNo,
      localRef: `LP-${String(puzzleNo).padStart(5, '0')}`
    };
  });

  fs.writeFileSync(OUT_JSON, JSON.stringify(withRefs));

  console.log('Built local puzzle dataset.');
  console.log(`Source rows: ${totalRows}, in-band rows: ${inBandRows}, malformed: ${malformed}`);
  console.log(`Output puzzles: ${withRefs.length} -> ${OUT_JSON}`);
  perBandSummary.forEach((s) => {
    console.log(
      `Band ${s.center} (${s.range}): selected ${s.selected}/${s.available}, popularity range ${s.popularityMin}..${s.popularityMax}`
    );
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
