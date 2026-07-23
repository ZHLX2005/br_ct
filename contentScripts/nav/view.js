/**
 * @fileoverview Shared right-edge nav presentation component.
 *
 * Owns the nav CSS and DOM. It does not query platform message elements,
 * calculate visibility, or perform scrolling.
 *
 * render 采用增量 reconcile：只增/删/移发生变化的 row，不销毁重建，
 * 消除抖动源头。不需要 transform:none 的 hack。
 */

const NAV_ID = 'bro-chat-right-edges-nav';
const STYLE_ID = `${NAV_ID}-style`;
const ROW_CLASS = 'bro-chat-nav__row';
const ITEM_CLASS = 'bro-chat-nav__item';
const LINE_CLASS = 'bro-chat-nav__line';
const HANDLE_CLASS = 'bro-chat-nav__handle';
const HANDLE_BAR_CLASS = 'bro-chat-nav__handle-bar';
const EXPORT_CLASS = 'bro-chat-nav__export';
const COPY_CLASS = 'bro-chat-nav__copy';

const NAV_CSS = `
#${NAV_ID} {
  --bro-chat-nav-text: #0f1115;
  --bro-chat-nav-text-idle: rgba(15,17,21,0.55);
  --bro-chat-nav-bg: #ffffff;
  --bro-chat-nav-border: rgba(15,17,21,0.06);
  --bro-chat-nav-line-color: rgba(15,17,21,0.35);
  --bro-chat-nav-line-active: rgba(0, 60, 179, 0.82);
  position: fixed;
  right: 20px;
  top: 50%;
  /* 禁止文字选中：双击 row 时不会触发文字选择，光标也不会变成 text-cursor */
  -webkit-user-select: none;
  user-select: none;
  /* 创建独立 stacking context，避免被页面自身的 transform/filter/will-change 影响 z-index */
  isolation: isolate;
  z-index: 2147483647;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 0;
  box-shadow: 0 1px 2px transparent, 0 1px 3px transparent;
  padding: 10px 0;
  width: 28px;
  transition: width 0.3s ease, background 0.3s ease,
              border-color 0.3s ease, box-shadow 0.3s ease;
  max-height: 70vh;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  cursor: pointer;
  /* 不用 transform 居中：避免 pointerup 时 transform 恢复导致 nav 跳到中央 */
  /* 初始 top 在 JS 内联设为 (vh - navH) / 2，让 nav 视觉居中 */
}
#${NAV_ID}.is-dragging { cursor: grabbing; }
#${NAV_ID}::-webkit-scrollbar { display: none; }
#${NAV_ID}:hover {
  width: max-content;
  max-width: 360px;
  background: var(--bro-chat-nav-bg);
  border-color: var(--bro-chat-nav-border);
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(15,17,21,0.06), 0 1px 3px rgba(15,17,21,0.1);
}
.${HANDLE_CLASS} {
  width: 16px; height: 6px;
  margin: 0 8px 4px 0;
  border-radius: 3px;
  background: transparent;
  align-self: flex-end;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  align-items: center;
  justify-content: center;
}
.${HANDLE_BAR_CLASS} {
  width: 10px; height: 1.5px;
  border-radius: 1px;
  background: rgba(15,17,21,0.55);
  flex-shrink: 0;
  transition: background 0.2s ease;
}
#${NAV_ID}:hover .${HANDLE_BAR_CLASS} { background: rgba(0, 60, 179, 0.7); }
#${NAV_ID}.is-dragging .${HANDLE_BAR_CLASS} { background: rgba(0, 60, 179, 0.7); }
.${ROW_CLASS} {
  display: flex; align-items: center; gap: 8px;
  padding: 1px 8px 1px 14px;
  color: var(--bro-chat-nav-text-idle);
  transition: color 0.2s ease, background 0.2s ease;
}
.${ROW_CLASS}:hover { color: var(--bro-chat-nav-text); }
/* 双击复制成功反馈：row 背景短暂变绿 */
.${ROW_CLASS}.is-copied {
  color: #16a34a;
  background: rgba(22, 163, 74, 0.1);
  border-radius: 4px;
}
.${LINE_CLASS} {
  display: block; width: 12px; height: 2px;
  background: var(--bro-chat-nav-line-color);
  border-radius: 1px; flex-shrink: 0;
  transition: width 0.3s ease, background 0.2s ease;
}
.${LINE_CLASS}.is-active {
  width: 20px; background: var(--bro-chat-nav-line-active);
}
.${ROW_CLASS}:hover .${LINE_CLASS} { background: rgba(15,17,21,0.7); }
.${ROW_CLASS}:hover .${LINE_CLASS}.is-active { background: var(--bro-chat-nav-line-active); }
.${ITEM_CLASS} {
  font-size: 13px; line-height: 18px;
  color: var(--bro-chat-nav-text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 0; opacity: 0;
  transform: translateX(4px);
  transition: opacity 0.06s ease, transform 0.06s ease, max-width 0.1s ease;
}
#${NAV_ID}:hover .${ITEM_CLASS} {
  max-width: 320px; opacity: 1; transform: translateX(0);
}
.${EXPORT_CLASS} {
  display: none;
  align-items: center;
  gap: 4px;
  padding: 1px 8px 1px 14px;
  font-size: 12px;
  color: var(--bro-chat-nav-text-idle);
  cursor: pointer;
  white-space: nowrap;
}
#${NAV_ID}:hover .${EXPORT_CLASS} {
  display: flex;
}
.${EXPORT_CLASS}:hover {
  color: var(--bro-chat-nav-text);
}
.${COPY_CLASS} {
  display: none;
  align-items: center;
  gap: 4px;
  padding: 1px 8px 1px 0;
  font-size: 12px;
  color: var(--bro-chat-nav-text-idle);
  cursor: pointer;
  white-space: nowrap;
}
#${NAV_ID}:hover .${COPY_CLASS} {
  display: flex;
}
.${COPY_CLASS}:hover {
  color: var(--bro-chat-nav-text);
}
`;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = NAV_CSS;
  document.head.appendChild(style);
}

