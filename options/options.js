/**
 * 选项页面主入口
 * 负责侧边栏导航和子页面加载
 */

const STORAGE_KEYS = {
  selectedTab: 'optionsSelectedTab',
  sidebarCollapsed: 'optionsSidebarCollapsed',
  focusMode: 'optionsFocusMode',
  quadLauncherVisible: 'optionsQuadLauncherVisible',
};

const switcherState = {
  open: false,
  selectedIndex: 0,
  lastFocusedElement: null,
  closeTimer: null,
};

let currentFrameEl = null;
let incomingFrameEl = null;
let isFrameTransitioning = false;

function getCurrentFrame() {
  return currentFrameEl || document.getElementById('content-frame');
}

function getIncomingFrame() {
  return incomingFrameEl || document.getElementById('incoming-frame');
}

function syncCurrentFrameGlobals() {
  currentFrameEl = document.getElementById('content-frame');
  incomingFrameEl = document.getElementById('incoming-frame');
}

// 导航项配置
const NAV_ITEMS = [
  { icon: 'PL', name: '平台显示', page: 'platform/index.html' },
  { icon: 'API', name: 'API 配置', page: 'api/index.html' },
  { icon: 'DB', name: '存储管理', page: 'storage/index.html' },
  { icon: 'NT', name: '随手笔记', page: 'notes/index.html' },
  { icon: 'OC', name: 'OCR 批量识别', page: 'ocr/index.html' },
  { icon: 'TM', name: '倒计时面板', page: 'countdown/index.html' },
  { icon: 'PR', name: '提示词编辑', page: 'prompts_editor/prompts_editor.html' },
  { icon: 'CMD', name: '本地命令管理', page: 'local_cmd/index.html' },
];

/**
 * 初始化选项页面
 */
