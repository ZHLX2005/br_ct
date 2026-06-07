/**
 * aichat.js — AI Chat 视图模块
 *
 * mount()：注入 aichat.html 模板，初始化 AI Chat 核心逻辑
 *          首次 mount 做完整初始化（chrome 监听器、skeleton 事件绑定），
 *          后续 mount 只刷新 DOM 引用和 aichat 内部元素的事件。
 * unmount()：清空视图容器
 */
import { initializePlatformOptions } from '../../../popup/main/platformRenderer.js';
import {
  initializePopup,
  setupEventListeners,
  loadStoredData,
  initializeResponseDisplay as initResponse,
} from '../mainUtils.js';

/** 全局只初始化一次（chrome.onMessage、skeleton 事件绑定） */
let _runtimeInit = false;
let _mounted = false;

/**
 * 挂载 AI Chat 视图
 * @param {HTMLElement} container — #app-view
 */
export async function mount(container) {
  // 注入模板（样式由 sidebar.css 在 <head> 中加载）
  const resp = await fetch('./aichat/aichat.html');
  container.innerHTML = await resp.text();

  if (!_runtimeInit) {
    // 首次：全量初始化（chrome 监听器、skeleton 事件、aichat 内部事件）
    initializePlatformOptions();
    await initializePopup();
    initResponse();
    await loadStoredData();
    setupEventListeners();
    _runtimeInit = true;
  } else {
    // 后续 mount：刷新 DOM 引用（mainUtils.js 内部缓存了 elements），
    // 不重复注册 chrome 监听器和 skeleton 事件。
    initializePopup();
    initResponse();
    loadStoredData().catch(() => {});
  }

  _mounted = true;
}

/**
 * 卸载 AI Chat 视图
 */
export function unmount(container) {
  if (!_mounted) return;
  container.innerHTML = '';
  _mounted = false;
}
