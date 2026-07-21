/**
 * @fileoverview 各种 observer/event 工厂。每个工厂返回 dispose 函数。
 */

import {
  IDLE_ROOT_MARGIN,
  IO_THRESHOLDS,
  REBUILD_DEBOUNCE_MS,
} from '../constants.js';

/**
 * IntersectionObserver：当 row 进入/离开 viewport（-30% margin）时回调。
 * @param {{ records: () => Array, onChange: () => void }} opts
 * @returns {() => void} dispose
 */
export function observeViewport({ records, onChange }) {
  if (!('IntersectionObserver' in window)) return () => {};

  const obs = new IntersectionObserver(
    () => onChange(),
    { root: null, rootMargin: IDLE_ROOT_MARGIN, threshold: IO_THRESHOLDS }
  );

  // 同步 attach 当前 records
  records().forEach((r) => obs.observe(r.el));

  return () => obs.disconnect();
}

/**
 * Scroll 监听：capture phase body + window，捕获所有子元素 scroll。
 * @param {{ onChange: () => void }} opts
 * @returns {() => void} dispose
 */
export function watchScroll({ onChange }) {
  document.body.addEventListener('scroll', onChange, { capture: true, passive: true });
  window.addEventListener('scroll', onChange, { passive: true });

  return () => {
    window.removeEventListener('scroll', onChange);
    document.body.removeEventListener('scroll', onChange, { capture: true });
  };
}

/**
 * MutationObserver：监听 list 的 childList 变化，触发 onChange（防抖）。
 * 用于重建 nav（新增/删除消息）。
 * @param {{ list: Element, onChange: () => void }} opts
 * @returns {() => void} dispose
 */
export function observeList({ list, onChange }) {
  let timer = null;
  const onMutation = () => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; onChange(); }, REBUILD_DEBOUNCE_MS);
  };

  const obs = new MutationObserver(onMutation);
  obs.observe(list, {
    childList: true,
    subtree: true,
  });

  return () => {
    obs.disconnect();
    if (timer) clearTimeout(timer);
  };
}

/**
 * Shell Observer：监听 document.body 的变化，当 list 出现或替换时通知。
 * 用于 SPA 切对话 / 列表延迟加载场景。
 *
 * @param {{ listSel: string, onListReady: (list: Element) => void }} opts
 * @returns {() => void} dispose
 */
export function observeShell({ listSel, onListReady }) {
  const knownLists = new Set();

  const obs = new MutationObserver(() => {
    const list = document.querySelector(listSel);
    if (list && !knownLists.has(list)) {
      knownLists.add(list);
      onListReady(list);
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  return () => {
    obs.disconnect();
    knownLists.clear();
  };
}