function initializeOptions() {
  syncCurrentFrameGlobals();

  const frame = getCurrentFrame();
  const navItems = document.querySelectorAll('.nav-item');
  const collapseBtn = document.getElementById('sidebar-collapse-btn');
  const focusBtn = document.getElementById('focus-btn');
  const quadToggleBtn = document.getElementById('quad-toggle-btn');

  // 恢复侧边栏状态
  chrome.storage.local.get([STORAGE_KEYS.sidebarCollapsed], (result) => {
    if (result[STORAGE_KEYS.sidebarCollapsed]) {
      document.querySelector('.app-container').classList.add('sidebar-collapsed');
    }
  });

  // 恢复专注模式状态
  chrome.storage.local.get([STORAGE_KEYS.focusMode], (result) => {
    if (result[STORAGE_KEYS.focusMode]) {
      document.querySelector('.app-container').classList.add('focus-mode');
    }
  });

  // 恢复上次选中的 tab
  chrome.storage.local.get([STORAGE_KEYS.quadLauncherVisible], (result) => {
    const isVisible = result[STORAGE_KEYS.quadLauncherVisible] !== false;
    setQuadLauncherVisible(isVisible);
  });

  chrome.storage.local.get([STORAGE_KEYS.selectedTab], (result) => {
    const savedTab = result[STORAGE_KEYS.selectedTab];
    if (savedTab && document.querySelector(`[data-page="${savedTab}"]`)) {
      frame.src = savedTab;
      updateNavActive(savedTab);
      return;
    }

    // 默认加载第一个 tab
    if (navItems.length > 0) {
      const defaultPage = navItems[0].getAttribute('data-page');
      if (defaultPage) {
        frame.src = defaultPage;
        updateNavActive(defaultPage);
      }
    }
  });

  // 监听导航点击事件
  navItems.forEach((item) => {
    item.addEventListener('click', () => {
      const page = item.getAttribute('data-page');
      if (!page) return;
      navigateToPage(page);
    });
  });

  /**
   * 计算当前 iframe 的 origin。
   * - 用于校验 message 来源（event.origin）
   * - 用于 postMessage 的 targetOrigin（禁止使用 '*')
   */
  function getFrameOriginSafe() {
    try {
      const frame = getCurrentFrame();
      const src = frame?.src;
      if (!src) return null;

      const url = new URL(src, window.location.href);
      return url.origin;
    } catch {
      return null;
    }
  }

  const log = (...args) => console.log('[Options FocusScroll Parent]', ...args);

  // 监听来自 iframe 的消息
  window.addEventListener('message', (event) => {
    const activeFrame = getCurrentFrame();

    // normalize data
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    // only handle messages from current iframe + expected origin
    const frameOrigin = getFrameOriginSafe();
    if (!frameOrigin) return;
    if (event.source !== activeFrame?.contentWindow) return;
    if (event.origin !== frameOrigin) return;

    // During 2-iframe transition, ignore all iframe messages.
    if (isFrameTransitioning) return;

    // focus-mode wheel navigation
    if (data.action === 'focusScrollNavigate') {
      log('recv focusScrollNavigate', {
        direction: data.direction,
        isFocusMode: isFocusMode(),
        frameSrc: activeFrame?.src,
        origin: event.origin,
        transitioning: isFrameTransitioning,
      });

      if (!isFocusMode()) return;
      const { direction } = data;
      handleFocusScrollNavigate(direction);
      return;
    }

    // countdown panel navigation
    if (data.action === 'navigateToHistory') {
      navigateToPage('countdown/history.html');
      updateNavActive('countdown/index.html');
    } else if (data.action === 'navigateToTimers') {
      navigateToPage('countdown/index.html');
      updateNavActive('countdown/index.html');
    } else if (data.action === 'refreshTimers') {
      const currentSrc = activeFrame?.src || '';
      if (currentSrc.includes('countdown/index.html')) {
        activeFrame.contentWindow.postMessage({ action: 'refresh' }, frameOrigin);
      }
    }
  });

  // 侧边栏折叠按钮
  collapseBtn.addEventListener('click', () => {
    const appContainer = document.querySelector('.app-container');
    appContainer.classList.remove('focus-mode');
    const isCollapsed = appContainer.classList.toggle('sidebar-collapsed');
    chrome.storage.local.set({ [STORAGE_KEYS.sidebarCollapsed]: isCollapsed });
    chrome.storage.local.set({ [STORAGE_KEYS.focusMode]: false });
  });

  // 专注模式按钮
  focusBtn.addEventListener('click', toggleFocusMode);

  // 固定标签页按钮
  const pinBtn = document.getElementById('pin-btn');
  pinBtn.addEventListener('click', togglePinTab);
  // 初始化固定状态
  chrome.tabs.getCurrent((tab) => {
    if (tab && tab.pinned) {
      pinBtn.classList.add('pinned');
    }
  });

  // 初始化悬浮圆环导航
  initNavRing();

  // 初始化 Win+Tab 风格切换器
  initSwitcher();
  quadToggleBtn?.addEventListener('click', () => {
    const launcher = document.getElementById('quad-launcher');
    const willShow = launcher?.classList.contains('is-hidden');
    setQuadLauncherVisible(Boolean(willShow));
    chrome.storage.local.set({ [STORAGE_KEYS.quadLauncherVisible]: Boolean(willShow) });
  });
}

/**
 * 初始化悬浮点导航
 */
function initNavRing() {
  const container = document.getElementById('dot-nav');
  const itemsContainer = document.getElementById('dot-nav-items');

  // 第一个导航项为退出按钮（专注模式下显示）
  const exitItem = document.createElement('div');
  exitItem.className = 'dot-nav-item';
  exitItem.id = 'dot-nav-exit';
  exitItem.innerHTML = `
    <span class="dot-nav-item-icon">X</span>
    <span class="dot-nav-item-label">退出专注</span>
  `;

  exitItem.addEventListener('click', () => {
    if (isFocusMode()) {
      toggleFocusMode();
    }
  });

  itemsContainer.appendChild(exitItem);

  // 创建导航项
  NAV_ITEMS.forEach((item) => {
    const navItem = document.createElement('div');
    navItem.className = 'dot-nav-item';
    navItem.dataset.page = item.page;
    navItem.innerHTML = `
      <span class="dot-nav-item-icon">${item.icon}</span>
      <span class="dot-nav-item-label">${item.name}</span>
    `;

    navItem.addEventListener('click', () => {
      navigateToPage(item.page);
    });

    itemsContainer.appendChild(navItem);
  });

  // 更新显示状态
  updateNavRingActive();
}

/**
 * 检查是否处于专注模式
 */
function isFocusMode() {
  const appContainer = document.querySelector('.app-container');
  return appContainer.classList.contains('focus-mode');
}

/**
 * 获取当前 iframe 的 targetOrigin（禁止使用 '*'）
 */
