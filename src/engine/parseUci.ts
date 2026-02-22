/*
 * File Purpose: Parses UCI info lines into structured evaluations.
 * Key Mechanics: Extracts pv/multipv/score fields from Stockfish output for candidate ranking and diagnostics.
 */

export interface ParsedLine {
  multipv: number;
  cp?: number;
  mate?: number;
  pv: string[];
}

export function parseInfoLine(line: string): ParsedLine | null {
  if (!line.startsWith('info')) return null;
  const tokens = line.trim().split(/\s+/);
  const multipvIdx = tokens.indexOf('multipv');
  const scoreIdx = tokens.indexOf('score');
  const pvIdx = tokens.indexOf('pv');
  if (multipvIdx === -1 || scoreIdx === -1 || pvIdx === -1) return null;

  const multipv = Number(tokens[multipvIdx + 1]);
  const scoreType = tokens[scoreIdx + 1];
  const scoreValue = Number(tokens[scoreIdx + 2]);
  const pv = tokens.slice(pvIdx + 1);

  if (!Number.isFinite(multipv) || pv.length === 0) return null;

  if (scoreType === 'cp') {
    return { multipv, cp: scoreValue, pv };
  }
  if (scoreType === 'mate') {
    return { multipv, mate: scoreValue, pv };
  }
  return null;
}
