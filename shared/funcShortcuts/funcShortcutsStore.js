/**
 * Func scripts shortcuts data layer.
 *
 * chrome.storage.local[funcShortcuts] stores user-defined per-script
 * shortcuts: { [file]: { ctrlKey, altKey, shiftKey, metaKey, key } }.
 *
 * Writers (popup) go through this store. The runjs content-script listener
 * (runjs/funcs_shortcut_listener.js) reads the key directly because static
 * content scripts cannot import ES modules — keep the key name in sync with
 * STORAGE_KEYS.FUNC_SHORTCUTS.
 *
 * @module shared/funcShortcuts/funcShortcutsStore
 */

import { STORAGE_KEYS } from '../core/storageKeys.js';
import { createSubscribable } from '../core/subscribable.js';

let cache = {};
const subs = createSubscribable();

export function getFuncShortcuts() {
  return { ...cache };
}

export async function loadFuncShortcuts() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.FUNC_SHORTCUTS], (result) => {
      cache = result?.[STORAGE_KEYS.FUNC_SHORTCUTS] || {};
      resolve({ ...cache });
    });
  });
}

export async function saveFuncShortcut(file, shortcut) {
  const next = { ...cache, [file]: shortcut };

  await new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEYS.FUNC_SHORTCUTS]: next }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
  cache = next;
  subs.emit(cache);
}

export async function removeFuncShortcut(file) {
  const next = { ...cache };
  delete next[file];

  await new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEYS.FUNC_SHORTCUTS]: next }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
  cache = next;
  subs.emit(cache);
}

export function subscribeToFuncShortcuts(cb) {
  const unsub = subs.subscribe(cb);
  const handler = (changes, area) => {
    if (area === 'local' && changes[STORAGE_KEYS.FUNC_SHORTCUTS]) {
      cache = changes[STORAGE_KEYS.FUNC_SHORTCUTS].newValue || {};
      cb(cache);
    }
  };
  chrome.storage.onChanged.addListener(handler);
  return () => {
    unsub();
    chrome.storage.onChanged.removeListener(handler);
  };
}
