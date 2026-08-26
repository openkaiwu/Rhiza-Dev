import '@testing-library/jest-dom/vitest';

// Node 24+ exposes an experimental global localStorage accessor that resolves
// to undefined unless the process receives --localstorage-file. Install a
// deterministic browser-compatible store for jsdom tests instead of depending
// on that process flag.
if (typeof window !== 'undefined') {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(String(key)) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(String(key)); },
    setItem: (key, value) => { values.set(String(key), String(value)); },
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
}
