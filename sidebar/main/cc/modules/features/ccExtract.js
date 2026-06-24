/**
 * ccExtract.js — CC 模式页面上下文提取模块
 *
 * 职责：
 *   1. 提取按钮 → 调用后端 extractPageText → 写 tab._extractedCtx → 渲染面板
 *   2. 清除按钮 → 清 tab._extractedCtx → 隐藏面板
 *   3. 暴露 buildPromptWithContext 给 ccSend.js 注入前缀
 *   4. 暴露 renderExtractPanel 给 ccTabs.js 在切/建 tab 时同步
 *
 * 不负责：
 *   - 网络请求细节（统一走 ../common/ccBgComms.js 的 sendBgRequest，带 5s 超时）
 *   - 流式渲染（不动 ccDispatcher.js）
 *   - 状态跨标签页持久化
 */

import { sendBgRequest } from '../common/ccBgComms.js';

// ==================== Prompt 注入 ====================

/**
 * 把用户 prompt 与提取的网页上下文拼装成最终 prompt。
 * 若 tab._extractedCtx 不存在或 .text 为空，返回 userPrompt 原样。
 *
 * @param {Element|null} tab - 活动 tab DOM 元素
 * @param {string} userPrompt - 用户在输入框中输入的原始文本
 * @returns {string} 注入上下文后的最终 prompt（无上下文时等同 userPrompt）
 */
export function buildPromptWithContext(tab, userPrompt) {
  const ctx = tab?._extractedCtx;
  if (!ctx || !ctx.text) return userPrompt;
  const title = (ctx.title || '').replace(/"/g, '&quot;');
  const url = (ctx.url || '').replace(/"/g, '&quot;');
  // 防注入：把潜在的 </page_context> 闭合标签替换为零宽字符（U+200B）
  const safeText = ctx.text.replace(/<\/page_context>/g, '</page_context​>');
  return `<page_context source="${url}" title="${title}">\n${safeText}\n</page_context>\n\n${userPrompt}`;
}

// ==================== 面板渲染 ====================

/**
 * 同步提取面板显示状态。
 * - 无 tab 或 tab._extractedCtx 为空 → 隐藏面板 + 按钮文本恢复为"提取"
 * - 有上下文 → 显示面板内容 + 按钮文本改为"重新提取"
 *
 * @param {Element|null} tab - 活动 tab DOM 元素
 */
export function renderExtractPanel(tab) {
  const panel = document.getElementById('cc-extract-panel');
  const btn = document.getElementById('cc-btn-extract');
  if (!panel || !btn) return;
  const ctx = tab?._extractedCtx;
  if (!ctx || !ctx.text) {
    panel.style.display = 'none';
    btn.textContent = '提取';
    btn.disabled = false;
    btn.removeAttribute('title');
    return;
  }
  // 填充面板
  const charCount = document.getElementById('cc-extract-charcount');
  const titleEl = document.getElementById('cc-extract-title');
  const urlEl = document.getElementById('cc-extract-url');
  const previewEl = document.getElementById('cc-extract-preview');
  if (charCount) charCount.textContent = `已提取 ${ctx.text.length} 字符`;
  if (titleEl) titleEl.textContent = ctx.title || '(无标题)';
  if (urlEl) urlEl.textContent = ctx.url || '';
  if (previewEl) {
    const MAX_PREVIEW_CHARS = 200;
    previewEl.textContent = ctx.text.length > MAX_PREVIEW_CHARS
      ? ctx.text.slice(0, MAX_PREVIEW_CHARS) + '...'
      : ctx.text;
  }
  panel.style.display = 'block';
  btn.textContent = '重新提取';
  btn.disabled = false;
  btn.title = `当前已附加 ${ctx.text.length} 字符上下文，点击会覆盖`;
}

// ==================== 临时提示浮层 ====================

/**
 * 在 sidebar 底部显示临时提示，durationMs 后自动消失。
 * 多次调用会重置定时器，不会堆叠。
 *
 * @param {string} text - 提示文本
 * @param {number} [durationMs=2000] - 显示时长（毫秒）
 */
export function showTempMessage(text, durationMs = 2000) {
  let el = document.getElementById('cc-temp-msg');
  if (!el) {
    el = document.createElement('div');
    el.id = 'cc-temp-msg';
    Object.assign(el.style, {
      position: 'fixed',
      bottom: '80px',
      right: '16px',
      padding: '8px 12px',
      background: 'rgba(0, 0, 0, 0.8)',
      color: '#fff',
      borderRadius: '4px',
      fontSize: '12px',
      zIndex: '9999',
      pointerEvents: 'none',
      transition: 'opacity 0.2s',
    });
    document.body.appendChild(el);
  }
  if (el._timer) clearTimeout(el._timer);
  el.textContent = text;
  el.style.opacity = '1';
  el._timer = setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => { if (el.parentNode) el.remove(); }, 300);
  }, durationMs);
}

