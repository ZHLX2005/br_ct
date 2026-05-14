/**
 * Grok 剪贴板捕获配置
 * 通过 chrome.scripting.executeScript 注入，不使用 ES module。
 */
(function() {
  if (window.grokCaptureConfig) return;

  window.grokCaptureConfig = {
    name: 'grok',
    action: 'grokCopyCapture',

    // ============= 复制按钮 =============
    // Grok 的操作栏按钮有 aria-label 属性
    copyBtnPrimarySelector: 'button[aria-label="复制"]',
    copyBtnSelectors: [
      'button[aria-label="复制"]',
      'button[aria-label="Copy"]',
      'button[aria-label*="copy"]',
    ],

    // ============= 内容定位 =============
    getContentRoot: function(turnRoot) {
      var contentEl = turnRoot.querySelector('div.message-bubble');
      if (contentEl) return contentEl;
      return turnRoot;
    },

    getConversationId: function() {
      try {
        var parts = window.location.pathname.split('/').filter(Boolean);
        // URL 格式: /c/<conversation-id>
        if (parts[0] === 'c' && parts[1]) return parts[1];
      } catch(e) {}
      return '__default__';
    },

    getMessageId: function(element) {
      if (!element) return null;
      if (!element.dataset.testid) {
        var turns = document.querySelectorAll('[class*="group"][class*="flex-col"][class*="justify-center"]');
        var index = Array.prototype.indexOf.call(turns, element);
        element.dataset.testid = 'grok-turn-' + (index >= 0 ? index + 1 : 'unknown');
      }
      return element.dataset.testid;
    },

    // ============= 事件检测 =============
    detectTurn: function(target) {
      if (!(target instanceof Element)) return null;
      // Grok assistant 回复在 message-bubble 的父容器中
      var bubble = target.closest('div.message-bubble');
      if (bubble) {
        var turn = bubble.closest('[class*="group"][class*="flex-col"][class*="justify-center"]');
        if (turn) return turn;
      }
      // 从 action bar 定位
      var actionBar = target.closest('div.action-buttons');
      if (actionBar) {
        var turn = actionBar.closest('[class*="group"][class*="flex-col"][class*="justify-center"]');
        if (turn) return turn;
      }
      return null;
    },

    isCopyControl: function(element) {
      if (!(element instanceof Element)) return false;
      if (element.closest('button[aria-label="复制"]')) return true;
      if (element.closest('button[aria-label="Copy"]')) return true;
      var label = [
        element.getAttribute('aria-label'),
        element.getAttribute('title'),
        element.textContent,
      ].filter(Boolean).join(' ').toLowerCase();
      return /copy|复制/.test(label);
    },

    // ============= 可选 =============
    skipTags: new Set(['BUTTON', 'SCRIPT', 'STYLE', 'SVG', 'PATH']),
    skipDomFallback: true,
    contextWindowMs: 6000,
    debug: true,
  };
})();
