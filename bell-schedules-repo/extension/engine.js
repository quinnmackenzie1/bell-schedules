// Network + cache layer for the extension. All scheduling rules live in
// core.js, which is shared with the web clock, the editor and CI.
export * from './core.js';
import { looksValid } from './core.js';

export const SOURCES = [
  'https://raw.githubusercontent.com/quinnmackenzie1/bell-schedules/main/overrides.json',
  'https://quinnmackenzie1.github.io/bell-schedules/overrides.json'
];

const CACHE_KEY = 'scheduleCache';
const MAX_AGE_MS = 60 * 60 * 1000;   // refresh hourly
const RETRY_MS = 5 * 60 * 1000;      // after a failure, try again in five minutes

/* ---------- network ---------- */
async function fetchFresh() {
  let lastErr = 'unknown error';
  for (const url of SOURCES) {
    try {
      const r = await fetch(url, { cache: 'no-cache' });
      if (!r.ok) { lastErr = `HTTP ${r.status}`; continue; }
      const json = await r.json();
      if (!looksValid(json)) { lastErr = 'file was not in the expected format'; continue; }
      return { data: json, source: url };
    } catch (e) {
      lastErr = e.message;
    }
  }
  throw new Error(lastErr);
}

/**
 * Returns { data, fetchedAt, stale, error }.
 * Serves the cached copy immediately and refreshes behind the scenes, so a slow
 * or missing network never blanks the display.
 */
export async function getSchedules({ force = false } = {}) {
  const store = await chrome.storage.local.get(CACHE_KEY);
  const cached = store[CACHE_KEY];
  const age = cached ? Date.now() - cached.fetchedAt : Infinity;
  const needsRefresh = force || !cached || age > MAX_AGE_MS ||
    (cached.lastError && Date.now() - cached.lastTry > RETRY_MS);

  if (cached && !needsRefresh) {
    return { data: cached.data, fetchedAt: cached.fetchedAt, stale: false, error: null };
  }

  try {
    const { data, source } = await fetchFresh();
    const record = { data, fetchedAt: Date.now(), lastTry: Date.now(), source, lastError: null };
    await chrome.storage.local.set({ [CACHE_KEY]: record });
    return { data, fetchedAt: record.fetchedAt, stale: false, error: null };
  } catch (e) {
    if (cached) {
      await chrome.storage.local.set({
        [CACHE_KEY]: { ...cached, lastTry: Date.now(), lastError: e.message }
      });
      return { data: cached.data, fetchedAt: cached.fetchedAt, stale: true, error: e.message };
    }
    return { data: null, fetchedAt: null, stale: true, error: e.message };
  }
}
