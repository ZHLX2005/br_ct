/**
 * Zai 回复监听模块
 *
 * 通过 chrome.scripting.executeScript 注入，使用 IIFE + window.* 全局通信。
 * 依赖：ResponseListenerCore（core.js 中定义）
 */
(function() {
  if (window.__zaiResponseListenerInjected) return;
  window.__zaiResponseListenerInjected = true;

  if (!window.ResponseListenerCore) {
    console.warn('[Zai Response Listener] ResponseListenerCore not found');
    return;
  }

  window.ResponseListenerCore.createResponseListener({
    platform: 'zai',
    hostnames: ['chat.z.ai'],

    // Zai 使用 .chat-assistant 和 .chat-user 作为消息容器
    responseSelectors: [
      '.chat-assistant.markdown-prose',
      '.chat-assistant',
    ],

    // Turn 容器是 div.group
    turnSelectors: [
      '.group',
    ],

    skipTags: new Set(['BUTTON', 'SCRIPT', 'STYLE', 'SVG', 'PATH']),

    captureConfig: 'zaiCaptureConfig',

    settleTimeMs: 1800,

    getConversationId: function() {
      try {
        var parts = window.location.pathname.split('/').filter(Boolean);
        return parts[parts.length - 1] || '__default__';
      } catch(e) {}
      return '__default__';
    },

    getMessageId: function(element) {
      if (!element) return null;
      var turn = element.closest('.group');
      if (turn) {
        if (!turn.dataset.testid) {
          var turns = document.querySelectorAll('.group');
          var index = Array.prototype.indexOf.call(turns, turn);
          turn.dataset.testid = 'zai-turn-' + (index >= 0 ? index + 1 : 'unknown');
        }
        return turn.dataset.testid;
      }
      return null;
    },

    isGenerating: function() {
      var stopBtn = document.querySelector('button[aria-label*="Stop"]') ||
                    document.querySelector('button[aria-label*="停止"]');
      if (stopBtn && !stopBtn.disabled) return true;
      return false;
    },
  });
})();
