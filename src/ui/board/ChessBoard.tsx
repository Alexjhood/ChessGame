/*
 * File Purpose: Reusable chessboard renderer component.
 * Key Mechanics: Draws board orientation, piece set, move highlights/arrows, and captured-piece side panels for puzzle/live views.
 */

const pieces: Record<string, string> = {
  p: '♟',
  r: '♜',
  n: '♞',
  b: '♝',
  q: '♛',
  k: '♚',
  P: '♙',
  R: '♖',
  N: '♘',
  B: '♗',
  Q: '♕',
  K: '♔'
};

function expandFenRow(row: string): string[] {
  const out: string[] = [];
  [...row].forEach((ch) => {
    if (/\d/.test(ch)) {
      const count = Number(ch);
      for (let i = 0; i < count; i += 1) out.push('');
    } else {
      out.push(ch);
    }
  });
  return out;
}

interface ChessBoardProps {
  fen: string;
  onSquareClick?: (square: string) => void;
  selectedSquare?: string | null;
  highlightedSquares?: string[];
  orientation?: 'white' | 'black';
  lastMoveUci?: string | null;
  capturedWhite?: string[];
  capturedBlack?: string[];
  showMoveGraphics?: boolean;
}

function toSquare(rank: number, file: number, orientation: 'white' | 'black'): string {
  const mappedRank = orientation === 'white' ? rank : 7 - rank;
  const mappedFile = orientation === 'white' ? file : 7 - file;
  return `${String.fromCharCode(97 + mappedFile)}${8 - mappedRank}`;
}

export function ChessBoard({
  fen,
  onSquareClick,
  selectedSquare,
  highlightedSquares = [],
  orientation = 'white',
  lastMoveUci,
  capturedWhite = [],
  capturedBlack = [],
  showMoveGraphics = false
}: ChessBoardProps) {
  const normalized =
    fen === 'start' ? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' : fen;
  const rows = (normalized.split(' ')[0] ?? '').split('/');
  const board = Array.from({ length: 8 }, (_, rank) => {
    const expanded = expandFenRow(rows[rank] ?? '8').slice(0, 8);
    while (expanded.length < 8) expanded.push('');
    return expanded;
  });

  const moveFrom = typeof lastMoveUci === 'string' && lastMoveUci.length >= 4 ? lastMoveUci.slice(0, 2) : null;
  const moveTo = typeof lastMoveUci === 'string' && lastMoveUci.length >= 4 ? lastMoveUci.slice(2, 4) : null;

  const squareCenter = (square: string): { x: number; y: number } | null => {
    if (!/^[a-h][1-8]$/.test(square)) return null;
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]);
    if (file < 0 || file > 7 || rank < 1 || rank > 8) return null;
    const visualFile = orientation === 'white' ? file : 7 - file;
    const visualRank = orientation === 'white' ? 8 - rank : rank - 1;
    return {
      x: ((visualFile + 0.5) / 8) * 100,
      y: ((visualRank + 0.5) / 8) * 100
    };
  };

  const fromPt = moveFrom ? squareCenter(moveFrom) : null;
  const toPt = moveTo ? squareCenter(moveTo) : null;

  const boardContent = (
    <div className="board-frame">
      <div className="board-grid" role="grid" aria-label="Chess board">
        {Array.from({ length: 8 }, (_, visualRank) =>
          Array.from({ length: 8 }, (_, visualFile) => {
            const sourceRank = orientation === 'white' ? visualRank : 7 - visualRank;
            const sourceFile = orientation === 'white' ? visualFile : 7 - visualFile;
            const piece = board[sourceRank]?.[sourceFile] ?? '';
            const dark = (visualRank + visualFile) % 2 === 1;
            const pieceTone = piece ? (piece === piece.toUpperCase() ? 'piece-white' : 'piece-black') : 'piece-empty';
            const square = toSquare(visualRank, visualFile, orientation);
            const isSelected = selectedSquare === square;
            const isHint = highlightedSquares.includes(square);
            const isMoveFrom = moveFrom === square;
            const isMoveTo = moveTo === square;
            return (
              <div
                key={`${visualRank}-${visualFile}`}
                className={`sq ${dark ? 'dark' : 'light'}${isSelected ? ' sq-selected' : ''}${isHint ? ' sq-highlight' : ''}${
                  onSquareClick ? ' sq-clickable' : ''
                }${isMoveFrom ? ' sq-last-from' : ''}${isMoveTo ? ' sq-last-to' : ''}`}
                onClick={onSquareClick ? () => onSquareClick(square) : undefined}
                role={onSquareClick ? 'button' : undefined}
                tabIndex={onSquareClick ? 0 : undefined}
                onKeyDown={
                  onSquareClick
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSquareClick(square);
                        }
                      }
                    : undefined
                }
              >
                <span className={`piece ${pieceTone}`}>{piece ? pieces[piece] : ' '}</span>
              </div>
            );
          })
        )}
      </div>
      {fromPt && toPt ? (
        <svg className="board-arrow-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <marker id="move-arrow-head" markerWidth="4" markerHeight="4" refX="2.8" refY="2" orient="auto">
              <path d="M0,0 L0,4 L4,2 z" fill="rgba(27, 123, 178, 0.92)" />
            </marker>
          </defs>
          <line
            x1={fromPt.x}
            y1={fromPt.y}
            x2={toPt.x}
            y2={toPt.y}
            stroke="rgba(27, 123, 178, 0.92)"
            strokeWidth="1.45"
            markerEnd="url(#move-arrow-head)"
            strokeLinecap="round"
          />
        </svg>
      ) : null}
    </div>
  );

  if (!showMoveGraphics) {
    return boardContent;
  }

  return (
    <div className="board-shell">
      <aside className="captured-rail" aria-label="Captured white pieces">
        <strong>Captured White</strong>
        <div className="captured-pieces">
          {capturedWhite.length === 0 ? <span className="captured-empty">-</span> : null}
          {capturedWhite.map((p, idx) => (
            <span key={`cw-${idx}-${p}`} className="captured-piece piece-white">
              {pieces[p] ?? '?'}
            </span>
          ))}
        </div>
      </aside>
      {boardContent}
      <aside className="captured-rail" aria-label="Captured black pieces">
        <strong>Captured Black</strong>
        <div className="captured-pieces">
          {capturedBlack.length === 0 ? <span className="captured-empty">-</span> : null}
          {capturedBlack.map((p, idx) => (
            <span key={`cb-${idx}-${p}`} className="captured-piece piece-black">
              {pieces[p] ?? '?'}
            </span>
          ))}
        </div>
      </aside>
    </div>
  );
}
