/**
 * promptEditor.js — 边栏内嵌提示词编辑器
 *
 * 设计要点：
 * - 不修改 native host / Go 端；保存仍走 savePrompts，存储仍是 .js
 * - good_eg / bad_eg 本质是 template 文本末尾的 `good_eg:` / `bad_eg:` 子串
 *   - good_eg = "推荐的示例 / 好例子"（AI 期望模仿的输出）
 *   - bad_eg  = "不推荐的、应避免的反例"
 * - 解析与还原统一在 promptsCore.js，前端自闭环
 */

import { parseTemplate, composeTemplate } from '../../../popup/main/prompts/promptsCore.js';

// ============== native 通信 ==============

function sendNativeMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'nativeMessage', payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error('Native host 无响应'));
        return;
      }
      if (response.status === 'error') {
        reject(new Error(response.message || '操作失败'));
        return;
      }
      resolve(response);
    });
  });
}

// ============== 编辑器状态 ==============

let _state = null; // { meta, original, groupPath, promptsList, onSaved }

// ============== 公开 API ==============

/**
 * 打开编辑面板并加载当前选中提示词
 * @param {Object} meta - { key, label, alias, group, template } 来自 PROMPT_TEMPLATES
 * @param {Function} onSaved - (newTemplate) => void 保存成功回调（用于刷新提示词栏）
 */
export async function open(meta, onSaved) {
  const body = document.getElementById('prompt-editor-body');
  if (!body) {
    console.error('[promptEditor] #prompt-editor-body not found');
    return;
  }

  // 1) 解析 group 路径 + 加载完整 prompts 列表
  body.innerHTML = '<div class="prompt-editor-loading">加载中…</div>';

  let groupPath = '';
  let promptsList = [];
  try {
    const dirResp = await sendNativeMessage({ command: 'getPromptsDir' });
    const dir = dirResp.data;
    groupPath = `${dir}\\${meta.group}.js`;
    const parsed = await sendNativeMessage({ command: 'parsePrompts', path: groupPath });
    promptsList = parsed.data || [];
  } catch (err) {
    body.innerHTML = `<div class="prompt-editor-error">加载失败：${escapeHtml(err.message)}</div>`;
    return;
  }

  // 2) 定位到当前条目
  const idx = promptsList.findIndex((p) => p.label === meta.label);
  if (idx < 0) {
    body.innerHTML = `<div class="prompt-editor-error">在 ${escapeHtml(meta.group)}.js 中找不到 "${escapeHtml(meta.label)}"</div>`;
    return;
  }

  const entry = promptsList[idx];
  const { body: tplBody, good_eg, bad_eg } = parseTemplate(entry.template);
  _state = {
    meta,
    groupPath,
    promptsList,
    idx,
    parsed: { label: entry.label, alias: entry.alias || '', body: tplBody, good_eg, bad_eg },
    onSaved: onSaved || (() => {}),
  };

  // 3) 渲染表单
  renderForm();

  // 4) 切到编辑器 page
  switchToEditor();
}

/** 关闭编辑器并切回主页 */
export function close() {
  _state = null;
  const body = document.getElementById('prompt-editor-body');
  if (body) body.innerHTML = '';
  switchToMain();
}

// ============== 渲染 ==============

