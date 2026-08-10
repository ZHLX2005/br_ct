/**
 * aichat.js — AI Chat 模块
 * mount()：加载 aichat.css，注入 aichat.html，初始化 AI Chat 核心逻辑
 * unmount()：清空 #app-view
 */
import { initializePlatformOptions } from '../../../popup/main/platformRenderer.js';
import {
  initializePopup,
  setupEventListeners,
  loadStoredData,
  initializeResponseDisplay as initResponse,
} from './aichatUtils.js';

console.log('[boot] aichat.js module loaded');

let _runtimeInit = false;
let _cssLoaded = false;

export async function mount(container) {
  console.log('[boot] aichat.mount: start, container =', container?.id);
  // 加载 aichat.css
  if (!_cssLoaded && !document.querySelector('link[href*="aichat/aichat.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './aichat/aichat.css';
    document.head.appendChild(link);
    _cssLoaded = true;
    console.log('[boot] aichat.mount: aichat.css <link> appended');
  }
  let resp;
  try {
    resp = await fetch('./aichat/aichat.html');
    console.log('[boot] aichat.mount: fetch aichat.html status =', resp.status, resp.ok);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  } catch (e) {
    console.error('[boot] aichat.mount: fetch aichat.html FAILED:', e?.message);
    return;
  }
  const html = await resp.text();
  if (!html || html.trim().length === 0) {
    console.error('[aichat] aichat.html is empty!');
    return;
  }
  container.innerHTML = html;
  console.log('[aichat] HTML injected, length:', html.length);
  console.log('[aichat] response-content element:', !!document.getElementById('response-content'));
  console.log('[aichat] response-status element:', !!document.getElementById('response-status'));

  // 每次 mount 都重新缓存 DOM + 绑定事件（DOM 全新注入，无重复风险）
  if (!_runtimeInit) {
    initializePlatformOptions();
    _runtimeInit = true;
  }
  try {
    await initializePopup();
    console.log('[boot] aichat.mount: initializePopup done');
  } catch (e) {
    console.error('[boot] aichat.mount: initializePopup FAILED:', e?.message, e?.stack);
  }
  initResponse();
  await loadStoredData().catch((e) => console.warn('[boot] aichat.mount: loadStoredData failed:', e?.message));
  setupEventListeners();

  // 挂载 sidebar 独立提示词面板（与 popup 下拉互不引用 DOM/CSS，仅共用 shared 数据层）。
  try {
    const { mountPromptsPanel } = await import('./promptsPanel.js');
    mountPromptsPanel(document.getElementById('prompts-panel-mount'), document.body);
    console.log('[boot] aichat.mount: promptsPanel mounted');
  } catch (e) {
    console.error('[boot] aichat.mount: promptsPanel mount FAILED:', e?.message, e?.stack);
  }
  console.log('[boot] aichat.mount: done');
}

export function unmount(container) {
  console.log('[boot] aichat.unmount: container =', container?.id);
  container.innerHTML = '';
}
