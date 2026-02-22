<!-- File Purpose: Product specification for the chess career simulator. -->
<!-- Key Mechanics: Captures feature intent, progression systems, and simulation expectations that guided implementation. -->

# Prodigy Chess Tycoon — Codex Build Spec (Web v1)

## 0) One-line pitch
A week-by-week “child chess prodigy” career sim. Each week you choose **Train** or **Tournament**. Tournaments can be **simulated instantly** or **watched live** as a real chess game, with move quality shaped by the prodigy’s evolving skill profile (opening/middlegame/endgame/tactics + psychology + time + prep + match play). Goal: become **World #1**.

---

## 1) Hard constraints (v1)
- Platform: **Web app** (React + TypeScript).
- Session pacing: **5–10 mins per week**, one major decision per week.
- Art: **cartoony, warm 2D**, simple but polished.
- Chess engine: **local in-browser Stockfish (WASM)**, no paid APIs.
  - Use lichess `stockfish.wasm` (very small bundle: ~400KB / ~150KB gzipped). Source: https://github.com/lichess-org/stockfish.wasm
- Chess rules: use **chess.js** for legality/FEN/PGN. Source: https://www.npmjs.com/package/chess.js
- State mgmt: lightweight (e.g. Zustand). Source: https://www.npmjs.com/package/zustand
- No “game over” failure state. Player can always recover.

---

## 2) Scope (MVP deliverable)
### MUST
1. **Week Loop**
   - Week number, inbox/event banner, one major action: `Train` OR `Tournament`.
2. **Stats + Progression**
   - Per-phase/per-skill Elo buckets + fatigue/energy/confidence/money/reputation.
3. **Tournaments**
   - At least **Swiss Open** template with 5–9 rounds.
   - Option to **Simulate tournament** OR **Watch selected game live**.
4. **Live Watch**
   - Real chess game played by engine-vs-engine with “humanization” tuned to stats.
   - Speed controls: 1× / 2× / 4× / Skip to result.
   - Save PGN for watched games.
5. **Save/Load**
   - LocalStorage save + export/import JSON.

### SHOULD
- Sponsors (simple meaningful economy: unlock coaches/tools, travel access).
- Rivals (named NPCs) with evolving ratings.

### NOT in v1
- Player taking over moves (watch-only for v1).
- Multiplayer.
- Backend server (keep fully client-side).

---

## 3) User experience & UI screens

### 3.1 Screens
1. **Home**
   - “New Career”, “Continue”, “Import Save”
2. **Career Dashboard (Week Screen)**
   - Left: Prodigy card (avatar, age, rating, title)
   - Center: Week choice cards (Train / Tournament)
   - Right: Stats summary + recent results
3. **Training Picker**
   - Pick one module (Opening/Middle/End/Tactics/Resilience/Time/Prep/MatchPlay)
4. **Tournament Picker**
   - List of events w/ strength, cost, prize pool, travel fatigue
5. **Tournament View**
   - Standings table, round-by-round results
   - For current round: “Sim game” or “Watch live”
6. **Live Watch (Board)**
   - Board, clocks (simplified), avatars + emotes, move list, speed controls
7. **History**
   - Past tournaments, PGNs, trophies/achievements (lightweight)

### 3.2 Art direction (implementation notes)
- 2D vector style preferred: SVG + CSS animations.
- Characters are simple “chibi” busts with 3–5 facial expressions.
- Tournament view: “broadcast overlay” vibe.

---

## 4) Core simulation model

### 4.1 Player state
Create a single `GameState` object.

