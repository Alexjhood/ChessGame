let enginePromise = null;
let engine = null;

function bindEngine(sf) {
  engine = sf;
  if (typeof sf.addMessageListener === 'function') {
    sf.addMessageListener((line) => self.postMessage(String(line)));
  } else if (typeof sf.onmessage === 'function') {
    const prev = sf.onmessage.bind(sf);
    sf.onmessage = (line) => {
      prev(line);
      self.postMessage(String(line));
    };
  } else {
    throw new Error('Stockfish API missing addMessageListener/onmessage');
  }
  return sf;
}

async function ensureEngine() {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    importScripts('/stockfish/stockfish.js?v=2');
    const factory = self.Stockfish;
    if (typeof factory !== 'function') {
      throw new Error('Stockfish factory not found on worker global');
    }
    // Emscripten pthread builds need an explicit main script URL when loaded
    // via importScripts from another worker, otherwise worker.js gets an
    // undefined urlOrBlob and fails URL.createObjectURL.
    const sf = await factory({
      mainScriptUrlOrBlob: new URL('/stockfish/stockfish.js?v=2', self.location.origin).toString()
    });
    return bindEngine(sf);
  })().catch((err) => {
    self.postMessage(`info string bridge init error: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  });
  return enginePromise;
}

self.onmessage = async (evt) => {
  try {
    await ensureEngine();
    if (!engine) throw new Error('Engine not ready');
    engine.postMessage(String(evt.data));
  } catch (err) {
    self.postMessage(`info string bridge runtime error: ${err instanceof Error ? err.message : String(err)}`);
  }
};
