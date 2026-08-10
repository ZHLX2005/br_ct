/**
 * prompts_editor.js — 提示词编辑器（options 页面）
 *
 * Rewrite on top of shared/prompts/promptsStore + shared/prompts/promptsEditorApi.
 *
 * 数据流：
 *   - 启动：loadAllPrompts() 一次拉所有 .js 文件入内存；listDir 取文件名列表渲染左侧。
 *   - 选中文件：从 getCurrentPrompts()[group] 内存快照直接渲染右侧，无须再次 IO。
 *   - 保存/新增/删除：调用 updatePrompt / addPrompt / deletePrompt；其内部写入磁盘并
 *     bump chrome.storage.local[promptsVersion]。
 *   - 跨页同步：subscribeToPrompts 在 storage version bump 时回调，options 重新渲染
 *     当前 group 的列表。popup / sidebar 改提示词时本页会跟随刷新。
 *
 * 保留：DOM IDs（fileList / currentFileName / editorContent / promptLabel / promptAlias
 * / promptTemplate / addBtn / cancelAdd / confirmAdd / addModal 等）、initEvents、
 * toast、escapeHtml、showAddModal、hideAddModal 行为不变，HTML/CSS 不需调整。
 */

import {
  loadAllPrompts,
  getCurrentPrompts,
  subscribeToPrompts,
} from '../../shared/prompts/promptsStore.js';
import {
  addPrompt,
  updatePrompt,
  deletePrompt,
} from '../../shared/prompts/promptsEditorApi.js';
import { sendNativeMessage } from '../../shared/core/nativeBridge.js';

let currentFile = null;
let currentGroup = null;
let unsubscribePrompts = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  initEvents();
  try {
    await loadAllPrompts();
  } catch (err) {
    console.warn('loadAllPrompts:', err);
  }
  // 跨页同步：popup / sidebar 修改提示词后，本页跟随刷新。
  unsubscribePrompts = subscribeToPrompts(() => {
    refreshCurrentView();
  });
  await loadFiles();
}

function initEvents() {
  const connectBtn = document.getElementById('connectBtn');
  if (connectBtn) {
    connectBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'nativeConnect' });
      updateStatus(true);
    });
  }
  const disconnectBtn = document.getElementById('disconnectBtn');
  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'nativeDisconnect' });
      updateStatus(false);
    });
  }
  const refreshBtn = document.getElementById('refreshFiles');
  if (refreshBtn) refreshBtn.addEventListener('click', loadFiles);
  const addBtn = document.getElementById('addBtn');
  if (addBtn) addBtn.addEventListener('click', showAddModal);
  const cancelAdd = document.getElementById('cancelAdd');
  if (cancelAdd) cancelAdd.addEventListener('click', hideAddModal);
  const confirmAdd = document.getElementById('confirmAdd');
  if (confirmAdd) confirmAdd.addEventListener('click', addPromptFromModal);
  const addModal = document.getElementById('addModal');
  if (addModal) {
    addModal.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) hideAddModal();
    });
  }
}

function updateStatus(connected) {
  const btn = document.getElementById('connectBtn');
  const disconnectBtn = document.getElementById('disconnectBtn');
  if (btn) btn.style.display = connected ? 'none' : 'inline-block';
  if (disconnectBtn) disconnectBtn.style.display = connected ? 'inline-block' : 'none';
  const el = document.getElementById('connectionStatus');
  if (el) {
    el.textContent = connected ? '已连接' : '未连接';
    el.className = `status-badge ${connected ? 'connected' : 'disconnected'}`;
  }
}

async function loadFiles() {
  try {
    const dirResp = await sendNativeMessage({ command: 'getPromptsDir' });
    const listResp = await sendNativeMessage({ command: 'listDir', path: dirResp.data });
    const files = (listResp && listResp.data) || [];
    renderFileList(files);
    if (!currentFile) {
      const first = files.find((f) => f.extension === 'js' && !f.isDir);
      if (first) await selectFile(first.name);
    } else {
      await selectFile(currentFile);
    }
  } catch (err) {
    toast('加载失败: ' + err.message, 'error');
  }
}

function renderFileList(files) {
  const el = document.getElementById('fileList');
  if (!el) return;
  const jsFiles = files.filter((f) => f.extension === 'js' && !f.isDir);

  if (!jsFiles.length) {
    el.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px;">无提示词文件</div>';
    return;
  }

  el.innerHTML = jsFiles.map((f) => `
    <div class="file-item ${f.name === currentFile ? 'active' : ''}" data-name="${escapeHtml(f.name)}">
      <span>${escapeHtml(f.name)}</span>
    </div>
  `).join('');

  el.querySelectorAll('.file-item').forEach((item) => {
    item.addEventListener('click', () => selectFile(item.dataset.name));
  });
}

