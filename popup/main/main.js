// main.js
import {
  initializePopup,
  setupEventListeners,
  loadStoredData,
} from "./mainUtils.js";
import { setupDragDropEvents } from "./dragDropHandler.js";
import { initializePlatformOptions } from "./platformRenderer.js";

/**
 * 主页视图初始化（供 viewController 以 rootEl 调用，或直开 mainView.html 时以 document.body 调用）。
 * 所有 DOM 查询都需 scope 到 rootEl，不得使用 document.* 全局查询。
 */
export async function init(rootEl) {
  try {
    // 动态生成平台选项（从统一配置）
    initializePlatformOptions(rootEl);

    // 初始化弹窗（缓存 DOM、绑定输入持久化前置逻辑）
    await initializePopup(rootEl);

    // 加载存储的数据
    await loadStoredData();

    // 设置所有事件监听器
    setupEventListeners();

    // 初始化指定输入框的拖放事件
    setupDragDropEvents(rootEl);
  } catch (error) {
    console.error("初始化 main 视图失败:", error);
  }
}

/**
 * 主页视图拆解。本视图无 document 级常驻监听（仅 rootEl 内元素监听，
 * 随 DOM detach 自动失效），故 no-op。
 */
export function teardown(rootEl) {
  // no-op
}

// 直开 mainView.html 时自动 init；被 shell 通过 viewController 加载时由控制器调用 init。
if (document.querySelector('[data-view-content]')) {
  document.addEventListener("DOMContentLoaded", () => init(document.body));
}