**Required fields**
- `meta`: `{ version, seed, createdAt, lastPlayedAt }`
- `week`: number
- `ageYears`: number (starts e.g. 8.0; increments slowly; v1 can keep cosmetic)
- `publicRating`: number (Elo-like; starts e.g. 800–1000)
- `title`: enum `"None" | "CM" | "FM" | "IM" | "GM" | "WC" | "WorldNo1"`
- `money`: number
- `reputation`: number (0–100)
- `fatigue`: number (0–100) (higher = worse)
- `confidence`: number (-20..+20)
- `skills`: skill ratings (see 4.2)
- `inventory`: tools/coaches unlocked
- `history`: tournaments, games (PGN), sponsor contracts

### 4.2 Skill buckets (all required)
Represent as “internal Elo-like” values; initial values ~ `publicRating ± noise`.

- `openingElo` (moves 1–12)
- `middlegameElo` (moves 13–30-ish)
- `endgameElo` (simplified / low material)
- `tacticsElo` (blunder avoidance + tactical shots)
- `timeMgmt` (low time accuracy)
- `prep` (opening selection vs opponent; better book choices)
- `resilience` (tilt control after losses)
- `matchPlay` (practical conversion; tournament situation)

### 4.3 Weekly choice resolution
**Train**
- Choose 1 module.
- Apply:
  - skill gain for chosen module
  - small cross-gains
  - fatigue decreases slightly (restful study) OR increases slightly (intense) depending on module
  - confidence small increase
  - money cost optional (coach/tools)

**Tournament**
- Pay entry + travel.
- Increase fatigue.
- Play N rounds vs generated opponents.
- Update:
  - publicRating via Elo update per game
  - money via prizes
  - matchPlay grows with games played
  - resilience/timeMgmt can improve via “experience ticks”

### 4.4 Elo update (simplified)
Use standard Elo update with `K` depending on rating band and tournament strength.
- K suggestions:
  - <1200: K=40
  - 1200–1800: K=25
  - 1800–2200: K=15
  - >2200: K=10

### 4.5 Fatigue & confidence effects on performance
During a game, define a `performanceDelta` (in Elo points) based on:
- fatigue (high fatigue lowers effective strength)
- confidence (modest +/-)
- resilience (reduces negative swings after losses)
Keep effects subtle (±0–120 Elo).

---

## 5) Chess engine architecture (critical)

### 5.1 Engines to use
- Stockfish WASM via lichess build:
  - `stockfish.js`, `stockfish.wasm`, `stockfish.worker.js`
  - Loaded and run inside a Web Worker.
  - Source & usage: https://github.com/lichess-org/stockfish.wasm
- Chess legality and notation:
  - chess.js (`Chess`) for move gen, FEN, PGN.
  - Source: https://www.npmjs.com/package/chess.js

### 5.2 Design principle
We do **NOT** need exceptional play. We cap effective strength at **~2200** and prioritize:
- believable human-like mistakes
- phase-dependent strength (opening/mid/end)
- stat-driven style

### 5.3 Engine integration module
Create `/src/engine/stockfishWorker.ts` with a clean promise-based API.

**Public interface**
- `initEngine(): Promise<EngineHandle>`
- `analyzePosition(handle, fen, opts): Promise<AnalysisResult>`
- `chooseMove(handle, fen, policy): Promise<MoveChoice>`
- `terminateEngine(handle): void`

**AnalysisResult**
- `candidates`: Array of `{ uci: string, san?: string, cp: number, mate?: number }`
- `best`: candidate
- `rawLines`: string[] (optional; for debugging)

### 5.4 Candidate generation (MultiPV)
For each move request:
- send:
  - `uci`
  - `isready`
  - `ucinewgame`
  - `position fen <FEN>`
  - `setoption name MultiPV value <N>`
  - `go movetime <ms>` OR `go depth <d>` (prefer movetime for simplicity)
Parse output:
- `info multipv k score cp X pv <...>`

### 5.5 Humanization policy (stat-to-move mapping)
Implement `MovePolicy` that converts player stats + phase to sampling parameters.

**Phases**
- Opening: ply/move number <= 12
- Middlegame: 13–30
- Endgame: if material <= threshold OR <= 10 pieces (config)

