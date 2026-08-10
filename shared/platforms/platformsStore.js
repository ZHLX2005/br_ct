/**
 * Platform visibility data layer.
 *
 * chrome.storage.local[platformVisibilitySettings] stores platform visibility.
 * An empty object means every platform is visible.
 *
 * @module shared/platforms/platformsStore
 */

import { STORAGE_KEYS } from '../core/storageKeys.js';
import { createSubscribable } from '../core/subscribable.js';

const DEFAULT_SETTINGS = {};
let cache = { ...DEFAULT_SETTINGS };
const subs = createSubscribable();

export function getCurrentPlatformVisibility() {
  return { ...cache };
}

export async function loadPlatformVisibility() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.PLATFORM_VISIBILITY], (result) => {
      cache = result?.[STORAGE_KEYS.PLATFORM_VISIBILITY] || { ...DEFAULT_SETTINGS };
      resolve({ ...cache });
    });
  });
}

export async function savePlatformVisibility(settings) {
  await new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEYS.PLATFORM_VISIBILITY]: settings }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
  cache = { ...settings };
  subs.emit(cache);
}

export function subscribeToPlatforms(cb) {
  const unsub = subs.subscribe(cb);
  const handler = (changes, area) => {
    if (area === 'local' && changes[STORAGE_KEYS.PLATFORM_VISIBILITY]) {
      cache = changes[STORAGE_KEYS.PLATFORM_VISIBILITY].newValue || { ...DEFAULT_SETTINGS };
      cb(cache);
    }
  };
  chrome.storage.onChanged.addListener(handler);
  return () => {
    unsub();
    chrome.storage.onChanged.removeListener(handler);
  };
}
