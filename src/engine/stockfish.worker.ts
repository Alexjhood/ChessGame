/*
 * File Purpose: Documents stockfish bridge worker asset path contract.
 * Key Mechanics: Exports the worker asset reference used by runtime wiring and deployment-safe path resolution.
 */

// This file exists to document worker asset placement expectations.
// The runtime worker is loaded from /public/stockfish/bridge-worker.js,
// which then loads stockfish.js + stockfish.wasm internally.
export const stockfishWorkerAsset = `${import.meta.env.BASE_URL}stockfish/bridge-worker.js?v=2`;
