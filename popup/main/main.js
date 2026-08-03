// main.js
import {
  initializePopup,
  registerDocumentSideEffects,
  loadStoredData,
  setupEventListeners,
  teardownView,
} from "./mainUtils.js";
import { setupDragDropEvents } from "./dragDropHandler.js";
import { initializePlatformOptions } from "./platformRenderer.js";

/**
 * 主页视图初始化（供 viewController 以 rootEl 调用，或直开 mainView.html 时以 document.body 调用）。
 * 由 viewController 在视图首次 mount 时调用一次（视图生命周期内 only once）。
 * 所有 DOM 查询都需 scope 到 rootEl，不得使用 document.* 全局查询。
 *
 * 本函数只处理一次性的初始化：DOM 缓存 / 元素级绑定 / storage 读取 / 输入持久化接管。
 * document 级副作用（document.addEventListener、document.body 挂载的 popup、
 * chrome.runtime.onMessage.addListener）由 onActivate 在每次 mount 时注册——这是 fix round 1
 * 后引入的新分工：teardown 每次 unmount 都会清掉这些副作用，因此下次 mount 必须重新注册，
 * 否则会产生「document 监听被清掉、视图仍 visible 但外点 / 平台可见性更新失效」的 bug。
 */
export async function init(rootEl) {
  try {
    // 动态生成平台选项（从统一配置）
    initializePlatformOptions(rootEl);

    // 初始化弹窗（缓存 DOM、绑定输入持久化前置逻辑）
    await initializePopup(rootEl);

    // 加载存储的数据
    await loadStoredData();

    // 设置所有元素级事件监听器（依赖 elements 缓存；只调一次足够——重挂载同一个 viewRoot
    // 实例的同一组元素会保留绑定，再调一次会在每个元素上重复注册 change/click，违反约束）。
    // platformVisibility 的 onMessage 是 document 级，已迁出至 onActivate，见 registerDocumentSideEffects。
    setupEventListeners();

    // 初始化指定输入框的拖放事件（element-level，仅一次足够）
    setupDragDropEvents(rootEl);
  } catch (error) {
    console.error("初始化 main 视图失败:", error);
  }
}

/**
 * 主页视图激活（每次 mount 都调用——首次 mount 也会调）。
 *
 * 在此注册 document 级副作用：
 *   - `populateOptimizer`：document 点击外点关闭下拉框
 *   - `initAliasShortcut`：document 点击外点关闭 alias popup；alias popup 创建在 document.body
 *   - `setupPlatformVisibilityMessageListener`：chrome.runtime.onMessage 平台可见性变更通知
 *
 * 注册时返回的 cleanup 函数由 mainUtils 推入 viewCleanups；teardown(rootEl) 在下次 unmount
 * 之前会调用 teardownView() 统一清理。
 */
export function onActivate(rootEl) {
  try {
    registerDocumentSideEffects(rootEl);
  } catch (error) {
    console.error("main onActivate 失败:", error);
  }
}

/**
 * 主页视图拆解。init + onActivate 注册的所有副作用与 alias popup 由 teardownView 统一清理；
 * view 内的元素监听随 DOM detach 自动失效。
 */
export function teardown(rootEl) {
  teardownView();
}

// 直开 mainView.html 时自动 init；被 shell 通过 viewController 加载时由控制器调用 init。
if (document.querySelector('[data-view-content]')) {
  document.addEventListener("DOMContentLoaded", async () => {
    await init(document.body);
    // 直开路径不经过 viewController，无 onActivate 节拍——需手动调用一次以注册 document 副作用，
    // 否则直开 mainView 时 /alias、optimizer 外点关闭、平台可见性 message 通知全部失灵。
    onActivate(document.body);
  });
}
