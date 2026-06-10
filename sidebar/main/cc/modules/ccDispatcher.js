/**
 * ccDispatcher.js — WS 事件分发 + Streaming 渲染
 *
 * 解析从 background 转发的 WS 事件，驱动 UI 流式更新。
 * 是 cc 模块的核心中枢。
 */

import { renderMarkdownSafe } from '../../markdownRender.js';
import { getActiveTab } from './ccTabs.js';
import { state } from './ccConstants.js';
import { escHtml, getToolIcon, getToolDetail } from './ccUtils.js';
import { fetchStatus } from './ccUI.js';

// ==================== 事件分发 ====================

export function dispatch(msg) {
  console.log('[cc] dispatch type=' + msg.type + (msg.content ? ' content=' + msg.content.slice(0, 50) : ''));
  const tab = getActiveTab();
  if (!tab) { console.warn('[cc] dispatch: no active tab'); return; }

  switch (msg.type) {
    case 'init':
      if (msg.sessionId) tab._sessionId = msg.sessionId;
      if (msg.cwd && tab._path && msg.cwd !== tab._path) break;
      const skills = [...new Set([
        ...(Array.isArray(msg.slashCommands) ? msg.slashCommands : []),
        ...(Array.isArray(msg.skills) ? msg.skills : []),
      ])];
      if (skills.length > 0) {
        tab._skills = skills
          .map(s => typeof s === 'string' ? { name: s, desc: '' } : { name: s.name || String(s), desc: s.desc || '' })
          .sort((a, b) => a.name.localeCompare(b.name));
        tab._skillsCwd = tab._path || msg.cwd;
        tab._skillsLoading = false;
      }
      break;

    case 'turn_start':
      tab._streamingText = '';
      tab._streamingThinking = '';
      tab._streamingTools = [];
      tab._streamingToolIds = new Set();
      break;

    case 'text':
      if (tab._silentTurn) { tab._streamingText = (tab._streamingText || '') + (msg.content || ''); break; }
      tab._streamingText = (tab._streamingText || '') + (msg.content || '');
      appendStreamText(tab, msg.content);
      break;

    case 'thinking':
      tab._streamingThinking = (tab._streamingThinking || '') + (msg.content || '');
      if (!tab._silentTurn) appendThinking(tab, msg.content);
      break;

    case 'tool_use': {
      if (tab._silentTurn) break;
      if (!tab._streamingTools) { tab._streamingTools = []; tab._streamingToolIds = new Set(); }
      const tool = { name: msg.name, input: msg.input, id: msg.id || 't_' + Date.now() + '_' + tab._streamingTools.length };
      if (tab._streamingToolIds.has(tool.id)) break; // dedup
      tab._streamingToolIds.add(tool.id);
      tab._streamingTools.push(tool);
      addToolCard(tab, tool);
      break;
    }

    case 'done':
      if (msg.sessionId) tab._sessionId = msg.sessionId;
      if (state.pendingQuery) {
        state.pendingQuery.resolve({ status: 'ok', data: { text: tab._streamingText, sessionId: tab._sessionId } });
        state.pendingQuery = null;
      }
      if (tab._silentTurn) { tab._silentTurn = false; break; }
      finalizeStream(tab);
      finalizeTools(tab);
      fetchStatus();
      break;

    case 'error':
      if (msg.content && (msg.content.includes('getSkills') || msg.content.includes('probe'))) {
        console.warn('[cc] background probe error:', msg.content);
        break;
      }
      if (state.pendingQuery) {
        state.pendingQuery.reject(new Error(msg.content || 'error'));
        state.pendingQuery = null;
      }
      if (!tab._silentTurn) finalizeTools(tab);
      break;
  }
}

// ==================== Streaming 气泡 ====================

/** 获取或创建当前 turn 的助手气泡 */
function getOrCreateBubble(tab) {
  const rc = document.getElementById('response-content');
  if (!rc) return null;
  let s = rc.querySelector('.cc-stream-bubble');
  if (!s) {
    s = document.createElement('div');
    s.className = 'notion-chat-message cc-stream-bubble';
    const label = tab.querySelector('.cc-tab-label')?.textContent || 'Claude Code';
    s.innerHTML =
      '<div class="notion-chat-avatar" style="background:#f97316;display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;flex-shrink:0;">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 6"/></svg></div>' +
      '<div class="notion-chat-bubble" style="flex:1;min-width:0;">' +
      '<div class="notion-chat-bubble-header">' +
      `<span class="notion-chat-bubble-name" style="color:#ea580c">${escHtml(label)}</span></div>` +
      '<div class="cc-thought-section">' +
      '<div class="cc-thought-header">' +
      '<svg class="cc-thought-header-icon" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2" y="2.5" width="10" height="8" rx="2.5"/><polygon points="5.5,10 5.5,13 8.5,10" stroke-linejoin="round"/></svg>' +
      '<span class="cc-thought-header-text">思考中…</span>' +
      '<span class="cc-thought-header-end">' +
      '<svg class="cc-thought-arrow" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="2.5,3.5 5,6.5 7.5,3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '</span></div>' +
      '<div class="cc-thought-content"></div></div>' +
      '<div class="cc-stream-content"></div>' +
      '<div class="cc-tools-section" style="display:none">' +
      '<div class="cc-tools-header">' +
      '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="2" width="4" height="4" rx="0.5"/><rect x="8" y="2" width="4" height="4" rx="0.5"/><rect x="2" y="8" width="4" height="4" rx="0.5"/><rect x="8" y="8" width="4" height="4" rx="0.5"/></svg>' +
      '工具调用</div>' +
      '<div class="cc-tool-grid"></div></div>' +
      '</div></div>';
    rc.appendChild(s);
    rc.scrollTop = rc.scrollHeight;
  }
  return s;
}

