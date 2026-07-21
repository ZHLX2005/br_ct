/**
 * @fileoverview 采集 records（querySelectorAll + extractText），纯函数。
 *
 * 输入 selector/textSel/extractText → { records, skippedCount }。
 * 不持有状态，无副作用。
 */

import { LABEL_TRUNCATE } from '../constants.js';

/**
 * 从当前 DOM 中采集所有符合条件的消息记录。
 *
 * @param {object} opts
 * @param {string}  opts.itemSel   - querySelectorAll 选择器
 * @param {string|null} opts.textSel  - 文本子节点选择器（可选）
 * @param {Function|null} opts.extractText - 自定义文本提取函数（可选）
 * @returns {{ records: Array<{el: Element, text: string, fullText: string}>, skippedCount: number }}
 */
export function collectRecords({ itemSel, textSel, extractText }) {
  const records = [];
  let skippedCount = 0;

  document.querySelectorAll(itemSel).forEach((el) => {
    const raw = extractRaw(el, { textSel, extractText });
    if (!raw) { skippedCount++; return; }
    records.push({
      el,
      text: raw.slice(0, LABEL_TRUNCATE),
      fullText: raw,
    });
  });

  return { records, skippedCount };
}

/**
 * 从单个元素中提取完整文本（不截断）。
 */
function extractRaw(el, { textSel, extractText }) {
  if (extractText) {
    const extracted = extractText(el);
    if (extracted) return extracted.trim();
  }

  let text;
  if (textSel) text = el.querySelector(textSel)?.innerText;
  if (!text) text = el.innerText;
  return text?.trim() || undefined;
}
