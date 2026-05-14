/**
 * 智谱清言 (ChatGLM) 回复监听模块
 *
 * 通过 chrome.scripting.executeScript 注入，使用 IIFE + window.* 全局通信。
 * 依赖：ResponseListenerCore（core.js 中定义）
 */
(function() {
  if (window.__glmResponseListenerInjected) return;
  window.__glmResponseListenerInjected = true;

  if (!window.ResponseListenerCore) {
    console.warn('[GLM Response Listener] ResponseListenerCore not found');
    return;
  }

  window.ResponseListenerCore.createResponseListener({
    platform: 'glm',
    hostnames: ['chatglm.cn'],

    // GLM 每条回复在 div.answer-content 中
    responseSelectors: [
      'div.answer-content',
    ],

    // Turn 容器
    turnSelectors: [
      'div.item.conversation-item',
    ],

    skipTags: new Set(['BUTTON', 'SCRIPT', 'STYLE', 'SVG', 'PATH']),

    captureConfig: 'glmCaptureConfig',

    settleTimeMs: 1800,

    getConversationId: function() {
      try {
        var url = new URL(window.location.href);
        var cid = url.searchParams.get('cid');
        if (cid) return cid;
      } catch(e) {}
      return '__default__';
    },

    getMessageId: function(element) {
      if (!element) return null;
      // 从 answer-content 向上找到 turn 容器
      var turn = element.closest('div.item.conversation-item');
      if (turn) {
        if (!turn.dataset.testid) {
          var turns = document.querySelectorAll('div.item.conversation-item');
          var index = Array.prototype.indexOf.call(turns, turn);
          turn.dataset.testid = 'glm-turn-' + (index >= 0 ? index + 1 : 'unknown');
        }
        return turn.dataset.testid;
      }
      return null;
    },

    isGenerating: function() {
      // GLM 生成中会显示停止按钮
      var stopBtn = document.querySelector('button[aria-label*="Stop"]') ||
                    document.querySelector('button[aria-label*="停止"]') ||
                    document.querySelector('[class*="stop"]');
      if (stopBtn && !stopBtn.disabled) return true;
      return false;
    },
  });
})();
