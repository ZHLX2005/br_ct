// sidebar-selection-content.js
// 始终注入所有页面，通过 chrome.storage 控制激活/休眠（injected-dom-toggle-pattern）
// 边栏"划词"开关 → 写入 storage → 广播消息 → 本脚本激活/休眠

(function() {
  'use strict';

  let selectionBtn = null;
  let currentSelection = '';
  let isActive = false; // 默认休眠

  // ===== 创建浮动按钮 =====
  function createButton() {
    const btn = document.createElement('div');
    btn.id = '__sidebar_sel_btn__';
    btn.textContent = '提取选择';
    Object.assign(btn.style, {
      position: 'fixed',
      zIndex: '2147483647',
      background: '#fff',
      color: '#1d1d1f',
      border: '1px solid #d1d5db',
      borderRadius: '6px',
      padding: '5px 12px',
      fontSize: '12px',
      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
      fontWeight: '500',
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      display: 'none',
      lineHeight: '1.4',
      userSelect: 'none',
      letterSpacing: '0.01em',
    });
    btn.addEventListener('mouseenter', () => { btn.style.background = '#f3f4f6'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = '#fff'; });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (currentSelection) {
        chrome.runtime.sendMessage({
          action: 'sideSelExtracted',
          text: currentSelection,
          title: document.title,
          url: location.href,
        });
      }
      hideButton();
    });
    document.body.appendChild(btn);
    return btn;
  }

  function showButton(x, y) {
    if (!selectionBtn) selectionBtn = createButton();
    const btnW = 90;
    const pad = 4;
    let left = Math.max(pad, Math.min(x, window.innerWidth - btnW - pad));
    selectionBtn.style.left = left + 'px';
    selectionBtn.style.top = (y + 4) + 'px';
    selectionBtn.style.display = '';
  }

  function hideButton() {
    if (selectionBtn) selectionBtn.style.display = 'none';
    currentSelection = '';
  }

  function cleanupUI() {
    if (selectionBtn) {
      selectionBtn.remove();
      selectionBtn = null;
    }
    currentSelection = '';
  }

  // ===== 事件监听（只在激活时有效） =====
  const onMouseUp = (e) => {
    if (!isActive) return;
    if (selectionBtn && selectionBtn.contains(e.target)) return;

    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel.toString().trim();
      if (text) {
        currentSelection = text;
        try {
          const range = sel.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          showButton(rect.left + (rect.width / 2), rect.bottom);
        } catch (_) {
          showButton(e.clientX, e.clientY);
        }
      } else {
        hideButton();
      }
    }, 30);
  };

  const onMouseDown = (e) => {
    if (selectionBtn && !selectionBtn.contains(e.target)) {
      hideButton();
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') hideButton();
  };

  function activate() {
    if (isActive) return;
    isActive = true;
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
  }

  function deactivate() {
    if (!isActive) return;
    isActive = false;
    cleanupUI();
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('keydown', onKeyDown);
  }

  // ===== 从 storage 读取初始状态 =====
  async function initFromStorage() {
    try {
      const result = await chrome.storage.local.get(['sidebarSelectionEnabled']);
      if (result.sidebarSelectionEnabled) {
        activate();
      }
    } catch (e) {
      // storage 可能不可用
    }
  }

  // ===== 监听广播消息（边栏切换时触发） =====
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'sidebarSelectionToggle') {
      if (msg.enabled) {
        activate();
      } else {
        deactivate();
      }
    }
  });

  // ===== 初始化 =====
  initFromStorage();
})();