function createContainer() {
  const nav = document.createElement('div');
  nav.id = NAV_ID;
  // 挂到 documentElement 而非 body：避免 body 被 React/Vue 重建导致 nav 丢失；
  // 同时某些 SPA 的 body 有 transform/filter 会创建新的 containing block 影响 position: fixed 定位
  document.documentElement.appendChild(nav);
  // 计算居中位置并写为 inline style。appendChild 后 offsetHeight 才有效（但此时 nav 还没有 row，高度是 handle+padding ≈ 26px）
  const initialTop = Math.max(0, Math.floor((window.innerHeight - nav.offsetHeight) / 2));
  nav.style.top = `${initialTop}px`;
  const handle = document.createElement('div');
  handle.className = HANDLE_CLASS;
  for (let i = 0; i < 3; i += 1) {
    const bar = document.createElement('span');
    bar.className = HANDLE_BAR_CLASS;
    handle.appendChild(bar);
  }
  nav.appendChild(handle);
  return { nav, handle };
}

/**
 * Create a single nav row DOM element.
 * Click handler uses sibling index to derive the records index.
 */
function createRow({ label, onSelect, onCopyRow }) {
  const item = document.createElement('span');
  item.className = ITEM_CLASS;
  item.textContent = label;

  const line = document.createElement('span');
  line.className = LINE_CLASS;

  const row = document.createElement('div');
  row.className = ROW_CLASS;
  row.title = '单击跳转，双击复制';
  row.appendChild(item);
  row.appendChild(line);

  function getIndex() {
    let idx = 0;
    let cur = row.previousElementSibling;
    while (cur) {
      if (cur.classList.contains(ROW_CLASS)) idx++;
      cur = cur.previousElementSibling;
    }
    return idx;
  }

  row.addEventListener('click', () => {
    onSelect(getIndex());
  });

  // 双击复制该条消息原文。与单击跳转不冲突（dblclick 事件独立触发）
  if (typeof onCopyRow === 'function') {
    row.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const idx = getIndex();
      onCopyRow(idx);
      // 视觉反馈：row 短暂变绿
      row.classList.add('is-copied');
      setTimeout(() => row.classList.remove('is-copied'), 1200);
    });
  }

  return { row, item, line };
}

