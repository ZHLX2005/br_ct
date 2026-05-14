/**
 * Kimi 剪贴板捕获配置
 * 通过 chrome.scripting.executeScript 注入，不使用 ES module。
 *
 * 实际 DOM 结构（2026-05-11 CDP 验证）：
 *   div.chat-content-item.chat-content-item-assistant
 *     div.segment.segment-assistant
 *       div.segment-container
 *         div.segment-content
 *           div.segment-content-box
 *             div.markdown-container > div.markdown > [content]
 *         div.segment-assistant-actions
 *           div.segment-assistant-actions-content
 *             div.icon-button > svg[name="Copy"]   ← 复制按钮
 *             div.icon-button > svg[name="Refresh"]
 */
(function() {
  if (window.kimiCaptureConfig) return;

  window.kimiCaptureConfig = {
    name: 'kimi',
    action: 'kimiCopyCapture',

    // ============= 复制按钮 =============
    copyBtnPrimarySelector: '.segment-assistant-actions .icon-button',
    copyBtnSelectors: [
      '.segment-assistant-actions .icon-button',
      'svg[name="Copy"]',
      '.icon-button',
    ],

    // ============= 内容定位 =============
    getContentRoot: function(turnRoot) {
      var contentEl = turnRoot.querySelector('.markdown-container .markdown') ||
                      turnRoot.querySelector('.segment-content') ||
                      turnRoot.querySelector('.segment-container');
      if (contentEl) return contentEl;
      return turnRoot;
    },

    getConversationId: function() {
      try {
        var parts = window.location.pathname.split('/').filter(Boolean);
        return parts[parts.length - 1] || '__default__';
      } catch(e) {}
      return '__default__';
    },

    getMessageId: function(element) {
      if (!element) return null;
      if (!element.dataset.testid) {
        var turns = document.querySelectorAll('.chat-content-item');
        var index = Array.prototype.indexOf.call(turns, element);
        element.dataset.testid = 'kimi-turn-' + (index >= 0 ? index + 1 : 'unknown');
      }
      return element.dataset.testid;
    },

    // ============= 事件检测 =============
    detectTurn: function(target) {
      if (!(target instanceof Element)) return null;
      var turn = target.closest('.chat-content-item');
      if (turn) return turn;
      return null;
    },

    isCopyControl: function(element) {
      if (!(element instanceof Element)) return false;
      // Kimi 复制按钮是 div.icon-button > svg[name="Copy"]
      var btn = element.closest('.segment-assistant-actions .icon-button');
      if (btn && btn.querySelector('svg[name="Copy"]')) return true;
      return false;
    },

    // ============= 可选 =============
    skipTags: new Set(['BUTTON', 'SCRIPT', 'STYLE', 'SVG', 'PATH']),
    skipDomFallback: true,
    contextWindowMs: 2500,
    debug: true,
  };
})();
