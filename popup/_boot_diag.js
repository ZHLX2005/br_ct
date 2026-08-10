// popup/_boot_diag.js
// 早期诊断:在 shell.js 之前加载,捕获后续任何模块加载/求值错误。
// 这是独立 .js 文件而非 inline <script>,从而符合 MV3 默认 CSP (script-src 'self')。
//
// shell.js / sidebar/main/main.js 也保留 [boot] 日志作为后续阶段断点;
// 但若 import 链早期模块本身语法/路径错误,这些 [boot] 永远不会 fire——
// 此时本文件的 window.onerror / unhandledrejection 是唯一能记录错误的钩子。
console.log('[boot] _boot_diag.js loaded — registering global error traps');
window.addEventListener('error', (e) => {
  console.error('[boot] window.onerror:', e.message, 'at', e.filename + ':' + e.lineno + ':' + e.colno, '\nstack:', e.error?.stack);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[boot] unhandledrejection:', e.reason?.message || e.reason, '\nstack:', e.reason?.stack);
});