// ==================== 提取流程 ====================

/**
 * 点击"提取"按钮的处理函数：
 * 1. 按钮置 disabled + 文本改"提取中..."
 * 2. 调后端 extractPageText
 * 3. 成功 → 写 tab._extractedCtx → 渲染面板 → 提示
 * 4. 失败/空内容 → 提示 + 不写 _extractedCtx
 */
export async function handleExtractClick() {
  const tab = document.querySelector('.cc-tab.active');
  if (!tab) {
    showTempMessage('请先创建会话');
    return;
  }
  const btn = document.getElementById('cc-btn-extract');
  if (!btn) return;
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = '提取中...';
  try {
    // sendBgRequest(msg, timeout=5000) → 成功返回 resp（{status,result,...}），
    // 失败返回 {ok:false, error}，超时返回 null
    const response = await sendBgRequest({ action: 'extractPageText' });
    if (response === null) {
      // 5s 未收到后端响应 —— 留 _extractedCtx 不变，仅提示
      showTempMessage('提取超时，请重试', 2500);
    } else if (response && response.status === 'success' && response.result?.extracted) {
      const { title, url, text } = response.result;
      if (!text || !text.trim()) {
        showTempMessage('该页面无可提取内容');
        return;
      }
      tab._extractedCtx = {
        title: title || '未获取到标题',
        url: url || '',
        text,
        extractedAt: Date.now(),
      };
      renderExtractPanel(tab);
      showTempMessage(`已提取 ${text.length} 字符`, 2000);
    } else {
      // 后端明确报错（含 ok:false / status!='success' / 未携带 result）
      const errMsg = response?.error || response?.message || '该页面无可提取内容';
      showTempMessage('提取失败: ' + errMsg, 2500);
    }
  } catch (err) {
    showTempMessage('提取失败: ' + (err?.message || '未知错误'), 2500);
  } finally {
    btn.disabled = false;
    btn.textContent = tab._extractedCtx ? '重新提取' : '提取';
    if (tab._extractedCtx) {
      btn.title = `当前已附加 ${tab._extractedCtx.text.length} 字符上下文，点击会覆盖`;
    } else {
      btn.removeAttribute('title');
    }
  }
}

/**
 * 点击"清除"按钮的处理函数。
 */
function handleClearClick() {
  const tab = document.querySelector('.cc-tab.active');
  if (!tab) return;
  tab._extractedCtx = null;
  renderExtractPanel(tab);
  showTempMessage('已清除上下文');
}

// ==================== 初始化 ====================

/**
 * 绑定 DOM 事件。由 cc.js 在 mount 时调用。
 */
export function init() {
  const extractBtn = document.getElementById('cc-btn-extract');
  const clearBtn = document.getElementById('cc-btn-extract-clear');
  if (extractBtn) {
    extractBtn.addEventListener('click', handleExtractClick);
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', handleClearClick);
  }
}