function getFrameTargetOrigin(frameEl) {
  const frame = frameEl || getCurrentFrame();
  try {
    const src = frame?.src;
    if (!src) return null;
    return new URL(src, window.location.href).origin;
  } catch {
    // ignore
  }
  return null;
}

/**
 * 获取指定 page 在 NAV_ITEMS 中的索引
 */
function getNavIndexByPage(page) {
  return NAV_ITEMS.findIndex(item => item.page === page);
}

/**
 * 根据方向（up/down）循环获取目标页面
 */
function getCyclicPageByDirection(direction) {
  const currentPage = getCurrentPage();
  const total = NAV_ITEMS.length;
  if (!total) return null;

  let currentIndex = getNavIndexByPage(currentPage);
  if (currentIndex === -1) currentIndex = 0;

  const delta = direction === 'prev' ? -1 : 1;
  const nextIndex = (currentIndex + delta + total) % total;
  return NAV_ITEMS[nextIndex].page;
}

/**
 * 将导航方向映射为滚动吸附边界。
 */
function getScrollEdgeByDirection(direction) {
  return direction === 'prev' ? 'bottom' : 'top';
}

/**
 * 专注模式滚轮边缘导航：页面切换 + 进入目标页后滚动到边缘
 */
function waitTransitionOnce(el) {
  return new Promise((resolve) => {
    const onEnd = (e) => {
      if (e && e.target !== el) return;
      el.removeEventListener('transitionend', onEnd);
      resolve();
    };
    el.addEventListener('transitionend', onEnd);
  });
}

function setFrameTransform(frameEl, translateY) {
  frameEl.style.transform = `translate3d(0, ${translateY}px, 0)`;
}

function setFrameTransformImmediately(frameEl, translateY) {
  if (!frameEl) return;
  const prevTransition = frameEl.style.transition;
  frameEl.style.transition = 'none';
  setFrameTransform(frameEl, translateY);

  // Flush styles so the next transform change uses the restored transition.
  void frameEl.offsetHeight;

  frameEl.style.transition = prevTransition;
}

function parseTimeToMs(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  if (raw.endsWith('ms')) return Number.parseFloat(raw) || 0;
  if (raw.endsWith('s')) return (Number.parseFloat(raw) || 0) * 1000;
  return Number.parseFloat(raw) || 0;
}

function getTransitionTimeoutMs(frameEl) {
  if (!frameEl) return 0;

  const style = window.getComputedStyle(frameEl);
  const durations = style.transitionDuration.split(',').map(parseTimeToMs);
  const delays = style.transitionDelay.split(',').map(parseTimeToMs);
  const count = Math.max(durations.length, delays.length);

  let maxMs = 0;
  for (let i = 0; i < count; i += 1) {
    const duration = durations[i] ?? durations[durations.length - 1] ?? 0;
    const delay = delays[i] ?? delays[delays.length - 1] ?? 0;
    maxMs = Math.max(maxMs, duration + delay);
  }

  return maxMs;
}

function waitForFrameTransition(frameEl) {
  const transitionMs = getTransitionTimeoutMs(frameEl);
  if (transitionMs <= 0) return Promise.resolve();

  return Promise.race([
    waitTransitionOnce(frameEl),
    new Promise((resolve) => setTimeout(resolve, transitionMs + 80)),
  ]);
}

function waitForIframeLoad(frameEl) {
  return new Promise((resolve) => {
    const onLoad = () => {
      frameEl.removeEventListener('load', onLoad);
      resolve();
    };
    frameEl.addEventListener('load', onLoad);
  });
}

function getFrameScrollTop(frameEl) {
  try {
    const doc = frameEl?.contentDocument;
    const root = doc?.scrollingElement || doc?.documentElement;
    return Number(root?.scrollTop || 0);
  } catch {
    return 0;
  }
}

function syncFormState(sourceDoc, cloneDoc) {
  const sourceFields = sourceDoc.querySelectorAll('input, textarea, select');
  const cloneFields = cloneDoc.querySelectorAll('input, textarea, select');

  sourceFields.forEach((field, index) => {
    const cloneField = cloneFields[index];
    if (!cloneField) return;

    if (field instanceof HTMLTextAreaElement) {
      cloneField.textContent = field.value;
      return;
    }

    if (field instanceof HTMLSelectElement) {
      Array.from(cloneField.options).forEach((option, optionIndex) => {
        option.selected = field.options[optionIndex]?.selected || false;
      });
      return;
    }

    if (field instanceof HTMLInputElement) {
      cloneField.setAttribute('value', field.value);
      cloneField.value = field.value;
      if (field.checked) cloneField.setAttribute('checked', '');
      else cloneField.removeAttribute('checked');
    }
  });
}

