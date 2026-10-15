import { lazy } from 'react';

const RELOAD_KEY = 'crm:chunk-reload-at';
const RELOAD_COOLDOWN_MS = 60_000;

// Browsers word a failed dynamic import differently; match them all.
const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
  /Loading (CSS )?chunk [\w-]+ failed/i,
];

export function isChunkLoadError(error) {
  const message = typeof error === 'string' ? error : error?.message;
  if (!message) return false;
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A failed module fetch can stay cached in the browser until a full reload, so
// the last resort is one automatic reload. The cooldown stops a reload loop.
function claimAutoReload(now = Date.now()) {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (now - last < RELOAD_COOLDOWN_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

export function importWithRetry(
  factory,
  { retries = 1, delayMs = 800, reload = () => window.location.reload() } = {},
) {
  return async () => {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await factory();
      } catch (error) {
        if (!isChunkLoadError(error)) throw error;
        lastError = error;
        if (attempt < retries) await sleep(delayMs * (attempt + 1));
      }
    }
    if (claimAutoReload()) {
      reload();
      // Keep the Suspense fallback on screen while the page reloads.
      return new Promise(() => {});
    }
    throw lastError;
  };
}

export default function lazyWithRetry(factory, options) {
  return lazy(importWithRetry(factory, options));
}
