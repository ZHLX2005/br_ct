// popup/shell.js
console.log('[boot] shell.js module loaded');
import { setMountPoint, setViewDom, register, mount, getCurrent } from "./viewSystem/viewController.js";
import { init as initMain, onActivate as onActivateMain, teardown as teardownMain } from "./main/main.js";
import { init as initFunc, teardown as teardownFunc } from "./func_execute/functioncall.js";
import { init as initTranslation, teardown as teardownTranslation } from "./translation/translation.js";

const popupBase = chrome.runtime.getURL('popup'); // 形如 chrome-extension://<id>/popup
const fetchBody = (rel) => fetch(`${popupBase}/${rel}`)
  .then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    return r.text();
  })
  .catch(err => {
    console.error('[shell] fetchBody failed for', rel, err);
    return `<body><div data-view-content><div data-load-error>视图加载失败: ${rel}</div></div></body>`;
  });

setMountPoint(document.getElementById('view-mount'));
register([
  { id: 'main',        cssHrefs: [chrome.runtime.getURL('popup/main/main.css'), chrome.runtime.getURL('popup/main/prompts/promptsUI.css')],
    // 主页 inline 在 shell.html 里，getBody 永不调用；启动时通过 setViewDom 注入 dom 后 mount('main') 走快速路径（无 fetch）。
    getBody: () => new Promise(() => {}), init: initMain, onActivate: onActivateMain, teardown: teardownMain },
  { id: 'func',        cssHrefs: [chrome.runtime.getURL('popup/func_execute/functioncall.css')],
    getBody: () => fetchBody('func_execute/functioncall.html'), init: initFunc,    teardown: teardownFunc },
  { id: 'translation', cssHrefs: [chrome.runtime.getURL('popup/translation/translation.css')],
    getBody: () => fetchBody('translation/translation.html'), init: initTranslation, teardown: teardownTranslation },
]);

// nav：用 hash 驱动（<a href="#xxx">），hashchange → mount
// VIEW_BY_HASH 提前到这里，供上面 setViewDom 块的初始 target 判断使用。
const VIEW_BY_HASH = { '#main': 'main', '#func': 'func', '#translation': 'translation' };

// 主页特例：inline DOM 已在 #view-mount 里，注入 controller 视图表，让首次 mount('main') 跳过 fetch 直接 attach。
// 启动时若 hash 不是 main（直接打开 #func 等），先把 inline 节点从 #view-mount 移走暂存，
// controller 在 mount('main') 时会重新 append 回来（appendChild 对已存在节点会 move 而非复制）。
const mainInline = document.querySelector('#view-mount > .view[data-view-content]');
console.log('[boot] shell: mainInline present =', !!mainInline, 'location.hash =', location.hash);
if (mainInline) {
  setViewDom('main', mainInline);
  const initialTarget = VIEW_BY_HASH[location.hash] || 'main';
  if (initialTarget !== 'main') {
    // inline main 移到 body 下暂存；切回 main 时 controller 会把它 append 回 mount 点
    document.body.appendChild(mainInline);
  }
}

function activeFromHash() {
  const id = VIEW_BY_HASH[location.hash] || 'main';
  mount(id);
  document.body.dataset.view = id; // 让 CSS 可按当前视图控制元素(如 open-sidepanel-btn)
  document.querySelectorAll('.header-nav-item[data-view]').forEach(a => {
    const on = a.dataset.view === id;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}
window.addEventListener('hashchange', activeFromHash);

// 设置项 + 侧边栏按钮
document.getElementById('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
const sideBtn = document.getElementById('open-sidepanel-btn');
sideBtn.addEventListener('click', async () => {
  console.log('[boot] sidepanel button clicked');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  console.log('[boot] sidepanel: active tab =', tab?.id, tab?.url);
  if (tab) {
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
      console.log('[boot] sidepanel opened OK');
    } catch (e) {
      console.error('[boot] sidePanel.open failed:', e?.message, e);
    }
    window.close();
  } else {
    console.warn('[boot] sidepanel: no active tab');
  }
});

// 启动
document.addEventListener('DOMContentLoaded', () => {
  console.log('[boot] shell: DOMContentLoaded, hash =', location.hash);
  activeFromHash();
});