function buildSnapshotSrcdoc(frameEl) {
  try {
    const sourceDoc = frameEl?.contentDocument;
    if (!sourceDoc?.documentElement) return null;

    const clonedRoot = sourceDoc.documentElement.cloneNode(true);
    clonedRoot.querySelectorAll('script').forEach((node) => node.remove());
    syncFormState(sourceDoc, clonedRoot);

    const head = clonedRoot.querySelector('head');
    if (!head) return null;

    const base = sourceDoc.createElement('base');
    base.href = sourceDoc.location.href;
    head.prepend(base);

    const snapshotStyle = sourceDoc.createElement('style');
    snapshotStyle.textContent = `
      html, body {
        overflow: hidden !important;
        scrollbar-width: none !important;
      }
      body::-webkit-scrollbar {
        display: none !important;
      }
      * {
        pointer-events: none !important;
        animation-play-state: paused !important;
        caret-color: transparent !important;
      }
    `;
    head.appendChild(snapshotStyle);

    const doctype = sourceDoc.doctype
      ? `<!DOCTYPE ${sourceDoc.doctype.name}>`
      : '<!DOCTYPE html>';

    return `${doctype}\n${clonedRoot.outerHTML}`;
  } catch (error) {
    console.warn('[Options FocusScroll Parent] buildSnapshotSrcdoc failed', error);
    return null;
  }
}

async function prepareSnapshotFrame(snapshotFrame, sourceFrame) {
  const srcdoc = buildSnapshotSrcdoc(sourceFrame);
  if (!srcdoc) return false;

  const scrollTop = getFrameScrollTop(sourceFrame);

  snapshotFrame.classList.add('snapshot-active');
  snapshotFrame.setAttribute('aria-hidden', 'false');
  snapshotFrame.style.pointerEvents = 'none';
  setFrameTransformImmediately(snapshotFrame, 0);

  const loaded = waitForIframeLoad(snapshotFrame);
  snapshotFrame.srcdoc = srcdoc;
  await loaded;

  try {
    snapshotFrame.contentWindow?.scrollTo(0, scrollTop);
  } catch {
    // ignore
  }

  return true;
}

function resetSnapshotFrame(snapshotFrame) {
  if (!snapshotFrame) return;

  snapshotFrame.classList.remove('snapshot-active');
  snapshotFrame.setAttribute('aria-hidden', 'true');
  snapshotFrame.style.pointerEvents = 'none';
  setFrameTransformImmediately(snapshotFrame, 0);
  snapshotFrame.srcdoc = '<!DOCTYPE html><html><head></head><body></body></html>';
}

