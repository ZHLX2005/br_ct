/**
 * ccSend.js — 消息发送模块
 *
 * 处理用户输入解析、/skill 指令、WS 连通性检查、消息发送与错误处理。
 * 与 ccDispatcher.js 通过 state.pendingQuery 通信（Promise 桥接）。
 */

import { getActiveTab } from './ccTabs.js';
import { loadTabSkills } from './ccSkills.js';
import { sendBg, sendBgRequest } from '../common/ccBgComms.js';
import { state, QUERY_TIMEOUT_MS } from '../common/ccConstants.js';
import { escHtml } from '../common/ccUtils.js';
import { buildPromptWithContext } from './ccExtract.js';

// ==================== 初始化发送按钮 ====================

export function updateSendButtonMode() {
  const sendBtn = document.getElementById('chat-btn-send');
  if (!sendBtn) return;
  if (state.isStreaming) {
    sendBtn.classList.add('mode-stop');
    sendBtn.disabled = false;
    // ■ 停止图标
    sendBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="2" y="2" width="10" height="10" rx="2"/></svg>';
  } else {
    sendBtn.classList.remove('mode-stop');
    const input = document.getElementById('chat-input');
    sendBtn.disabled = input ? !input.value.trim() : true;
    // ▶ 发送图标
    sendBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8l12-6-6 12-2-4-4-2z" fill="currentColor"/></svg>';
  }
}

export function initSendButton() {
  const sendBtn = document.getElementById('chat-btn-send');
  const input = document.getElementById('chat-input');
  if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      if (state.isStreaming) {
        handleStop();
      } else {
        handleSend();
      }
    });
  }
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (state.isStreaming) {
          handleStop();
        } else {
          handleSend();
        }
      }
    });
    const autoResize = () => {
      if (!state.isStreaming) sendBtn.disabled = !input.value.trim();
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    };
    input.addEventListener('input', autoResize);
    autoResize();
  }
}

/** 停止当前流式任务 */
function handleStop() {
  const tab = getActiveTab();
  if (!tab) return;
  // 乐观重置按钮状态：立即切回发送模式
  state.isStreaming = false;
  updateSendButtonMode();
  // 一并终结 pendingQuery，防止 handleSend 的 try/catch 永远挂起
  if (state.pendingQuery) {
    state.pendingQuery.resolve({ status: 'cancelled', data: { text: tab._streamingText || '' } });
    state.pendingQuery = null;
  }
  const workDir = tab._path || document.getElementById('cc-path-input')?.value.trim() || '';
  console.log('[cc] cancelling turn for session=' + tab._sessionName + ' cwd=' + workDir);
  sendBg({ action: 'nxce_ws', cmd: 'cancel', session: tab._sessionName, cwd: workDir }).catch(err => {
    console.error('[cc] cancel error:', err);
  });
  // 即使 cancel 消息未到达，也立即恢复按钮状态
  // 等 server 返回 cancelled / cancel_failed / done 事件时 dispatcher 会再次同步（幂等）
}

// ==================== 发送主流程 ====================

