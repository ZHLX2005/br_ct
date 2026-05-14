(function() {
  if (window.notionaiCaptureConfig) return;

  function getTurnRoot(element) {
    if (!(element instanceof Element)) return null;
    return element.closest('.layout-content, [class*="layout-content"]') ||
      (element.matches('.layout-content, [class*="layout-content"]') ? element : null);
  }

  function ensureStableTurnId(turn) {
    if (!(turn instanceof Element)) return null;
    if (!turn.dataset.testid) {
      window.__notionaiTurnSeq = (window.__notionaiTurnSeq || 0) + 1;
      turn.dataset.testid = 'notionai-turn-' + window.__notionaiTurnSeq + '-' + Date.now();
    }
    return turn.dataset.testid;
  }

  window.notionaiCaptureConfig = {
    name: 'notionai',
    action: 'notionaiCopyCapture',
    copyBtnPrimarySelector: '[aria-label="拷贝回复"],[aria-label="Copy response"]',
    copyBtnSelectors: [
      '[aria-label="拷贝回复"],[aria-label="Copy response"]',
      '[aria-label="拷贝文本"],[aria-label="Copy text"]',
      '[aria-label*="copy" i]',
      'div[role="button"][aria-label*="copy" i]',
    ],
    copyBtnFindLast: true,

    getContentRoot: function(turnRoot) {
      var blocks = turnRoot.querySelectorAll('[data-content-editable-leaf]');
      if (blocks.length > 0) {
        for (var i = blocks.length - 1; i >= 0; i--) {
          var t = blocks[i].textContent ? blocks[i].textContent.trim() : '';
          if (t) return blocks[i];
        }
      }
      var el = turnRoot.querySelector('.layout-content') ||
        turnRoot.querySelector('[class*="layout-content"]');
      if (el) return el;
      return turnRoot;
    },

    getConversationId: function() {
      try {
        var params = new URLSearchParams(window.location.search);
        var t = params.get('t');
        if (t) return t;
        var parts = window.location.pathname.split('/').filter(Boolean);
        return parts[parts.length - 1] || '__default__';
      } catch (e) {}
      return '__default__';
    },

    getMessageId: function(element) {
      var turn = getTurnRoot(element);
      return turn ? ensureStableTurnId(turn) : null;
    },

    detectTurn: function(target) {
      if (!(target instanceof Element)) return null;
      return target.closest('.layout-content, [class*="layout-content"], [data-testid^="notionai-turn-"]');
    },

    isCopyControl: function(element) {
      if (!(element instanceof Element)) return false;
      var aria = element.getAttribute('aria-label') || '';
      if (/copy|复制/i.test(aria)) return true;
      var label = [
        element.getAttribute('title'),
        element.textContent,
      ].filter(Boolean).join(' ').toLowerCase();
      return /copy|复制/.test(label);
    },

    skipTags: new Set(['BUTTON', 'SCRIPT', 'STYLE', 'SVG', 'PATH']),
    contextWindowMs: 6000,
    debug: true,
  };
})();
