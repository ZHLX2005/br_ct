/**
 * promptsStore — memory cache + disk load + save + subscribe for prompts.
 *
 * Bootstrap fallback seeds the cache at module load; loadAllPrompts overwrites
 * when the native host responds. savePromptFile writes one group, updates the
 * cache, then bumps chrome.storage.local[promptsVersion] (callback API).
 * subscribeToPrompts listens for that bump across pages.
 *
 * Native commands: getPromptsDir, listDir, parsePrompts, savePrompts.
 * @module shared/prompts/promptsStore
 */

import { STORAGE_KEYS } from '../core/storageKeys.js';
import { sendNativeMessage } from '../core/nativeBridge.js';
import { getBootstrapPrompts } from './promptsBootstrap.js';

const VERSION_KEY = STORAGE_KEYS.PROMPTS_VERSION;
let cache = getBootstrapPrompts(); // current snapshot; replaced on disk load
let loaded = false;                // true after first successful loadAllPrompts

function serializeGroup(list) {
  return `export default ${JSON.stringify(list, null, 2)};\n`;
}

function stamp(group, list) {
  return list.map((it) => ({ group, label: it.label, alias: it.alias, template: it.template }));
}

function chromeErr() {
  return chrome.runtime && chrome.runtime.lastError && chrome.runtime.lastError.message;
}

function readVersion() {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.get([VERSION_KEY], (result) => {
        const err = chromeErr();
        if (err) return reject(new Error(err));
        resolve(Number((result && result[VERSION_KEY]) || 0));
      });
    } catch (err) { reject(err); }
  });
}

function writeVersion(next) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set({ [VERSION_KEY]: next }, () => {
        const err = chromeErr();
        if (err) return reject(new Error(err));
        resolve();
      });
    } catch (err) { reject(err); }
  });
}

export function getCurrentPrompts() { return cache; }
export function isLoaded() { return loaded; }

export function subscribeToPrompts(cb) {
  const handler = (changes, area) => {
    if (area !== 'local' || !changes || !(VERSION_KEY in changes)) return;
    try { cb(cache); } catch (err) {
      console.error('subscribeToPrompts subscriber threw:', err);
    }
  };
  chrome.storage.onChanged.addListener(handler);
  let done = false;
  return function unsubscribe() {
    if (done) return;
    done = true;
    chrome.storage.onChanged.removeListener(handler);
  };
}

export async function loadAllPrompts() {
  const dirResp = await sendNativeMessage({ command: 'getPromptsDir' });
  const promptsDir = dirResp && dirResp.data;
  if (!promptsDir) throw new Error('getPromptsDir returned no data');

  const listResp = await sendNativeMessage({ command: 'listDir', path: promptsDir });
  const entries = (listResp && listResp.data) || [];

  const next = {};
  for (const entry of entries) {
    if (!entry || entry.isDir) continue;
    if ((entry.extension || '').toLowerCase() !== 'js') continue;
    const group = entry.name.replace(/\.js$/i, '');
    try {
      const parseResp = await sendNativeMessage({
        command: 'parsePrompts',
        path: `${promptsDir}\\${entry.name}`,
      });
      next[group] = stamp(group, (parseResp && parseResp.data) || []);
    } catch (err) {
      console.warn(`promptsStore: skip group "${group}" (${err.message})`);
    }
  }

  cache = next;
  loaded = true;
  return cache;
}

export async function savePromptFile(group, list) {
  if (typeof group !== 'string' || !group) {
    throw new Error('savePromptFile: group must be a non-empty string');
  }
  if (!Array.isArray(list)) {
    throw new Error('savePromptFile: list must be an array');
  }

  await sendNativeMessage({
    command: 'savePrompts',
    path: `${group}.js`,
    content: serializeGroup(list),
  });

  // Cache update precedes version bump so subscribers see the new snapshot.
  cache = { ...cache, [group]: stamp(group, list) };

  const current = await readVersion();
  await writeVersion(current + 1);
}
