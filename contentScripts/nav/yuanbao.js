/**
 * @fileoverview
 * 元宝 (Yuanbao / yuanbao.tencent.com) 右侧对话快速导航
 *
 * 选择器（与 preview.html 视觉一致）：
 * - ITEM_SEL: .agent-chat__list__item--human （每条用户消息）
 * - LIST_SEL: .agent-chat__list            （整个消息列表，触发 MutationObserver）
 * - TEXT_SEL: .hyc-content-text            （用户消息文本节点）
 *
 * 视觉行为：
 * - 始终显示 6 条 nav-line（right 12/20px，紧贴容器 right 4px）
 * - idle 完全透明容器；hover 浮出白底圆角
 * - hover 行：该行 line 颜色加深 + item 淡入（0.8s ease）
 * - nav-line 永远在右，不随 hover 位置变化
 *
 * 自动注入时机：与 yuanbao.js 一起通过 platformScriptFiles.js 注入
 * 不依赖 popup 按钮触发 —— 一进元宝 tab 立即生效
 */

const NAV_ID = 'yuanbao-right-edges-nav';
const ITEM_SEL = '.agent-chat__list__item--human';
const LIST_SEL = '.agent-chat__list';
const TEXT_SEL = '.hyc-content-text';

(function () {
  if (document.getElementById(NAV_ID)) return;

  // 注入 stylesheet（参考 preview.html 最终版）
  const STYLE_ID = NAV_ID + '-style';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
:root {
  --yb-text: #0f1115;
  --yb-text-idle: rgba(15,17,21,0.55);
  --yb-bg: #ffffff;
  --yb-bubble-bg: #edf3fe;
  --yb-border: rgba(15,17,21,0.06);
  --yb-line-color: rgba(15,17,21,0.35);
  --yb-line-active: rgba(0, 60, 179, 0.82);
}

/* ===== container ===== */
.${NAV_ID} {
  position: fixed;
  right: 20px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 0;
  box-shadow: 0 1px 2px transparent, 0 1px 3px transparent;
  padding: 16px 0;
  width: 28px;
  transition: width 0.3s ease, background 0.3s ease,
              border-color 0.3s ease, box-shadow 0.3s ease;
  overflow: hidden;
  display: flex; flex-direction: column; align-items: flex-end;
  gap: 10px;
  z-index: 2147483647;
}
.${NAV_ID}:hover {
  width: max-content;
  max-width: 360px;
  background: var(--yb-bg);
  border-color: var(--yb-border);
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(15,17,21,0.06), 0 1px 3px rgba(15,17,21,0.1);
}

/* ===== row ===== */
.${NAV_ID}-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px 6px 14px;
  color: var(--yb-text-idle);
  transition: color 0.2s ease;
}
.${NAV_ID}-row:hover { color: var(--yb-text); }

/* ===== line (始终显示) ===== */
.${NAV_ID}-line {
  display: block;
  width: 12px;
  height: 4px;
  background: var(--yb-line-color);
  border-radius: 2px;
  flex-shrink: 0;
  transition: width 0.3s ease, background 0.2s ease;
}
.${NAV_ID}-line.is-active {
  width: 20px;
  background: var(--yb-line-active);
}
.${NAV_ID}-row:hover .${NAV_ID}-line {
  background: rgba(15,17,21,0.7);
}
.${NAV_ID}-row:hover .${NAV_ID}-line.is-active {
  background: rgba(0, 50, 160, 0.95);
}

/* ===== item (hover 时淡入) ===== */
.${NAV_ID}-item {
  font-size: 13px;
  line-height: 18px;
  color: var(--yb-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 0;
  opacity: 0;
  transform: translateX(4px);
  transition: opacity 0.8s ease, transform 0.8s ease, max-width 0.8s ease;
}
.${NAV_ID}:hover .${NAV_ID}-item {
  max-width: 320px;
  opacity: 1;
  transform: translateX(0);
}
`;
    document.head.appendChild(style);
  }

  // 创建 nav 容器
  const nav = document.createElement('div');
  nav.id = NAV_ID;
  nav.className = NAV_ID;     // CSS 用 .yuanbao-right-edges-nav class 选择器
  document.body.appendChild(nav);

  // 跟踪 human-message → row 映射，用于 IntersectionObserver 同步 active 状态
  const messageRows = []; // [{ el: HTMLElement, row: HTMLElement, line: HTMLElement }]

  // 用户点击 row 期间锁定 active（避免 evaluateActiveByViewport 立刻夺回高亮）
  let clickLockUntil = 0;

  /**
   * 标记指定 index 的 row 为 active（蓝色加长）
   * @param {number} activeIndex
   */
  function setActiveLine(activeIndex) {
    messageRows.forEach((rec, i) => {
      const isActive = i === activeIndex;
      rec.line.classList.toggle('is-active', isActive);
    });
  }

  function build() {
    // 清空重建（DOM 变化时由 MutationObserver 触发）
    nav.innerHTML = '';
    messageRows.length = 0;

    const items = document.querySelectorAll(ITEM_SEL);
    items.forEach((el, idx) => {
      const text = el.querySelector(TEXT_SEL)?.innerText?.trim();
      if (!text) return;

      const row = document.createElement('div');
      row.className = `${NAV_ID}-row`;

      const item = document.createElement('span');
      item.className = `${NAV_ID}-item`;
      item.textContent = text;

      const line = document.createElement('span');
      line.className = `${NAV_ID}-line`;

      messageRows.push({ el, row, line });

      // 单击 row：滚动到对应 message，主动锁定 active 直到滚动稳定
      row.addEventListener('click', () => {
        setActiveLine(idx);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // 锁定 800ms，期间 evaluateActiveByViewport 直接 return（不改 active）
        clickLockUntil = Date.now() + 800;
      });

      row.appendChild(item);
      row.appendChild(line);
      nav.appendChild(row);
    });
    // 初始默认 active：最后一条（最新用户消息）
    if (messageRows.length > 0) {
      setActiveLine(messageRows.length - 1);
      observeMessagesInViewport();
      // 用户手动滚动时也重新评估（IntersectionObserver 在大滚动时可能滞后）
      const onScroll = () => {
        // 滚动后解除锁（让视口接管），并触发一次评估
        clickLockUntil = 0;
        evaluateActiveByViewport();
      };
      window.addEventListener('scroll', onScroll, { passive: true });
    }
  }

  /**
   * 用 IntersectionObserver 找出视口中可见的 human-message
   * 取可见度最高的那条作为 active
   * @param {boolean} locked - 若为 true 则跳过（用户点击触发的滚动期间）
   */
  function evaluateActiveByViewport() {
    // 用户点击 row 触发的滚动期间，保留点击项的 active，不被 IntersectionObserver 抢走
    if (Date.now() < clickLockUntil) return;
    if (messageRows.length === 0) return;

    let bestIndex = -1;
    let bestRatio = 0;
    messageRows.forEach((rec, i) => {
      const rect = rec.el.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      // 计算 message 在视口中的可见高度
      const visible = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
      const ratio = visible / Math.max(rect.height, 1);
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestIndex = i;
      }
    });

    // 视口里没一条 ≥30% 可见时（滚到空白处），保留当前 active 不变
    if (bestIndex < 0 || bestRatio < 0.3) return;
    setActiveLine(bestIndex);
  }

  /**
   * 全局滚动监听：视口里看到哪条 message 高亮对应的 nav-line
   * IntersectionObserver 监听每条 human-message，触发 evaluate。
   */
  function observeMessagesInViewport() {
    if (!('IntersectionObserver' in window)) return;

    const visibleObs = new IntersectionObserver(
      () => { evaluateActiveByViewport(); },
      {
        root: null,
        rootMargin: '-30% 0px -30% 0px', // 中间 40% 视区视为"激活带"
        threshold: [0, 0.25, 0.5, 0.75, 1],
      }
    );

    messageRows.forEach((rec) => visibleObs.observe(rec.el));
  }

  // 初始构建 + 监听消息列表变化
  const list = document.querySelector(LIST_SEL);
  if (list) {
    const ob = new MutationObserver(build);
    ob.observe(list, { childList: true, subtree: true });
    build();
  } else {
    // 如果列表还没出现，延迟重试
    let retries = 0;
    const retryInterval = setInterval(() => {
      const l = document.querySelector(LIST_SEL);
      if (l) {
        clearInterval(retryInterval);
        const ob = new MutationObserver(build);
        ob.observe(l, { childList: true, subtree: true });
        build();
      } else if (++retries > 30) {
        // 30 次 × 300ms = 9 秒后放弃
        clearInterval(retryInterval);
      }
    }, 300);
  }
})();
