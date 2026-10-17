/**
 * DOM comment records data layer.
 *
 * chrome.storage.local[domCommentHistory] stores element-comment records
 * captured by the DOM comment picker (funcs/元素dom/dom_comment_picker.js).
 * Records are kept in LRU order (newest first), capped at MAX_COMMENTS.
 *
 * Schema per record:
 * {
 *   id: string      — `${Date.now()}-${seq}` unique id
 *   time: string    — ISO timestamp
 *   url: string     — page URL where the element was picked
 *   title: string   — page title
 *   tag: string     — short tag descriptor, e.g. `div.card__title`
 *   selectors: { css, jsPath, xpath, fullXPath }
 *   verdict: '' | 'like' | 'dislike'
 *   comment: string — user comment text
 *   html: string    — truncated outerHTML of the picked element
 * }
 *
 * @module shared/domComments/domCommentsStore
 */

import { STORAGE_KEYS } from '../core/storageKeys.js';
import { createSubscribable } from '../core/subscribable.js';

const MAX_COMMENTS = 50;
let seq = 0;
let cache = [];
const subs = createSubscribable();

export function getCurrentDomComments() {
  return cache.slice();
}

export async function loadDomComments() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.DOM_COMMENTS], (result) => {
      cache = result?.[STORAGE_KEYS.DOM_COMMENTS] || [];
      resolve(cache.slice());
    });
  });
}

export async function addDomComment(record) {
  const next = [{ ...record, id: `${Date.now()}-${seq++}` }, ...cache];
  if (next.length > MAX_COMMENTS) next.length = MAX_COMMENTS;

  await new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEYS.DOM_COMMENTS]: next }, () => {
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

export async function clearDomComments() {
  await new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEYS.DOM_COMMENTS]: [] }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
  cache = [];
  subs.emit(cache);
}

export function subscribeToDomComments(cb) {
  const unsub = subs.subscribe(cb);
  const handler = (changes, area) => {
    if (area === 'local' && changes[STORAGE_KEYS.DOM_COMMENTS]) {
      cache = changes[STORAGE_KEYS.DOM_COMMENTS].newValue || [];
      cb(cache);
    }
  };
  chrome.storage.onChanged.addListener(handler);
  return () => {
    unsub();
    chrome.storage.onChanged.removeListener(handler);
  };
}
