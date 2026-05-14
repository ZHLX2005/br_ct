/**
 * 智谱清言 (ChatGLM) 剪贴板捕获配置
 * 通过 chrome.scripting.executeScript 注入，不使用 ES module。
 */
(function() {
  if (window.glmCaptureConfig) return;

  window.glmCaptureConfig = {
    name: 'glm',
    action: 'glmCopyCapture',

    // ============= 复制按钮 =============
    // DOM 结构:
    //   div.copy
    //     └── i.shim.copy           ← onclick 在此层
    //         └── svg
    //             └── path
    // simulateCopy 会跳过 SVG 容器，在 i.shim.copy 上派发事件
    copyBtnPrimarySelector: 'div.answer div.copy',
    copyBtnSelectors: [
      'div.answer div.copy',
      'div.copy',
      'i.shim.copy',
    ],

    // ============= 内容定位 =============
    getContentRoot: function(turnRoot) {
      var contentEl = turnRoot.querySelector('.answer-content');
      if (contentEl) return contentEl;
      var interact = turnRoot.querySelector('.interact-container');
      if (interact) return interact;
      return turnRoot;
    },

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
      if (!element.dataset.testid) {
        var turns = document.querySelectorAll('div.item.conversation-item');
        var index = Array.prototype.indexOf.call(turns, element);
        element.dataset.testid = 'glm-turn-' + (index >= 0 ? index + 1 : 'unknown');
      }
      return element.dataset.testid;
    },

    // ============= 事件检测 =============
    detectTurn: function(target) {
      if (!(target instanceof Element)) return null;
      // GLM 的 turn 容器为 div.item.conversation-item
      var turn = target.closest('div.item.conversation-item');
      if (turn) return turn;
      return null;
    },

    isCopyControl: function(element) {
      if (!(element instanceof Element)) return false;
      if (element.closest('div.answer div.copy')) return true;
      if (element.closest('span.copy-table-btn')) return true;
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
    contextWindowMs: 2500,
    debug: true,
  };
})();
