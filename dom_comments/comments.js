/**
 * DOM 评论区页面逻辑。
 *
 * 数据经统一存储层 shared/domComments/domCommentsStore 读写（本页面为扩展
 * 页面，可直接 import store），提示词构建走 shared/domComments/domCommentsPrompt。
 * 本文件不直接调用 chrome.storage。
 *
 * @module dom_comments/comments
 */

import {
  loadDomComments,
  removeDomComment,
  clearDomComments,
  subscribeToDomComments,
} from '../shared/domComments/domCommentsStore.js';
import {
  buildDomPrompt,
  buildLocatorText,
  VERDICT_LABELS,
} from '../shared/domComments/domCommentsPrompt.js';

const listEl = document.getElementById('record-list');
const countEl = document.getElementById('record-count');
const clearBtn = document.getElementById('clear-btn');
const refreshBtn = document.getElementById('refresh-btn');

let records = [];
let clearArmed = false;
let clearArmTimer = null;

function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  const escapeMap = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  };
  return str.replace(/[&<>"']/g, (match) => escapeMap[match]);
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === '/' ? '' : u.pathname);
  } catch (err) {
    return url || '';
  }
}

function render(list) {
  records = list || [];
  countEl.textContent = `(${records.length})`;

  if (records.length === 0) {
    listEl.innerHTML = '<div class="empty-state">暂无评论记录</div>';
    return;
  }

  listEl.innerHTML = records.map((r, i) => {
    const verdictText = VERDICT_LABELS[r.verdict] || VERDICT_LABELS.none;
    return `
      <div class="record">
        <div class="record-head">
          <span class="verdict">${verdictText}</span>
          <span class="record-tag mono">${escapeHtml(truncate(r.tag || '', 60))}</span>
          <span class="record-time">${formatTime(r.time)}</span>
        </div>
        ${r.comment ? `<div class="record-comment">${escapeHtml(r.comment)}</div>` : ''}
        <div class="record-locator mono">css: ${escapeHtml(truncate(r.selectors?.css || '', 120))}</div>
        <div class="record-foot">
          <a class="record-url mono" href="${escapeHtml(r.url || '#')}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(r.url || '')}">${escapeHtml(truncate(shortUrl(r.url), 60))}</a>
          <div class="record-actions">
            <button class="btn btn-quiet" data-act="prompt" data-index="${i}" type="button">复制提示词</button>
            <button class="btn btn-quiet" data-act="locator" data-index="${i}" type="button">复制定位</button>
            <button class="btn btn-quiet" data-act="delete" data-index="${i}" type="button">删除</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function copyText(text, btn) {
  const flash = (ok) => {
    if (!btn) return;
    const orig = btn.innerText;
    btn.innerText = ok ? '已复制' : '复制失败';
    setTimeout(() => {
      if (btn.isConnected) btn.innerText = orig;
    }, 1000);
  };
  try {
    await navigator.clipboard.writeText(text);
    flash(true);
  } catch (err) {
    console.error('[DomComments] 复制失败:', err);
    flash(false);
  }
}

function disarmClear() {
  clearArmed = false;
  if (clearArmTimer) clearTimeout(clearArmTimer);
  clearBtn.textContent = '清空';
  clearBtn.classList.remove('armed');
}

async function onClearClick() {
  // 二次确认，避免误清
  if (!clearArmed) {
    clearArmed = true;
    clearBtn.textContent = '确认清空?';
    clearBtn.classList.add('armed');
    clearArmTimer = setTimeout(disarmClear, 2500);
    return;
  }
  disarmClear();
  await clearDomComments();
}

async function onDeleteClick(btn) {
  const record = records[Number(btn.dataset.index)];
  if (!record) return;
  await removeDomComment(record.id);
}

function bindEvents() {
  refreshBtn.addEventListener('click', async () => {
    render(await loadDomComments());
  });

  clearBtn.addEventListener('click', onClearClick);

  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const record = records[Number(btn.dataset.index)];
    if (!record) return;

    switch (btn.dataset.act) {
      case 'prompt':
        copyText(buildDomPrompt(record), btn);
        break;
      case 'locator':
        copyText(buildLocatorText(record), btn);
        break;
      case 'delete':
        onDeleteClick(btn);
        break;
    }
  });
}

bindEvents();

// 订阅统一存储：任何上下文写入（含拾取器新评论）实时刷新列表
subscribeToDomComments(render);
loadDomComments().then(render);
