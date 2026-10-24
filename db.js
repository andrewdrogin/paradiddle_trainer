// Tiny IndexedDB wrapper for recorded pad samples.

const DB_NAME = 'paradiddle-trainer';
const STORE = 'samples';

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

// sample: { kind: 'soft' | 'accent', sampleRate, data: Float32Array, peak, created }
export const listSamples = () => run('readonly', s => s.getAll());
export const addSample = sample => run('readwrite', s => s.add(sample));
export const deleteSample = id => run('readwrite', s => s.delete(id));