function appendStreamText(tab, chunk) {
  const s = getOrCreateBubble(tab);
  if (!s) return;
  const c = s.querySelector('.cc-stream-content');
  if (c) c.textContent += chunk;
  scrollToBottom(s);
  saveBubbleMessages(tab, s);
}

function appendThinking(tab, chunk) {
  const s = getOrCreateBubble(tab);
  if (!s) return;
  const contentEl = s.querySelector('.cc-thought-content');
  if (!contentEl) return;
  contentEl.classList.remove('collapsed');
  const arrow = s.querySelector('.cc-thought-arrow');
  if (arrow) arrow.classList.remove('collapsed');
  contentEl.textContent += chunk;
  scrollToBottom(s);
  saveBubbleMessages(tab, s);
}

function addToolCard(tab, tool) {
  const s = getOrCreateBubble(tab);
  if (!s) return;
  const grid = s.querySelector('.cc-tool-grid');
  const section = s.querySelector('.cc-tools-section');
  if (!grid || !section) return;
  section.style.display = '';
  if (grid.querySelector(`[data-tool-id="${escHtml(tool.id)}"]`)) return;
  const card = document.createElement('div');
  card.className = 'cc-tool-card';
  card.dataset.toolId = tool.id;
  card.dataset.toolName = tool.name;
  card.innerHTML =
    '<span class="cc-tool-card-icon">' + getToolIcon(tool.name) + '</span>' +
    '<span class="cc-tool-card-name">' + escHtml(tool.name) + '</span>' +
    '<span class="cc-tool-card-detail">' + escHtml(getToolDetail(tool)) + '</span>' +
    '<span class="cc-tool-card-status"><div class="cc-tool-status-spinner"></div></span>';
  grid.appendChild(card);
  scrollToBottom(s);
  saveBubbleMessages(tab, s);
}

export function finalizeTools(tab) {
  const rc = document.getElementById('response-content');
  if (!rc) return;
  rc.querySelectorAll('.cc-tool-card').forEach(card => {
    const statusEl = card.querySelector('.cc-tool-card-status');
    if (!statusEl) return;
    statusEl.innerHTML =
      '<svg class="cc-tool-status-done" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2"><polyline points="2,5 4.5,7.5 8,2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  });
  const activeTab = getActiveTab();
  if (activeTab) {
    const s = rc.querySelector('.cc-stream-bubble');
    if (s) saveBubbleMessages(activeTab, s);
  }
}

function finalizeStream(tab) {
  const rc = document.getElementById('response-content');
  if (!rc) return;
  const s = rc.querySelector('.cc-stream-bubble');
  if (s) {
    const thoughtHeader = s.querySelector('.cc-thought-header-text');
    const thoughtContent = s.querySelector('.cc-thought-content');
    const arrow = s.querySelector('.cc-thought-arrow');
    if (thoughtHeader) thoughtHeader.textContent = '思考过程';
    if (thoughtContent) thoughtContent.classList.add('collapsed');
    if (arrow) arrow.classList.add('collapsed');

    const c = s.querySelector('.cc-stream-content');
    const thoughtSection = s.querySelector('.cc-thought-section');
    if (c) {
      try {
        c.innerHTML = renderMarkdownSafe(c.textContent || '');
      } catch {
        c.innerHTML = escHtml(c.textContent || '').replace(/\n/g, '<br>');
      }
    }
    if (thoughtContent && !thoughtContent.textContent.trim()) {
      if (thoughtSection) thoughtSection.style.display = 'none';
    }
    s.classList.remove('cc-stream-bubble');
  }
  const ld = rc.querySelector('.cc-loading');
  if (ld) ld.remove();
  tab._messages = rc.innerHTML;
}

function saveBubbleMessages(tab, bubbleEl) {
  const rc = document.getElementById('response-content');
  if (rc && tab) tab._messages = rc.innerHTML;
}

function scrollToBottom(bubbleEl) {
  const rc = document.getElementById('response-content');
  if (rc) rc.scrollTop = rc.scrollHeight;
}

// ==================== 思考区折叠/展开 ====================

export function initThoughtToggle() {
  const rc = document.getElementById('response-content');
  if (!rc) return;
  rc.addEventListener('click', (e) => {
    const header = e.target.closest('.cc-thought-header');
    if (!header) return;
    const bubble = header.closest('.cc-stream-bubble, .notion-chat-message');
    if (!bubble) return;
    if (bubble.classList.contains('cc-stream-bubble')) {
      return; // streaming 进行中不允许折叠
    }
    const content = bubble.querySelector('.cc-thought-content');
    const arrow = header.querySelector('.cc-thought-arrow');
    if (!content || !arrow) return;
    content.classList.toggle('collapsed');
    arrow.classList.toggle('collapsed');
  });
}