export function createNavView({ onSelect, onExport, onCopy, onCopyRow }) {
  if (document.getElementById(NAV_ID)) return null;
  injectStyle();
  const { nav, handle } = createContainer();

  // destroy 时调用的清理函数（不能依赖外层 disposer，view.js 不知道 core 的 disposer）
  let destroyCleanup = () => {};

  // Create export button but don't append yet — it goes at the bottom after all rows
  let exportBtn = null;
  const hasExport = typeof onExport === 'function';
  if (hasExport) {
    exportBtn = document.createElement('span');
    exportBtn.className = EXPORT_CLASS;
    exportBtn.textContent = '导出';
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onExport();
    });
  }

  // Create copy button (same row as export, rendered first so it sits on the left)
  let copyBtn = null;
  const hasCopy = typeof onCopy === 'function';
  if (hasCopy) {
    copyBtn = document.createElement('span');
    copyBtn.className = COPY_CLASS;
    copyBtn.textContent = '复制';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onCopy();
    });
  }

  // Vertical drag handler
  let dragState = null;
  nav.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest(`.${ROW_CLASS}`)) return;
    if (event.target.closest(`.${EXPORT_CLASS}`)) return;
    if (event.target.closest(`.${COPY_CLASS}`)) return;
    nav.classList.add('is-dragging');
    nav.setPointerCapture(event.pointerId);
    const rect = nav.getBoundingClientRect();
    // 关闭 transition 让拖动 1:1 跟随鼠标；不需要改 transform（nav 本来就用 top 控制位置）
    nav.style.transition = 'none';
    dragState = { startY: event.clientY, startTop: rect.top };
  });
  nav.addEventListener('pointermove', (event) => {
    if (!dragState) return;
    event.preventDefault();
    const next = dragState.startTop + (event.clientY - dragState.startY);
    const vh = window.innerHeight;
    const navH = nav.offsetHeight;
    // 严格边界保护：
    //   - top >= 0：避免 nav 顶部滑出 viewport（handle 在 nav 顶部 +17px，top>=0 时 handle 在 y=17~23 可见）
    //   - top <= vh - 30：避免 nav 底部滑出，导致用户找不到拖拽点
    //   - 当 nav 比 viewport 还高时（消息很多），允许 nav 完全覆盖 viewport 但 top >= 0
    const minTop = 0;
    const maxTop = Math.max(minTop, vh - 30);
    const clamped = Math.min(Math.max(minTop, next), maxTop);
    nav.style.top = `${clamped}px`;
  });
  const endDrag = (event) => {
    if (!dragState) return;
    if (nav.hasPointerCapture(event.pointerId)) nav.releasePointerCapture(event.pointerId);
    nav.classList.remove('is-dragging');
    nav.style.transition = '';
    // 不动 transform —— nav 永远用 inline top 控制位置
    dragState = null;
  };
  nav.addEventListener('pointerup', endDrag);
  nav.addEventListener('pointercancel', endDrag);

  // 窗口 resize / scroll 后重新把 nav 拉回视口安全区
  // 防止用户把 nav 拖到合理位置后 resize 窗口导致 nav 溢出到屏幕外
  function ensureInViewport() {
    const vh = window.innerHeight;
    const navH = nav.offsetHeight;
    const cur = parseFloat(nav.style.top || '');
    if (Number.isNaN(cur)) return;
    const minTop = 0;
    const maxTop = Math.max(minTop, vh - 30);
    // 兜底：nav 完全离开视口（top + navH < 0 或 top > vh），直接拉回中央
    if (cur + navH < 0 || cur > vh) {
      nav.style.top = `${Math.max(0, (vh - navH) / 2)}px`;
      return;
    }
    const clamped = Math.min(Math.max(minTop, cur), maxTop);
    if (clamped !== cur) nav.style.top = `${clamped}px`;
  }
  window.addEventListener('resize', ensureInViewport);
  // destroy 时清理 resize 监听
  destroyCleanup = () => window.removeEventListener('resize', ensureInViewport);

  // ---- 增量 reconcile ----

  function clear() {
    // Remove all rows, keep only handle
    while (nav.children.length > 1) nav.removeChild(nav.lastChild);
    // Re-append copy + export buttons at the bottom
    if (hasCopy) nav.appendChild(copyBtn);
    if (hasExport) nav.appendChild(exportBtn);
  }

  function render(labels) {
    // Remove copy + export buttons temporarily for clean row reconciliation
    if (hasCopy && copyBtn.parentNode) nav.removeChild(copyBtn);
    if (hasExport && exportBtn.parentNode) nav.removeChild(exportBtn);

    // 1) 移除多余 row（新列表比当前短）
    while (nav.children.length - 1 > labels.length) {
      nav.removeChild(nav.lastChild);
    }

    // 2) 更新前 N 行文本
    const count = Math.min(nav.children.length - 1, labels.length);
    for (let i = 0; i < count; i++) {
      const row = nav.children[i + 1]; // +1 跳过 handle
      const item = row.querySelector(`.${ITEM_CLASS}`);
      if (item.textContent !== labels[i]) {
        item.textContent = labels[i];
      }
    }

    // 3) 追加新行
    for (let i = nav.children.length - 1; i < labels.length; i++) {
      const { row, item, line } = createRow({ label: labels[i], onSelect, onCopyRow });
      nav.appendChild(row);
    }

    // Append copy + export buttons at the bottom after all rows
    if (hasCopy) nav.appendChild(copyBtn);
    if (hasExport) nav.appendChild(exportBtn);
  }

  function setActive(activeIdx) {
    let currentIdx = 0;
    for (let i = 1; i < nav.children.length; i++) {
      const line = nav.children[i].querySelector(`.${LINE_CLASS}`);
      if (line) {
        line.classList.toggle('is-active', currentIdx === activeIdx);
        currentIdx++;
      }
    }
  }

  function destroy() {
    const style = document.getElementById(STYLE_ID);
    if (style) style.remove();
    const navEl = document.getElementById(NAV_ID);
    if (navEl) navEl.remove();
    destroyCleanup();
  }

  return { render, setActive, clear, destroy };
}
