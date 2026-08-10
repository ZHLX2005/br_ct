/**
 * promptsEditorApi — thin CRUD wrapper around promptsStore.
 *
 * UI layers call addPrompt/updatePrompt/deletePrompt instead of savePromptFile.
 * Uniqueness checks (label, alias) run against the in-memory cache before save.
 * @module shared/prompts/promptsEditorApi
 */

import { getCurrentPrompts, savePromptFile } from './promptsStore.js';

function assertUniqueLabel(list, label, excludeIndex) {
  const idx = list.findIndex((it) => it.label === label);
  if (idx >= 0 && idx !== excludeIndex) {
    throw new Error(`标题已存在: ${label}`);
  }
}

function assertUniqueAlias(list, alias, excludeIndex) {
  if (!alias) return;
  const idx = list.findIndex((it) => it.alias === alias);
  if (idx >= 0 && idx !== excludeIndex) {
    throw new Error(`别名已存在: ${alias}`);
  }
}

export async function addPrompt({ group, label, alias, template }) {
  if (!label) throw new Error('标题不能为空');
  const list = (getCurrentPrompts()[group] || []).slice();
  assertUniqueLabel(list, label, -1);
  assertUniqueAlias(list, alias, -1);
  list.push({ group, label, alias: alias || '', template });
  await savePromptFile(group, list);
}

export async function updatePrompt({ group, oldLabel, newLabel, newAlias, newTemplate }) {
  if (!newLabel) throw new Error('标题不能为空');
  const list = (getCurrentPrompts()[group] || []).slice();
  const idx = list.findIndex((it) => it.label === oldLabel);
  if (idx < 0) throw new Error(`未找到原标题: ${oldLabel}`);
  assertUniqueLabel(list, newLabel, idx);
  assertUniqueAlias(list, newAlias, idx);
  list[idx] = { group, label: newLabel, alias: newAlias || '', template: newTemplate };
  await savePromptFile(group, list);
}

export async function deletePrompt({ group, label }) {
  if (!label) throw new Error('标题不能为空');
  const list = (getCurrentPrompts()[group] || []).slice();
  const idx = list.findIndex((it) => it.label === label);
  if (idx < 0) throw new Error(`未找到要删除的: ${label}`);
  list.splice(idx, 1);
  await savePromptFile(group, list);
}