function handleFocusScrollNavigate(direction) {
  if (isFrameTransitioning) return;

  const currentFrame = getCurrentFrame();
  const incomingFrame = getIncomingFrame();

  const targetPage = getCyclicPageByDirection(direction);
  if (!targetPage) {
    console.log('[Options FocusScroll Parent] no target page for direction', direction);
    return;
  }

  const edge = getScrollEdgeByDirection(direction);
  const viewportH = Math.max(
    1,
    document.querySelector('.main-content')?.clientHeight || window.innerHeight
  );
  const fromY = direction === 'next' ? viewportH : -viewportH;

  console.log('[Options FocusScroll Parent] navigate (animated)', {
    direction,
    targetPage,
    edge,
    currentPage: getCurrentPage(),
    viewportH,
    fromY,
  });

  // 非专注模式：保持原先直接切换
  if (!isFocusMode()) {
    navigateToPage(targetPage);
    return;
  }

  isFrameTransitioning = true;

  // 1) 预置 incoming
  incomingFrame.setAttribute('aria-hidden', 'false');
  incomingFrame.style.pointerEvents = 'none';
  incomingFrame.src = targetPage;

  // 先放到屏幕外
  setFrameTransformImmediately(incomingFrame, fromY);
  setFrameTransformImmediately(currentFrame, 0);

  const incomingLoad = () => {
    incomingFrame.removeEventListener('load', incomingLoad);

    // Pre-scroll while the iframe is still offscreen to avoid visible top->bottom flash on prev.
    const incomingOrigin = getFrameTargetOrigin(incomingFrame);
    if (incomingOrigin) {
      try {
        incomingFrame.contentWindow.postMessage(
          { action: 'scrollToEdge', edge },
          incomingOrigin
        );
      } catch {
        // ignore
      }
    }

    // 2) 下一帧 loaded 后开始动画（给 scrollToEdge 一帧时间生效）
    requestAnimationFrame(() => {
      requestAnimationFrame(async () => {
        setFrameTransform(currentFrame, -fromY);
        setFrameTransform(incomingFrame, 0);
        await waitForFrameTransition(incomingFrame);

        // 3) 动画结束：交换角色
        const oldCurrent = currentFrameEl;
        currentFrameEl = incomingFrame;
        incomingFrameEl = oldCurrent;

        currentFrameEl.classList.remove('incoming-frame');
        currentFrameEl.classList.add('current-frame');
        currentFrameEl.style.pointerEvents = 'auto';

        incomingFrameEl.classList.remove('current-frame');
        incomingFrameEl.classList.add('incoming-frame');
        incomingFrameEl.setAttribute('aria-hidden', 'true');
        incomingFrameEl.style.pointerEvents = 'none';

        // Keep the outgoing page offscreen so it never covers the new current frame.
        // It will be moved again on the next transition.

        // 4) 进入目标页后滚动到边缘
        const frameOrigin = getFrameTargetOrigin(currentFrameEl);
        console.log('[Options FocusScroll Parent] target loaded (animated)', {
          targetPage,
          frameOrigin,
        });
        if (frameOrigin) {
          currentFrameEl.contentWindow.postMessage(
            { action: 'scrollToEdge', edge },
            frameOrigin
          );
        }

        // keep id stable for other code paths
        if (currentFrameEl.id !== 'content-frame') currentFrameEl.id = 'content-frame';
        if (incomingFrameEl.id !== 'incoming-frame') incomingFrameEl.id = 'incoming-frame';

        // 5) 更新 UI 状态
        chrome.storage.local.set({ [STORAGE_KEYS.selectedTab]: targetPage });
        updateNavRingActive();

        isFrameTransitioning = false;
      });
    });
  };

  incomingFrame.addEventListener('load', incomingLoad);
}

/**
 * 更新点导航的显示状态
 */
async function handleFocusScrollNavigate(direction) {
  if (isFrameTransitioning) return;

  const currentFrame = getCurrentFrame();
  const snapshotFrame = getIncomingFrame();

  const targetPage = getCyclicPageByDirection(direction);
  if (!targetPage) {
    console.log('[Options FocusScroll Parent] no target page for direction', direction);
    return;
  }

  const edge = getScrollEdgeByDirection(direction);
  const viewportH = Math.max(
    1,
    document.querySelector('.main-content')?.clientHeight || window.innerHeight
  );
  const fromY = direction === 'next' ? viewportH : -viewportH;

  console.log('[Options FocusScroll Parent] navigate (snapshot)', {
    direction,
    targetPage,
    edge,
    currentPage: getCurrentPage(),
    viewportH,
    fromY,
  });

  if (!isFocusMode()) {
    navigateToPage(targetPage);
    return;
  }

  isFrameTransitioning = true;

  try {
    await prepareSnapshotFrame(snapshotFrame, currentFrame);

    currentFrame.style.pointerEvents = 'none';
    currentFrame.style.visibility = 'hidden';

    const currentLoad = waitForIframeLoad(currentFrame);
    currentFrame.src = targetPage;
    await currentLoad;

    const frameOrigin = getFrameTargetOrigin(currentFrame);
    if (frameOrigin) {
      try {
        currentFrame.contentWindow.postMessage(
          { action: 'scrollToEdge', edge },
          frameOrigin
        );
      } catch {
        // ignore
      }
    }

    setFrameTransformImmediately(currentFrame, fromY);
    currentFrame.style.visibility = 'visible';

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setFrameTransform(snapshotFrame, -fromY);
        setFrameTransform(currentFrame, 0);
      });
    });

    await waitForFrameTransition(currentFrame);

    resetSnapshotFrame(snapshotFrame);
    currentFrame.style.pointerEvents = 'auto';

    chrome.storage.local.set({ [STORAGE_KEYS.selectedTab]: targetPage });
    updateNavRingActive();
  } catch (error) {
    console.error('[Options FocusScroll Parent] snapshot transition failed', error);
    resetSnapshotFrame(snapshotFrame);
    currentFrame.style.visibility = 'visible';
    currentFrame.style.pointerEvents = 'auto';
    setFrameTransformImmediately(currentFrame, 0);
    currentFrame.src = targetPage;
    chrome.storage.local.set({ [STORAGE_KEYS.selectedTab]: targetPage });
    updateNavRingActive();
  } finally {
    isFrameTransitioning = false;
  }
}

