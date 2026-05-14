/**
 * Notion AI 回复监听模块
 *
 * 通过 chrome.scripting.executeScript 注入，使用 IIFE + window.* 全局通信。
 * 依赖：ResponseListenerCore（core.js 中定义）
 *
 * NOTE: Notion AI 使用块编辑器，整个对话渲染为单个 Notion 页面。
 *       没有 per-turn 的 DOM 分隔，所有消息在 .layout-content 内。
 *       复制按钮为 div[role="button"]（非 button），aria-label="Copy response"。
 */
(function() {
  if (window.__notionaiResponseListenerInjected) return;
  window.__notionaiResponseListenerInjected = true;

  function getNotionTurnOrdinal() {
    var copyButtons = document.querySelectorAll('[aria-label="拷贝回复"], [aria-label="Copy response"]');
    var count = copyButtons.length;
    if (window.__notionaiExpectedTurnOrdinal) {
      return window.__notionaiExpectedTurnOrdinal;
    }
    if (window.__notionaiLastSendTime && Date.now() - window.__notionaiLastSendTime < 30000) {
      return count + 1;
    }
    return Math.max(1, count);
  }

  if (!window.ResponseListenerCore) {
    console.warn('[NotionAI Response Listener] ResponseListenerCore not found');
    return;
  }

  window.ResponseListenerCore.createResponseListener({
    platform: 'notionai',
    hostnames: ['www.notion.so'],

    // 整个对话在 .layout-content 中，优先用它作为响应容器
    // [data-content-editable-leaf] 是 Notion 块属性，可能在 DOM 中不存在
    responseSelectors: [
      '.layout-content',
      '[class*="layout-content"]',
      '[data-content-editable-leaf]',
    ],

    // 整个对话页面作为一个 turn 容器
    turnSelectors: [
      '.layout-content',
      '[class*="layout-content"]',
    ],

    skipTags: new Set(['BUTTON', 'SCRIPT', 'STYLE', 'SVG', 'PATH']),

    captureConfig: 'notionaiCaptureConfig',

    // 内容稳定后才触发 autoCapture，避免流式输出未完成时捕获不完整内容
    settleTimeMs: 1500,

    getConversationId: function() {
      try {
        var params = new URLSearchParams(window.location.search);
        var t = params.get('t');
        if (t) return t;
        var parts = window.location.pathname.split('/').filter(Boolean);
        return parts[parts.length - 1] || '__default__';
      } catch(e) {}
      return '__default__';
    },

    getMessageId: function(element) {
      if (!element) return null;
      var turn = element.closest('.layout-content, [class*="layout-content"]');
      if (turn) {
        return 'notionai-turn-' + getNotionTurnOrdinal();
      }
      return null;
    },

    isGenerating: function() {
      var copyButtons = document.querySelectorAll('[aria-label="拷贝回复"], [aria-label="Copy response"]');
      var count = copyButtons.length;
      if (window.__notionaiExpectedTurnOrdinal && count < window.__notionaiExpectedTurnOrdinal) {
        return true;
      }
      // 刚发送消息后的 3 秒内视为生成中，避免用户消息渲染触发 autoCapture
      if (window.__notionaiLastSendTime && Date.now() - window.__notionaiLastSendTime < 3000) {
        return true;
      }
      var stopBtn = document.querySelector('button[aria-label*="Stop"]') ||
                    document.querySelector('button[aria-label*="停止"]');
      if (stopBtn && !stopBtn.disabled) return true;
      return false;
    },
  });
})();
