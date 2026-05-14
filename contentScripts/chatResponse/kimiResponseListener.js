/**
 * Kimi 回复监听模块
 *
 * 通过 chrome.scripting.executeScript 注入，使用 IIFE + window.* 全局通信。
 * 依赖：ResponseListenerCore（core.js 中定义）
 *
 * 注意：此配置基于 2026-05-11 CDP 验证的实际 Kimi DOM 结构：
 *   - 消息容器: .chat-content-item.chat-content-item-assistant
 *   - 内容区: .markdown-container > .markdown
 *   - 操作栏: .segment-assistant-actions .icon-button
 *   - 复制按钮: svg[name="Copy"] 所在的 div.icon-button
 */
(function() {
  if (window.__kimiResponseListenerInjected) return;
  window.__kimiResponseListenerInjected = true;

  if (!window.ResponseListenerCore) {
    console.warn('[Kimi Response Listener] ResponseListenerCore not found');
    return;
  }

  window.ResponseListenerCore.createResponseListener({
    platform: 'kimi',
    hostnames: ['www.kimi.com', 'kimi.com', 'kimi.moonshot.cn'],

    responseSelectors: [
      '.chat-content-item-assistant',
      '.chat-content-item',
    ],

    turnSelectors: [
      '.chat-content-item',
    ],

    skipTags: new Set(['BUTTON', 'SCRIPT', 'STYLE', 'SVG', 'PATH']),

    captureConfig: 'kimiCaptureConfig',

    settleTimeMs: 1200,

    getConversationId: function() {
      try {
        var parts = window.location.pathname.split('/').filter(Boolean);
        return parts[parts.length - 1] || '__default__';
      } catch(e) {}
      return '__default__';
    },

    getMessageId: function(element) {
      if (!element) return null;
      var turn = element.closest('.chat-content-item');
      if (turn) {
        if (!turn.dataset.testid) {
          var turns = document.querySelectorAll('.chat-content-item');
          var index = Array.prototype.indexOf.call(turns, turn);
          turn.dataset.testid = 'kimi-turn-' + (index >= 0 ? index + 1 : 'unknown');
        }
        return turn.dataset.testid;
      }
      return null;
    },

    isGenerating: function() {
      // Kimi 生成中时，最后一条消息的复制按钮可能尚未渲染，
      // 或底部会出现停止按钮
      var stopBtn = document.querySelector('button[aria-label*="Stop" i]') ||
                    document.querySelector('button[aria-label*="停止" i]');
      if (stopBtn && !stopBtn.disabled) return true;
      // 也检查是否有生成中的光标/指示器
      var generatingIndicator = document.querySelector('[class*="generating"], [class*="thinking"]');
      if (generatingIndicator) return true;
      return false;
    },
  });
})();