function updateNavRingActive() {
  const container = document.getElementById('dot-nav');
  const exitItem = document.getElementById('dot-nav-exit');
  const items = document.querySelectorAll('.dot-nav-item');
  const dots = document.querySelectorAll('.dot-nav-dots .dot');
  const currentPage = getCurrentPage();
  const currentIndex = getNavIndexByPage(currentPage);

  // 专注模式下显示退出按钮
  if (isFocusMode()) {
    exitItem.style.display = 'flex';
  } else {
    exitItem.style.display = 'none';
  }

  // 更新选中状态
  items.forEach(item => {
    item.classList.remove('active');
    if (item.dataset.page === currentPage) {
      item.classList.add('active');
    }
  });

  // 更新右侧圆点状态
  dots.forEach(dot => dot.classList.remove('active'));
  if (currentIndex >= 0 && currentIndex < dots.length) {
    dots[currentIndex].classList.add('active');
  }
}

/**
 * 切换专注模式
 */
function toggleFocusMode() {
  const appContainer = document.querySelector('.app-container');
  const isFocus = appContainer.classList.toggle('focus-mode');

  if (isFocus) {
    appContainer.classList.remove('sidebar-collapsed');
  }

  chrome.storage.local.set({ [STORAGE_KEYS.focusMode]: isFocus });
  updateNavRingActive();
}

/**
 * 获取当前页面路径
 */
function getCurrentPage() {
  const frame = getCurrentFrame();
  if (!frame?.src) return NAV_ITEMS[0].page;

  try {
    const url = new URL(frame.src);
    const pathParts = url.pathname.split('/');
    const optionsIndex = pathParts.indexOf('options');
    if (optionsIndex !== -1) {
      return pathParts.slice(optionsIndex + 1).join('/');
    }
    return pathParts[pathParts.length - 1];
  } catch {
    return NAV_ITEMS[0].page;
  }
}

/**
 * 导航到指定页面
 */
function navigateToPage(page) {
  ensureFramesForDirectNav(page);

  const frame = getCurrentFrame();
  const sidebarNavItems = document.querySelectorAll('.sidebar-nav .nav-item');

  // 更新 iframe
  frame.src = page;

  // 更新侧边栏激活状态
  sidebarNavItems.forEach(nav => {
    nav.classList.remove('active');
    if (nav.getAttribute('data-page') === page) {
      nav.classList.add('active');
    }
  });

  // 保存当前 tab
  chrome.storage.local.set({ [STORAGE_KEYS.selectedTab]: page });

  // 更新圆环导航的选中状态
  updateNavRingActive();
}

/**
 * 更新导航激活状态并保存
 */
function updateNavActive(page) {
  const navItems = document.querySelectorAll('.nav-item');
  const targetNav = document.querySelector(`[data-page="${page}"]`);
  if (targetNav) {
    navItems.forEach(nav => nav.classList.remove('active'));
    targetNav.classList.add('active');
    chrome.storage.local.set({ [STORAGE_KEYS.selectedTab]: page });
  }
  updateNavRingActive();
}

function ensureFramesForDirectNav(targetPage) {
  const currentFrame = getCurrentFrame();
  const incomingFrame = getIncomingFrame();
  if (!currentFrame || !incomingFrame) return;


  // If we already swapped frames, the "content-frame" id might not be on current.
  // Keep ids stable so other code (and CSS) remain predictable.
  if (currentFrame.id !== 'content-frame') {
    currentFrame.id = 'content-frame';
  }
  if (incomingFrame.id !== 'incoming-frame') {
    incomingFrame.id = 'incoming-frame';
  }

  // Always keep incoming hidden for direct nav.
  resetSnapshotFrame(incomingFrame);
}

/**
 * 初始化 Win+Tab 风格菜单切换器
 */
