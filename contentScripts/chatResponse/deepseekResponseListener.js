/**
 * DeepSeek 回复监听模块
 *
 * 通过 chrome.scripting.executeScript 注入，使用 IIFE + window.* 全局通信。
 * 依赖：ResponseListenerCore（core.js 中定义）
 */
(function() {
  if (window.__deepseekResponseListenerInjected) return;
  window.__deepseekResponseListenerInjected = true;

  if (!window.ResponseListenerCore) {
    console.warn('[DeepSeek Response Listener] ResponseListenerCore not found');
    return;
  }

  window.ResponseListenerCore.createResponseListener({
    platform: 'deepseek',
    hostnames: ['chat.deepseek.com'],

    // Assistant 回复的 markdown 内容元素
    // responseListenerCore 的 readResponseContent 会在此容器内提取纯文本
    responseSelectors: [
      'div.ds-markdown.ds-assistant-message-main-content',
    ],

    // Turn（完整回复容器）选择器，用于 autoCapture 定位操作栏中的复制按钮
    turnSelectors: [
      'div._4f9bf79',
    ],

    skipTags: new Set(['BUTTON', 'SCRIPT', 'STYLE', 'SVG', 'PATH']),

    captureConfig: 'deepseekCaptureConfig',

    settleTimeMs: 1800,

    getConversationId: function() {
      try {
        var parts = window.location.pathname.split('/').filter(Boolean);
        // URL 格式: /a/chat/s/<conversation-id>
        var sIdx = parts.indexOf('s');
        if (sIdx !== -1 && parts[sIdx + 1]) return parts[sIdx + 1];
      } catch(e) {}
      return '__default__';
    },

    getMessageId: function(element) {
      if (!element) return null;
      // 从 markdown 内容元素向上找到 turn 容器
      var turn = element.closest('div._4f9bf79');
      if (turn) {
        return turn.getAttribute('data-virtual-list-item-key') ||
               turn.dataset.virtualListItemKey ||
               turn.dataset.testid ||
               null;
      }
      return null;
    },

    isGenerating: function() {
      // DeepSeek 生成中会在底部有停止按钮
      var stopBtn = document.querySelector('button[aria-label*="Stop"]') ||
                    document.querySelector('[class*="stop"]') ||
                    document.querySelector('[class*="Stop"]');
      if (stopBtn && !stopBtn.disabled) return true;
      return false;
    },
  });
})();
