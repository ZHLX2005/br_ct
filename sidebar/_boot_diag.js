// sidebar/_boot_diag.js
// 早期诊断:在 sidebar/main.js 之前加载,捕获后续任何模块加载/求值错误。
// 这是独立 .js 文件而非 inline <script>,从而符合 MV3 默认 CSP (script-src 'self')。
console.log('[boot] sidebar _boot_diag.js loaded — registering global error traps');
window.addEventListener('error', (e) => {
  console.error('[boot] sidebar window.onerror:', e.message, 'at', e.filename + ':' + e.lineno + ':' + e.colno, '\nstack:', e.error?.stack);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[boot] sidebar unhandledrejection:', e.reason?.message || e.reason, '\nstack:', e.reason?.stack);
});