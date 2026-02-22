# ♟️ Tiny Tactics Club

A colourful chess-career simulator where you manage a young player month-by-month through training, puzzles, and tournaments.

## 🌈 What This Game Includes
- **Career progression** from beginner level to title milestones.
- **Two Elo layers**:
  - **Official Elo**: changes from tournament results via Elo formula.
  - **Skill Elos**: opening/middlegame/endgame + resilience/competitiveness/study habits.
- **Tournament simulation modes**:
  - Elo-only fast simulation
  - Stockfish-driven simulation for player games
  - Live watch + replay controls
- **Puzzle training system** using a local puzzle dataset (no live API dependency required for gameplay).
- **Avatar + onboarding tutorial** for first-time players.
- **Save/load/export** and simulation settings controls.

## 🧠 Core Gameplay Loop
1. Enter **Training** each month.
2. Solve puzzles to earn training credits.
3. Allocate credits to skills (or rest by leaving credits unused).
4. Enter a tournament and choose simulation mode.
5. Review results, Elo deltas, prizes, and skill progression.

## ⚙️ Simulation Mechanics (High-level)
- **Skill phase mapping**:
  - Opening skill controls early moves.
  - Middlegame skill controls mid phase (configurable thresholds).
  - Endgame skill controls late phase.
- **Fatigue** influences move quality and blunder risk.
- **Resilience** mitigates fatigue penalties.
- **Competitiveness** provides comeback boost when materially behind (configurable).
- **Official Elo updates** are based on result + expected score.

## 🧩 Puzzle System
- Uses **local dataset** (`/src/content/lichess_local_puzzles.json`).
- Puzzle buttons map to Elo bands (e.g. 500 => 400–600, 700 => 600–800, etc.).
- Solved puzzles grant stochastic rewards (Poisson-based, minimum reward floor supported).
- Puzzle metadata (themes/opening tags/reference) is shown during solve/review.

## 🗂️ Repository Structure
```text
.
├── .github/workflows/             # CI/CD (GitHub Pages deploy)
├── analysis/                      # Offline dataset build utilities
├── public/                        # Static assets (opening book, stockfish bundle)
├── src/
│   ├── app/                       # Route-level screens and flow composition
│   ├── chess/                     # Chess rules, phase logic, PGN helpers
│   ├── content/                   # Local content datasets (puzzles)
│   ├── engine/                    # Stockfish worker bridge + move policy
│   ├── sim/                       # Core simulation systems (ratings, tournaments, training)
│   │   └── content/               # Tournament/training content definitions
│   ├── state/                     # Zustand store + selectors
│   ├── tests/                     # Unit/integration calibration tests
│   └── ui/                        # Reusable UI components (board/live watch)
├── index.html                     # App shell
├── vite.config.ts                 # Build + dev server config
└── README.md
```

## 🚀 Local Development
### Prerequisites
- Node.js 20+
- npm (or pnpm)

### Run
```bash
npm install
npm run dev
```

### Build
```bash
npm run build
npm run preview
```

## ✅ Testing
Run all tests:
```bash
npm run test
```

Run a focused test file:
```bash
npm run test -- src/tests/weekly.test.ts
```

## 🌍 GitHub Pages Deployment
This repo is prepared for Pages via GitHub Actions.

1. Push to `main`
2. In GitHub: **Settings → Pages → Source: GitHub Actions**
3. Let workflow `Deploy to GitHub Pages` complete
4. Open deployed site URL

## 📌 Notes
- Stockfish web-worker assets live in `/public/stockfish`.
- For local threaded engine behavior, COOP/COEP headers are configured in Vite dev/preview.
- Large/generated artifacts are gitignored to keep history clean.

## 🧾 File-Level Documentation
Short **“File Purpose / Key Mechanics”** headers were added at the top of editable source/config scripts across the repository to make maintenance easier.