**Policy parameters per phase**
- `movetimeMs` (engine time budget)
- `multiPV` (3–6)
- `temperature` (softmax sampling over candidate scores)
- `pInaccuracy` (choose 2nd/3rd line)
- `pBlunder` (choose worse line or inject “plausible mistake”)
- `pBook` (use curated opening line if available)
- `timeTroubleFactor` (if clocks used)

**Default mapping (v1)**
- Convert relevant skill Elo to a normalized strength:
  - `s = clamp((phaseElo - 800) / (2200 - 800), 0, 1)`
- Then:
  - `movetimeMs = lerp(10, 120, s)` (opening/mid) ; endgame can get +20ms
  - `temperature = lerp(2.0, 0.45, s)`
  - `multiPV = round(lerp(4, 6, s))`
  - `pBlunderBase = lerp(0.10, 0.005, s)` (then modified by tactics/time/fatigue)
  - `pInaccuracyBase = lerp(0.20, 0.03, s)`

**Tactics impact**
- If position is tactical (detected by large eval swing between best and 2nd best OR presence of forcing checks/captures):
  - reduce `pBlunder` more when `tacticsElo` is higher.
- Otherwise: tacticsElo has smaller effect.

**Time management impact**
- When in low-time (if we simulate clocks), increase temperature and pBlunder for low timeMgmt.

**Resilience impact**
- After a loss, apply a temporary “tilt debuff” unless resilience is high.

### 5.6 Opening repertoire + Prep (lightweight)
Create `openingBook.json` (tiny curated book; no huge files).
- Structure: list of lines from starting FEN.
- Each line includes moves in UCI or SAN and a “comfort score”.

Prep effect:
- Higher `prep` increases chance to stay in book for first ~8–10 moves.
- For known rival/opponent, pick lines that counter their style tag.

### 5.7 Opponent generation
Opponents have:
- `publicRating`
- style tag: `"Solid"|"Tactical"|"Aggressive"|"Endgame"`
- phase skews (e.g., endgame specialist has higher endgameElo than publicRating)
Opponents are created per round based on tournament strength distribution.

---

## 6) Tournament simulation

### 6.1 Swiss Open template (v1)
- 7 rounds (configurable).
- Pairings: simplified Swiss:
  - group by score, pair within group, avoid repeats if possible (simple heuristic).
- Result generation:
  - either full engine game (fast mode) OR probabilistic outcome based on effective Elo
  - For v1, do:
    - simulate most games with Elo probability
    - allow watching a selected game with full engine-vs-engine

### 6.2 Watch selection
Player can watch:
- 1 game per round OR only “feature games” (top board).
- Watching should not be mandatory.

---

## 7) File & repo structure

### 7.1 Tooling
- Vite + React + TS
- ESLint + Prettier
- Vitest for unit tests

### 7.2 Folder layout
/src
/app
routes.tsx
App.tsx
/state
store.ts (Zustand)
selectors.ts
/sim
models.ts (types)
rng.ts (seeded RNG)
weekly.ts (resolve week)
rating.ts (Elo update)
tournaments.ts (Swiss pairing + results)
opponents.ts
sponsors.ts (optional v1.1)
/chess
chessRules.ts (wrap chess.js)
pgn.ts
phases.ts
/engine
stockfish.ts (high-level API)
stockfish.worker.ts (worker wrapper)
parseUci.ts
policy.ts (humanization)
openingBook.ts
/ui
components/ (cards, buttons, tables)
board/ (board renderer + pieces)
tournament/ (standings + pairing views)
art/ (SVG assets)
/assets
pieces/ (simple SVG pieces)
avatars/ (simple SVG)
public/
stockfish/ (stockfish.js, stockfish.wasm, stockfish.worker.js)
openingBook.json