function initSwitcher() {
  const launcher = document.getElementById('quad-launcher');
  const overlay = document.getElementById('switcher-overlay');
  const grid = document.getElementById('switcher-grid');

  if (!launcher || !overlay || !grid) return;

  // 初始化网格卡片
  renderSwitcherGrid(grid);

  // 打开切换器
  launcher.addEventListener('click', () => {
    openSwitcher();
  });

  // 关闭切换器（点击遮罩）
  overlay.addEventListener('click', (e) => {
    if (e.target.hasAttribute('data-switcher-close')) {
      closeSwitcher();
    }
  });

  // 键盘导航
  document.addEventListener('keydown', handleSwitcherKeydown);

  // 快捷键 Ctrl+Alt+E 打开切换器
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.altKey && (e.key === 'E' || e.key === 'e')) {
      e.preventDefault();
      if (switcherState.open) {
        closeSwitcher();
      } else {
        openSwitcher();
      }
    }
  });
}

/**
 * 渲染切换器网格
 */
function renderSwitcherGrid(grid) {
  grid.innerHTML = '';

  NAV_ITEMS.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'switcher-card';
    card.dataset.page = item.page;
    card.dataset.index = index;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', item.name);

    // 为每个卡片添加 staggered delay，实现逐个出现的动画
    card.style.transitionDelay = `${index * 50}ms`;

    // 顶部标题栏
    const topbar = document.createElement('div');
    topbar.className = 'switcher-card-topbar';
    topbar.innerHTML = `
      <span class="switcher-card-icon">${item.icon}</span>
      <span class="switcher-card-title">${item.name}</span>
    `;

    // iframe 容器
    const thumb = document.createElement('div');
    thumb.className = 'switcher-card-thumb';

    const iframe = document.createElement('iframe');
    iframe.className = 'switcher-card-iframe';
    iframe.src = item.page;
    iframe.title = item.name;
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('scrolling', 'no');

    thumb.appendChild(iframe);

    card.appendChild(topbar);
    card.appendChild(thumb);
    grid.appendChild(card);

    // 点击事件
    card.addEventListener('click', () => {
      switchToPage(item.page);
    });
  });
}

/**
 * 打开切换器
 */
function openSwitcher() {
  const overlay = document.getElementById('switcher-overlay');
  if (!overlay) return;

  // 保存当前焦点元素
  switcherState.lastFocusedElement = document.activeElement;

  // 设置当前选中为当前页面
  const currentPage = getCurrentPage();
  const currentIndex = NAV_ITEMS.findIndex(item => item.page === currentPage);
  if (currentIndex >= 0) {
    switcherState.selectedIndex = currentIndex;
  }

  updateSelectedCard();
  overlay.removeAttribute('hidden');
  overlay.classList.add('is-open');
  switcherState.open = true;

  // 焦点到网格
  const grid = document.getElementById('switcher-grid');
  grid?.focus();
}

/**
 * 关闭切换器
 */
function closeSwitcher() {
  const overlay = document.getElementById('switcher-overlay');
  if (!overlay) return;

  overlay.classList.remove('is-open');
  switcherState.open = false;

  // 等待关闭动画完成后再隐藏
  setTimeout(() => {
    if (!switcherState.open) {
      overlay.setAttribute('hidden', '');
    }
  }, 450);

  // 恢复焦点
  if (switcherState.lastFocusedElement) {
    switcherState.lastFocusedElement.focus();
  }
}

/**
 * 处理切换器键盘导航
 */
function handleSwitcherKeydown(e) {
  if (!switcherState.open) return;

  const overlay = document.getElementById('switcher-overlay');
  if (!overlay || overlay.hidden) return;

  switch (e.key) {
    case 'Escape':
      e.preventDefault();
      closeSwitcher();
      break;

    case 'Enter': {
      e.preventDefault();
      const selectedItem = NAV_ITEMS[switcherState.selectedIndex];
      if (selectedItem) {
        switchToPage(selectedItem.page);
      }
      break;
    }

    case 'ArrowLeft':
      e.preventDefault();
      moveSelection(-1, 0);
      break;

    case 'ArrowRight':
      e.preventDefault();
      moveSelection(1, 0);
      break;

    case 'ArrowUp':
      e.preventDefault();
      moveSelection(0, -1);
      break;

    case 'ArrowDown':
      e.preventDefault();
      moveSelection(0, 1);
      break;
  }
}

/**
 * 移动选中
 */
