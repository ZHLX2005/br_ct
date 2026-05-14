/**
 * DeepSeek 剪贴板捕获配置
 * 通过 chrome.scripting.executeScript 注入，不使用 ES module。
 */
(function() {
  if (window.deepseekCaptureConfig) return;

  window.deepseekCaptureConfig = {
    name: 'deepseek',
    action: 'deepseekCopyCapture',

    // ============= 复制按钮 =============
    // DeepSeek 在 assistant 回复的操作栏中，第一个 ds-icon-button 是复制按钮
    copyBtnPrimarySelector: 'div.ds-flex._0a3d93b div.ds-icon-button:first-child',
    copyBtnSelectors: [
      'div.ds-flex._0a3d93b div.ds-icon-button:first-child',
      'div.ds-flex._0a3d93b div.ds-icon-button',
      'div.ds-icon-button',
    ],

    // ============= 内容定位 =============
    getContentRoot: function(turnRoot) {
      var contentEl = turnRoot.querySelector('div.ds-markdown.ds-assistant-message-main-content');
      if (contentEl) return contentEl;
      // 兜底：取第一个 ds-message 内的 markdown 内容
      var msg = turnRoot.querySelector('div.ds-message');
      if (msg) {
        var md = msg.querySelector('div.ds-markdown');
        if (md) return md;
      }
      return turnRoot;
    },

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
      return element.getAttribute('data-virtual-list-item-key') ||
        element.dataset.virtualListItemKey ||
        element.dataset.testid ||
        null;
    },

    // ============= 事件检测 =============
    detectTurn: function(target) {
      if (!(target instanceof Element)) return null;
      // DeepSeek assistant 回复容器为 div._4f9bf79
      var turn = target.closest('div._4f9bf79');
      if (turn) return turn;
      return null;
    },

    isCopyControl: function(element) {
      if (!(element instanceof Element)) return false;
      // DeepSeek 使用 ds-icon-button 且没有 aria-label
      // 操作栏中的第一个按钮是复制按钮
      var actionBar = element.closest('div.ds-flex._0a3d93b');
      if (actionBar) {
        if (element.tagName === 'DIV' && element.className.indexOf('ds-icon-button') !== -1) return true;
        if (element.closest('div.ds-icon-button')) return true;
      }
      return false;
    },

    // ============= 可选 =============
    skipTags: new Set(['BUTTON', 'SCRIPT', 'STYLE', 'SVG', 'PATH']),
    skipDomFallback: true,
    contextWindowMs: 2500,
    debug: true,
  };
})();
