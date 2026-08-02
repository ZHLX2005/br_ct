// popup/shell.js
import { setMountPoint, register, mount, getCurrent } from "./viewSystem/viewController.js";
import { init as initMain, onActivate as onActivateMain, teardown as teardownMain } from "./main/main.js";
import { init as initFunc, teardown as teardownFunc } from "./func_execute/functioncall.js";
import { init as initTranslation, teardown as teardownTranslation } from "./translation/translation.js";

const popupBase = chrome.runtime.getURL('popup'); // 形如 chrome-extension://<id>/popup
const fetchBody = (rel) => fetch(`${popupBase}/${rel}`).then(r => r.text());

setMountPoint(document.getElementById('view-mount'));
register([
  { id: 'main',        cssHrefs: [chrome.runtime.getURL('popup/main/main.css'), chrome.runtime.getURL('popup/main/prompts/promptsUI.css')],
    getBody: () => fetchBody('main/mainView.html'),         init: initMain,        onActivate: onActivateMain, teardown: teardownMain },
  { id: 'func',        cssHrefs: [chrome.runtime.getURL('popup/func_execute/functioncall.css')],
    getBody: () => fetchBody('func_execute/functioncall.html'), init: initFunc,    teardown: teardownFunc },
  { id: 'translation', cssHrefs: [chrome.runtime.getURL('popup/translation/translation.css')],
    getBody: () => fetchBody('translation/translation.html'), init: initTranslation, teardown: teardownTranslation },
]);

// nav：用 hash 驱动（<a href="#xxx">），hashchange → mount
const VIEW_BY_HASH = { '#main': 'main', '#func': 'func', '#translation': 'translation' };
function activeFromHash() {
  const id = VIEW_BY_HASH[location.hash] || 'main';
  mount(id);
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
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) { await chrome.sidePanel.open({ tabId: tab.id }); window.close(); }
});

// 启动
document.addEventListener('DOMContentLoaded', activeFromHash);