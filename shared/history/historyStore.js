/**
 * Message history data layer.
 *
 * chrome.storage.local[messageHistory] stores up to 30 messages in LRU order.
 *
 * @module shared/history/historyStore
 */

import { STORAGE_KEYS } from '../core/storageKeys.js';
import { createSubscribable } from '../core/subscribable.js';

const MAX_HISTORY = 30;
let cache = [];
const subs = createSubscribable();

export function getCurrentHistory() {
  return cache.slice();
}

export async function loadHistory() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.HISTORY], (result) => {
      cache = result?.[STORAGE_KEYS.HISTORY] || [];
      resolve(cache.slice());
    });
  });
}

export async function addToHistory(message) {
  const next = cache.filter((item) => item !== message);
  next.unshift(message);
  if (next.length > MAX_HISTORY) next.length = MAX_HISTORY;

  await new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: next }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
  cache = next;
  subs.emit(cache);
  return cache.slice();
}

export function subscribeToHistory(cb) {
  const unsub = subs.subscribe(cb);
  const handler = (changes, area) => {
    if (area === 'local' && changes[STORAGE_KEYS.HISTORY]) {
      cache = changes[STORAGE_KEYS.HISTORY].newValue || [];
      cb(cache);
    }
  };
  chrome.storage.onChanged.addListener(handler);
  return () => {
    unsub();
    chrome.storage.onChanged.removeListener(handler);
  };
}
