/**
 * platformScriptFiles.js - 平台脚本注入配置
 *
 * 职责：返回 AI 平台 tab 加载时 background 要注入的 sendMessage 脚本列表。
 *
 * 设计：
 * - nav（右侧对话快速导航）由 manifest.json content_scripts 第二段常驻注入
 *   contentScripts/nav/entry.js（不依赖 background SW，用户打开页面即生效）
 * - 本模块只负责 sendMessage 注入器（contentScripts/<platform>.js），
 *   由 ai_platform_processor.js 在 tabs.onUpdated 时调用 chrome.scripting.executeScript
 * - nav 开关（chrome.storage.platformNavSettings）由 entry.js 自己读取，
 *   background 不再参与 nav 缓存逻辑
 */

/**
 * 返回该平台要注入的 sendMessage 脚本路径
 * - 兜底：未注册的 platform 走默认路径
 * - nav 不在此返回 —— 已由 manifest content_scripts 第二段常驻注入
 */
export function getPlatformScriptFiles(platform) {
  return [`contentScripts/${platform}.js`];
}