async function selectFile(fileName) {
  currentFile = fileName;
  currentGroup = fileName.replace(/\.js$/, '');
  document.getElementById('currentFileName').textContent = fileName;
  document.querySelectorAll('.file-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.name === fileName);
  });
  // 从内存快照读取，不再发起 parsePrompts 调用。
  renderPrompts(getCurrentPrompts()[currentGroup] || []);
}

function refreshCurrentView() {
  if (!currentGroup) return;
  renderPrompts(getCurrentPrompts()[currentGroup] || []);
}

function renderPrompts(list) {
  const el = document.getElementById('editorContent');
  if (!el) return;

  if (!list.length) {
    el.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <path d="M14 2v6h6"/>
          <line x1="12" y1="18" x2="12" y2="12"/>
          <line x1="9" y1="15" x2="15" y2="15"/>
        </svg>
        <p>点击上方添加按钮创建提示词</p>
      </div>
    `;
    return;
  }

  el.innerHTML = `
    <div class="prompts-list">
      ${list.map((p, i) => `
        <div class="prompt-item" data-index="${i}">
          <div class="prompt-item-header">
            <span class="prompt-item-title">${escapeHtml(p.label)}${p.alias ? ` <small style="color:var(--text-muted);font-weight:400;font-size:11px;">/${escapeHtml(p.alias)}</small>` : ''}</span>
            <div class="item-buttons">
              <button data-action="delete" data-index="${i}">删除</button>
              <button class="btn-primary" data-action="save" data-index="${i}">保存</button>
            </div>
          </div>
          <div class="prompt-item-body expanded">
            <input type="text" id="label-${i}" value="${escapeHtml(p.label)}" placeholder="输入标题">
            <input type="text" id="alias-${i}" value="${escapeHtml(p.alias || '')}" placeholder="输入别名（如 fix）用于 /fix 快捷触发">
            <textarea id="tpl-${i}" placeholder="输入提示词内容">${escapeHtml(p.template)}</textarea>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  el.querySelectorAll('[data-action="save"]').forEach((btn) => {
    btn.addEventListener('click', () => savePrompt(parseInt(btn.dataset.index, 10)));
  });
  el.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', () => deletePromptAt(parseInt(btn.dataset.index, 10)));
  });
}

async function savePrompt(index) {
  const list = getCurrentPrompts()[currentGroup] || [];
  const item = list[index];
  const labelInput = document.getElementById(`label-${index}`);
  const aliasInput = document.getElementById(`alias-${index}`);
  const ta = document.getElementById(`tpl-${index}`);
  if (!labelInput || !aliasInput || !ta) return;
  const newLabel = labelInput.value.trim();
  const newAlias = aliasInput.value.trim();
  const newTemplate = ta.value;
  if (!newLabel) { toast('标题不能为空', 'error'); return; }
  try {
    await updatePrompt({
      group: currentGroup,
      oldLabel: item.label,
      newLabel,
      newAlias,
      newTemplate,
    });
    toast('已保存');
    // updatePrompt 已更新内存 cache 并 bump version，但本页面以显式重渲染为准。
    refreshCurrentView();
  } catch (err) {
    toast('保存失败: ' + err.message, 'error');
  }
}

async function deletePromptAt(index) {
  const list = getCurrentPrompts()[currentGroup] || [];
  const item = list[index];
  if (!item) return;
  if (!confirm(`确定删除 "${item.label}"？`)) return;
  try {
    await deletePrompt({ group: currentGroup, label: item.label });
    toast(`已删除: ${item.label}`);
    refreshCurrentView();
  } catch (err) {
    toast('删除失败: ' + err.message, 'error');
  }
}

function showAddModal() {
  const modal = document.getElementById('addModal');
  if (modal) modal.style.display = 'flex';
  document.getElementById('promptLabel').value = '';
  document.getElementById('promptAlias').value = '';
  document.getElementById('promptTemplate').value = '';
  document.getElementById('promptLabel').focus();
}

function hideAddModal() {
  const modal = document.getElementById('addModal');
  if (modal) modal.style.display = 'none';
}

async function addPromptFromModal() {
  const label = document.getElementById('promptLabel').value.trim();
  const alias = document.getElementById('promptAlias').value.trim();
  const template = document.getElementById('promptTemplate').value;
  if (!label) { toast('请输入名称', 'error'); return; }
  try {
    await addPrompt({ group: currentGroup, label, alias, template });
    hideAddModal();
    toast('已添加');
    refreshCurrentView();
  } catch (err) {
    toast('添加失败: ' + err.message, 'error');
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `notification ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}