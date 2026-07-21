/**
 * @fileoverview
 * nav 入口 —— manifest.json 常驻注入
 *
 * 每个 AI 平台 tab 解析时自动执行：
 * 1. URL → platformId 路由（基于 PLATFORM_CONFIG）
 * 2. 检查 PLATFORM_CONFIG.hasNav 声明（默认开启）
 * 3. 读取用户 nav 开关（chrome.storage.platformNavSettings；未显式 false 即开启）
 * 4. dynamic import 加载 platforms/<id>.js + core.js
 * 5. 监听 storage onChanged，用户关闭 nav 时 reload tab 兜底
 *
 * 实现要点：
 * - content script 默认以经典脚本加载 —— 不能用顶层 import / return
 * - 整个逻辑包在 IIFE 里，配置用 dynamic import 加载
 * - sendMessage 注入链路（contentScripts/<platform>.js）由 background 动态注入，不在 entry 范围
 */

(function () {
  'use strict';

  const PLATFORM_NAV_KEY = 'platformNavSettings';

  // 防重复注入：SPA 页面 / 多次 manifest 匹配可能导致 IIFE 重复执行
  if (window.__broNavInjected) return;
  window.__broNavInjected = true;

  let navHandle = null;

  async function mount() {
    try {
      const { getPlatformIdByUrl, PLATFORM_CONFIG } = await import('../../config/platformConfig.js');
      const platformId = getPlatformIdByUrl(location.href);
      if (!platformId) return;

      const cfg = PLATFORM_CONFIG[platformId];
      if (cfg?.hasNav === false) return;

      const result = await chrome.storage.local.get(PLATFORM_NAV_KEY);
      const settings = (result && result[PLATFORM_NAV_KEY]) || {};
      if (settings[platformId] === false) return;

      const [{ default: platformCfg }, { createNav }] = await Promise.all([
        import(`./platforms/${platformId}.js`),
        import('./core/index.js'),
      ]);

      const handle = createNav({
        ...platformCfg,
        platformId,
        platformName: PLATFORM_CONFIG[platformId]?.name || platformId,
      });
      if (handle) navHandle = handle;
    } catch (err) {
      console.warn('[nav] mount 失败', err);
    }
  }

  function unmount() {
    if (navHandle) {
      navHandle.destroy();
      navHandle = null;
    }
  }

  // 启动时挂载
  mount();

  // storage 开关变化：开则 mount，关则 unmount（不再 location.reload）
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!changes[PLATFORM_NAV_KEY]) return;
    unmount();
    mount();
  });
})();