### 7.3 Engine assets handling (important)
- Place stockfish files under `public/stockfish/` and load worker from that directory.
- Ensure `stockfish.js`, `stockfish.wasm`, `stockfish.worker.js` are served from same directory (per lichess build requirements).

---

## 8) Data schemas (JSON content)

### 8.1 Training modules (`/src/sim/content/trainingModules.ts`)
Each module:
- `id`
- `label`
- `description`
- `effects`: map of skill deltas
- `fatigueDelta`
- `costMoney`
- `unlockReq` (optional)

### 8.2 Tournament templates (`/src/sim/content/tournaments.ts`)
- `id`, `name`, `rounds`, `avgOpponentRating`, `ratingStdDev`
- `entryFee`, `travelFatigue`, `prizePool`, `reputationReq`

### 8.3 Opening book (`public/openingBook.json`)
Keep tiny (a few dozen lines).
- `lines`: [{ `movesUci`: string[], `tags`: string[], `comfort`: number }]

---

## 9) Save/load format
- `GameState` serialized to JSON.
- Save key: `prodigy_chess_tycoon_save_v1`.
- Provide Export (download) and Import (upload JSON).

---

## 10) Testing & acceptance checks

### 10.1 Unit tests (Vitest)
- Elo update correctness.
- Weekly resolution applies expected deltas.
- Phase detection correct.
- Humanization policy returns stable parameters.

### 10.2 Manual acceptance checklist (MVP)
1. New career starts, week advances, saving/loading works.
2. Training increases selected skill and updates UI.
3. Tournament simulation runs end-to-end, standings displayed, rating changes.
4. Live watch runs a full legal game and ends in checkmate/draw/resign.
5. Changing openingElo noticeably improves early-game outcomes (lower blunder rate early; better candidate selection).
6. Tactics training reduces obvious blunders in tactical positions.
7. Performance never exceeds “superhuman”; cap around ~2200 effective.

---

## 11) Build plan (Codex execution order)

### Milestone 1 — Chess + engine sandbox
- Implement board rendering + chess.js wrapper.
- Integrate Stockfish WASM worker (init, position, go, parse MultiPV).
- Implement `chooseMove()` with:
  - MultiPV candidates
  - softmax sampling with temperature
  - simple blunder/inaccuracy selection
- Build `/sandbox` route: AI vs AI with adjustable `phaseElo` sliders.

**Exit criteria:** two AIs play legal games; sliders clearly change strength.

### Milestone 2 — Week loop + training
- Implement GameState + seeded RNG.
- Implement Week screen and Train action with module picker.
- Visualize skill changes (small sparkline optional).

**Exit criteria:** 20 weeks of training works and persists.

### Milestone 3 — Tournament sim + live watch
- Add Swiss tournament generator and simulator.
- Add tournament UI (standings + round results).
- Allow “Watch live” for one selected round game:
  - play engine moves sequentially with animation
  - speed controls + skip
  - save PGN into history

**Exit criteria:** tournament can be simulated quickly; live watch works reliably.

### Milestone 4 — Sponsors & economy (optional but recommended)
- Add coaches/tools as money sinks.
- Add sponsors that unlock better events and training efficiency.

**Exit criteria:** money matters; player choices trade off travel, training, and opportunities.

### Milestone 5 — Polish
- Art pass: avatars, expressions, transitions.
- Balance curves to make World #1 achievable but not trivial.

---

## 12) Notes / guardrails
- Keep engine calls minimal to avoid CPU spikes:
  - low movetime for weak play; scale up gradually.
  - MultiPV <= 6.
- Use Web Worker for Stockfish to keep UI smooth.
- Keep all content small (no large opening books, no tablebases).
- Prioritize “feels human” over “plays best”.

---

## 13) Definition of Done (v1)
A playable web game where:
- Player advances week-by-week with one decision per week.
- Tournaments can be simulated or watched live.
- Live games look and feel like realistic chess at the player’s current strength profile (phase-based + stat-driven).
- Saves work; no backend required.