export async function handleSend() {
  const input = document.getElementById('chat-input');
  const pathInput = document.getElementById('cc-path-input');
  if (!input) return;
  const raw = input.value.trim();
  if (!raw) return;
  const tab = getActiveTab();
  if (!tab) return;

  console.log('[cc] handleSend raw:', raw);

  // 先等 skills 加载完成再解析 /skill 指令，避免 __probe__ 未返回时匹配丢失
  await loadTabSkills(tab);

  // 解析 /skill 指令
  const tabSkills = tab._skills || [];
  const skills = [];
  let prompt = raw;
  const slashMatches = raw.match(/\/([\w-]+)/g);
  if (slashMatches) {
    for (const m of slashMatches) {
      const name = m.slice(1);
      if (tabSkills.some(s => s.name === name)) {
        skills.push(name);
        prompt = prompt.replace(m, '').trim();
      }
    }
  }
  if (!prompt && skills.length === 0) return;
  if (!prompt && skills.length > 0) {
    console.warn('[cc] skills-only without prompt:', skills);
    const rc2 = document.getElementById('response-content');
    if (rc2) {
      const e = document.createElement('div');
      e.className = 'notion-chat-message';
      e.innerHTML = '<div class="notion-chat-bubble" style="border-color:#f59e0b;"><div class="notion-chat-bubble-content" style="color:#92400e;">请在 /skill 后面补充问题</div></div>';
      rc2.appendChild(e);
      rc2.scrollTop = rc2.scrollHeight;
    }
    return;
  }

  console.log('[cc] send: prompt="' + prompt + '" skills=[' + skills.join(',') + ']');

  const workDir = pathInput?.value.trim() || '';
  input.value = '';
  input.dispatchEvent(new Event('input'));

  // 在 UI 中显示用户消息
  const rc = document.getElementById('response-content');
  if (rc) {
    const badges = skills.length
      ? '<div class="cc-bubble-skills">' + skills.map(s => `<span class="cc-skill-tag">${escHtml(s)}</span>`).join('') + '</div>'
      : '';
    const u = document.createElement('div');
    u.className = 'notion-chat-message notion-chat-message--user';
    u.innerHTML =
      '<div class="notion-chat-bubble notion-chat-bubble--user" style="flex:0 1 auto;max-width:88%;">' +
      '<div class="notion-chat-bubble-header"><span class="notion-chat-bubble-name">You</span></div>' +
      `<div class="notion-chat-bubble-content">${escHtml(prompt)}</div>${badges}</div>`;
    rc.appendChild(u);
    rc.scrollTop = rc.scrollHeight;
    tab._messages = rc.innerHTML;
  }

  // loading 动画
  const ld = document.createElement('div');
  ld.className = 'cc-loading';
  ld.innerHTML =
    '<div class="notion-chat-avatar"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></div>' +
    '<div class="cc-loading-dots"><span class="cc-loading-dot"></span><span class="cc-loading-dot"></span><span class="cc-loading-dot"></span></div>';
  if (rc) { rc.appendChild(ld); rc.scrollTop = rc.scrollHeight; }

  // 发送前检查 WS 连通性
  const ping = await sendBgRequest({ action: 'nxce_ws', cmd: 'ping' }, 3000);
  if (!ping?.ok || !ping?.connected) {
    if (ld.parentNode) ld.remove();
    if (rc) {
      rc.querySelector('.cc-stream-bubble')?.remove();
      const e = document.createElement('div');
      e.className = 'notion-chat-message';
      e.innerHTML = '<div class="notion-chat-bubble" style="border-color:#e53e3e;"><div class="notion-chat-bubble-content" style="color:#e53e3e;">nx-ce serve 未连接，请先点击右上角「连接」按钮启动服务</div></div>';
      rc.appendChild(e); rc.scrollTop = rc.scrollHeight;
    }
    return;
  }

  // 发送 query（通过 background）
  try {
    const session = tab._sessionName || 'default';
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err, v) => {
        if (settled) return;
        settled = true;
        state.pendingQuery = null;
        if (err) reject(err);
        else resolve(v);
      };
      state.pendingQuery = { resolve: r => finish(null, r), reject: e => finish(e) };
      tab._silentTurn = false;

      // 超时兜底（0=不超时，靠 WS done 事件自然结束）
      let timer = null;
      if (QUERY_TIMEOUT_MS > 0) {
        timer = setTimeout(() => finish(new Error('查询超时（确认 Claude CLI 是否已安装且在 PATH 中）')), QUERY_TIMEOUT_MS);
      }
      const origReject = state.pendingQuery.reject;
      state.pendingQuery.reject = (e) => { if (timer) clearTimeout(timer); origReject(e); };
      state.pendingQuery.resolve = (v) => { if (timer) clearTimeout(timer); finish(null, v); };

      const finalPrompt = buildPromptWithContext(tab, prompt);
      const queryMsg = { action: 'nxce_ws', cmd: 'query', session, cwd: workDir, prompt: finalPrompt, queryId: 'q-' + Date.now() };
      if (skills.length > 0) queryMsg.skills = skills;
      console.log('[cc] sendMessage queryMsg:', JSON.stringify(queryMsg));
      chrome.runtime.sendMessage(queryMsg, (resp) => {
        console.log('[cc] query response:', resp);
        if (chrome.runtime.lastError) { finish(new Error(chrome.runtime.lastError.message)); return; }
        if (!resp?.ok) finish(new Error(resp?.error || '发送失败'));
        // 成功发送后，等待 background 转发 done/text/error
      });
    });
  } catch (err) {
    console.error('[cc] handleSend error:', err);
    if (ld.parentNode) ld.remove();
    if (rc) {
      rc.querySelector('.cc-stream-bubble')?.remove();
      const e = document.createElement('div');
      e.className = 'notion-chat-message';
      e.innerHTML = `<div class="notion-chat-bubble" style="border-color:#e53e3e;"><div class="notion-chat-bubble-content" style="color:#e53e3e;">${escHtml(err.message)}</div></div>`;
      rc.appendChild(e);
    }
  } finally {
    if (ld.parentNode) ld.remove();
  }
}
