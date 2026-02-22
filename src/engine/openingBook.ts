export interface OpeningLine {
  movesUci: string[];
  tags: string[];
  comfort: number;
}

export interface OpeningBook {
  lines: OpeningLine[];
}

let cache: OpeningBook | null = null;

export async function loadOpeningBook(): Promise<OpeningBook> {
  if (cache) return cache;
  const res = await fetch(`${import.meta.env.BASE_URL}openingBook.json`);
  if (!res.ok) {
    cache = { lines: [] };
    return cache;
  }
  cache = (await res.json()) as OpeningBook;
  return cache;
}

export function pickBookMove(book: OpeningBook, playedMoves: string[], prepStrength: number): string | null {
  const prefixMatches = book.lines.filter((line) =>
    playedMoves.every((move, idx) => line.movesUci[idx] && line.movesUci[idx] === move)
  );
  if (prefixMatches.length === 0) return null;

  const weighted = prefixMatches
    .map((line) => ({ line, weight: line.comfort * (0.5 + prepStrength * 0.5) }))
    .sort((a, b) => b.weight - a.weight);

  const selected = weighted[0]?.line;
  if (!selected) return null;
  return selected.movesUci[playedMoves.length] ?? null;
}