function renderForm() {
  const body = document.getElementById('prompt-editor-body');
  const { meta, groupPath, parsed } = _state;
  const pathEl = document.getElementById('prompt-editor-path');
  if (pathEl) pathEl.textContent = `${meta.group}.js`;

  body.innerHTML = `
    <div class="prompt-editor-field">
      <label>标签</label>
      <input type="text" id="pe-label" value="${escapeAttr(parsed.label)}" placeholder="提示词名称">
    </div>
    <div class="prompt-editor-field">
      <label>别名（用于 /alias 快捷触发）</label>
      <input type="text" id="pe-alias" value="${escapeAttr(parsed.alias)}" placeholder="如 fix">
    </div>
    <div class="prompt-editor-field">
      <label>模板（用 <code>%s</code> 表示用户消息占位）</label>
      <textarea id="pe-body" rows="8" placeholder="提示词正文…">${escapeHtml(parsed.body)}</textarea>
    </div>
    <div class="prompt-editor-field">
      <label>推荐示例 <span class="prompt-editor-hint">（<code>good_eg</code> = 好例子 / 期望 AI 模仿的输出）</span></label>
      <textarea id="pe-good" rows="4" placeholder="例如：列出 1) 简洁结论 2) 关键步骤 3) 注意事项…">${escapeHtml(parsed.good_eg)}</textarea>
    </div>
    <div class="prompt-editor-field">
      <label>不推荐示例（应避免的） <span class="prompt-editor-hint">（<code>bad_eg</code> = 坏例子 / AI 不应采用的反例）</span></label>
      <textarea id="pe-bad" rows="4" placeholder="例如：避免长篇客套、避免用列表罗列大量无重点条目、避免直接复述问题…">${escapeHtml(parsed.bad_eg)}</textarea>
    </div>
    <div class="prompt-editor-actions">
      <button class="pe-btn" id="pe-cancel" type="button">取消</button>
      <button class="pe-btn pe-btn-primary" id="pe-save" type="button">保存</button>
    </div>
  `;

  document.getElementById('pe-cancel').addEventListener('click', close);
  document.getElementById('pe-save').addEventListener('click', save);
  body.querySelectorAll('input, textarea').forEach((el) => {
    el.addEventListener('keydown', onKeyDown);
  });
}

function onKeyDown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    save();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    close();
  }
}

// ============== 保存 ==============

async function save() {
  if (!_state) return;
  const { meta, groupPath, promptsList, idx, onSaved } = _state;

  const label = document.getElementById('pe-label').value.trim();
  const alias = document.getElementById('pe-alias').value.trim();
  const body = document.getElementById('pe-body').value;
  const good_eg = document.getElementById('pe-good').value;
  const bad_eg = document.getElementById('pe-bad').value;

  if (!label) { toast('标签不能为空', 'error'); return; }
  if (promptsList.some((p, i) => i !== idx && p.label === label)) {
    toast('标签已存在', 'error');
    return;
  }
  if (alias && promptsList.some((p, i) => i !== idx && p.alias === alias)) {
    toast('别名已存在', 'error');
    return;
  }

  const template = composeTemplate({ body, good_eg, bad_eg });
  promptsList[idx] = { label, alias, template };

  const saveBtn = document.getElementById('pe-save');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
  }

  try {
    await sendNativeMessage({
      command: 'savePrompts',
      path: groupPath,
      content: `export default ${JSON.stringify(promptsList, null, 2)};\n`,
    });
    toast('已保存');
    onSaved({ key: meta.key, label, alias, template, group: meta.group });
    close();
  } catch (err) {
    toast('保存失败：' + err.message, 'error');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = '保存';
    }
  }
}

// ============== page 切换 ==============

function switchToEditor() {
  const main = document.getElementById('page-main');
  const editor = document.getElementById('page-prompt-editor');
  if (main) main.classList.remove('active');
  if (editor) editor.classList.add('active');
  setTimeout(() => {
    const first = document.getElementById('pe-label');
    if (first) first.focus();
  }, 50);
}

function switchToMain() {
  const main = document.getElementById('page-main');
  const editor = document.getElementById('page-prompt-editor');
  if (main) main.classList.add('active');
  if (editor) editor.classList.remove('active');
}

// ============== 工具 ==============

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return escapeHtml(str);
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.style.cssText = `
    position:fixed; bottom:24px; right:24px; z-index:10002;
    padding:8px 14px; font-size:12px; font-weight:500; font-family:-apple-system,BlinkMacSystemFont,sans-serif;
    border-radius:6px; box-shadow:0 6px 20px rgba(15,23,42,0.18); border:1px solid transparent;
    ${type === 'error'
      ? 'background:#dc2626; color:#fff; border-color:rgba(255,255,255,0.2);'
      : 'background:#16a34a; color:#fff; border-color:rgba(255,255,255,0.2);'}
  `;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