function moveSelection(deltaCol, deltaRow) {
  const cols = 3;
  const rows = 3;
  const total = NAV_ITEMS.length;

  const currentRow = Math.floor(switcherState.selectedIndex / cols);
  const currentCol = switcherState.selectedIndex % cols;

  let newRow = currentRow + deltaRow;
  let newCol = currentCol + deltaCol;

  // 循环绕行
  if (newRow < 0) newRow = rows - 1;
  if (newRow >= rows) newRow = 0;
  if (newCol < 0) newCol = cols - 1;
  if (newCol >= cols) newCol = 0;

  let newIndex = newRow * cols + newCol;
  if (newIndex >= total) newIndex = total - 1;

  switcherState.selectedIndex = newIndex;
  updateSelectedCard();
}

/**
 * 更新选中卡片样式
 */
function updateSelectedCard() {
  const cards = document.querySelectorAll('.switcher-card');
  cards.forEach((card, index) => {
    if (index === switcherState.selectedIndex) {
      card.classList.add('is-selected');
      card.setAttribute('aria-selected', 'true');
    } else {
      card.classList.remove('is-selected');
      card.removeAttribute('aria-selected');
    }
  });
}

/**
 * 切换到指定页面
 */
function switchToPage(page) {
  closeSwitcher();
  navigateToPage(page);
}

/**
 * 切换固定标签页
 */
function togglePinTab() {
  const pinBtn = document.getElementById('pin-btn');
  chrome.tabs.getCurrent((tab) => {
    if (!tab) return;
    const newPinned = !tab.pinned;
    chrome.tabs.update(tab.id, { pinned: newPinned }, () => {
      if (newPinned) {
        pinBtn.classList.add('pinned');
      } else {
        pinBtn.classList.remove('pinned');
      }
    });
  });
}

// 页面加载时初始化
function openSwitcher() {
  const overlay = document.getElementById('switcher-overlay');
  if (!overlay) return;

  if (switcherState.closeTimer) {
    clearTimeout(switcherState.closeTimer);
    switcherState.closeTimer = null;
  }

  switcherState.lastFocusedElement = document.activeElement;

  const currentPage = getCurrentPage();
  const currentIndex = NAV_ITEMS.findIndex(item => item.page === currentPage);
  if (currentIndex >= 0) {
    switcherState.selectedIndex = currentIndex;
  }

  updateSelectedCard();
  overlay.removeAttribute('hidden');
  overlay.classList.remove('is-closing');
  switcherState.open = true;

  const grid = document.getElementById('switcher-grid');
  requestAnimationFrame(() => {
    overlay.classList.add('is-open');
    grid?.focus();
  });
}

function closeSwitcher() {
  const overlay = document.getElementById('switcher-overlay');
  if (!overlay || overlay.hidden || overlay.classList.contains('is-closing')) return;

  overlay.classList.remove('is-open');
  overlay.classList.add('is-closing');
  switcherState.open = false;

  const finishClose = () => {
    if (switcherState.closeTimer) {
      clearTimeout(switcherState.closeTimer);
      switcherState.closeTimer = null;
    }

    if (!switcherState.open) {
      overlay.classList.remove('is-closing');
      overlay.setAttribute('hidden', '');
    }
  };

  const panel = overlay.querySelector('.switcher-panel');
  const handleTransitionEnd = (event) => {
    if (event.target !== panel || event.propertyName !== 'opacity') return;
    panel.removeEventListener('transitionend', handleTransitionEnd);
    finishClose();
  };

  panel?.addEventListener('transitionend', handleTransitionEnd);
  switcherState.closeTimer = setTimeout(() => {
    panel?.removeEventListener('transitionend', handleTransitionEnd);
    finishClose();
  }, 360);

  if (switcherState.lastFocusedElement) {
    switcherState.lastFocusedElement.focus();
  }
}

function setQuadLauncherVisible(isVisible) {
  const launcher = document.getElementById('quad-launcher');
  const toggleBtn = document.getElementById('quad-toggle-btn');
  if (!launcher || !toggleBtn) return;

  launcher.classList.toggle('is-hidden', !isVisible);
  toggleBtn.setAttribute('aria-pressed', isVisible ? 'true' : 'false');

  const label = isVisible ? '隐藏快捷切换按钮' : '显示快捷切换按钮';
  toggleBtn.title = label;
  toggleBtn.setAttribute('aria-label', label);
}

document.addEventListener('DOMContentLoaded', initializeOptions);
