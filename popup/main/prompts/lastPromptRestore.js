// lastPromptRestore.js - 从 chrome.storage.sync 恢复 popup 提示词选择
//
// 写入端契约: popup/main/prompts/promptsUI.js 在用户选提示词时把 key 写入
// chrome.storage.sync (`{ lastPromptTemplate: template.key }`); architecture
// skill (`.claude/skills/sidebar-main-architecture/SKILL.md`) 也明确该键归属 sync。
// 读端必须从同一存储区读,否则 storage 区不匹配 → 读到的总是 undefined →
// selected-value 永远停在 HTML 默认值 "不使用优化",每次 reopen 都要重新指定。
//
// key 格式: 复合 key "group::label" (新格式, promptsUI.buildPromptMap 写入) 或
// 裸 alias / 裸 label (旧格式, 回退查找跨组匹配)。

import { getCurrentPrompts } from "../../../shared/prompts/promptsStore.js";
import { STORAGE_KEYS } from "../../../shared/core/storageKeys.js";

/**
 * 从 chrome.storage.sync 读 lastPromptTemplate 并恢复到 selected-value。
 * @param {Element} promptOptimizerSelect - #prompt-optimizer-select 容器元素
 * @returns {Promise<boolean>} 是否成功恢复
 */
export function restoreLastPromptTemplate(promptOptimizerSelect) {
  return new Promise((resolve) => {
    chrome.storage.sync.get([STORAGE_KEYS.LAST_PROMPT_TEMPLATE], (result) => {
      const savedKey = result && result[STORAGE_KEYS.LAST_PROMPT_TEMPLATE];
      if (!savedKey) { resolve(false); return; }
      const all = getCurrentPrompts() || {};
      const match = findPromptByKey(all, savedKey);
      if (!match) { resolve(false); return; }
      const selectedValue =
        promptOptimizerSelect && promptOptimizerSelect.querySelector(".selected-value");
      if (!selectedValue) { resolve(false); return; }
      selectedValue.textContent = match.label;
      selectedValue.dataset.value = savedKey;
      selectedValue.dataset.template = match.template || "";
      resolve(true);
    });
  });
}

/**
 * 按 saved key 在 prompts 快照里找匹配项。先试复合 key `${group}::${label}`,
 * 再回退到跨组按 alias/label 匹配 (旧 storage 格式)。
 * @param {{[group: string]: Array<{group:string,label:string,alias:string,template:string}>}} all
 * @param {string} savedKey
 * @returns {{group:string,label:string,alias:string,template:string}|null}
 */
function findPromptByKey(all, savedKey) {
  if (savedKey.includes('::')) {
    const [g, ...rest] = savedKey.split('::');
    const lbl = rest.join('::');
    const items = all[g] || [];
    const hit = items.find((t) => t.label === lbl);
    if (hit) return hit;
  }
  for (const group of Object.keys(all)) {
    const items = all[group];
    if (!Array.isArray(items)) continue;
    for (const t of items) {
      if ((t.alias && t.alias === savedKey) || t.label === savedKey) {
        return t;
      }
    }
  }
  return null;
}
