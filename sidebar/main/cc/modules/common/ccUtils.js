/**
 * ccUtils.js — Claude Code 模块的工具函数
 *
 * 纯函数集合，零依赖。
 */

// ==================== HTML 转义 ====================

export function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ==================== Session 名提取 ====================

/**
 * 从 session 记录中提取纯会话名称（不含 cwd 后缀）。
 * nx-ce 的 s.key 格式为 "name:cwd"（活跃）或 sanitize 后的 "name~sanitizedCwd"（历史）。
 * 新版 nx-ce 服务端 listStates 已返回 { name, cwd }，此函数为兜底。
 *
 * 此外处理 legacy 脏数据（旧 bug 产生的 compound name + sanitized cwd 后缀）。
 */
export function pureSessionName(s) {
  // 1. 从 key 提取：优先 : 再 ~
  if (s.key && typeof s.key === 'string') {
    let sep = s.key.indexOf(':');
    if (sep === -1) sep = s.key.indexOf('~');
    if (sep > 0) {
      const pure = s.key.slice(0, sep);
      // 如果本身就是 compound（例如 test-123_D__qq），还有 cwd 需要二次剥离
      if (s.cwd) {
        const sanitizedSuffix = '_' + String(s.cwd).replace(/[^a-zA-Z0-9._~-]/g, '_');
        if (pure.endsWith(sanitizedSuffix)) {
          return pure.slice(0, -sanitizedSuffix.length);
        }
      }
      return pure;
    }
  }
  // 2. fallback: 从 s.name 去掉 sanitized cwd 后缀（旧 bug 数据恢复）
  if (s.name && s.cwd) {
    const sanitizedSuffix = '_' + String(s.cwd).replace(/[^a-zA-Z0-9._~-]/g, '_');
    if (s.name.endsWith(sanitizedSuffix)) {
      return s.name.slice(0, -sanitizedSuffix.length);
    }
  }
  return s.name || 'default';
}

// ==================== Tool 图标 ====================

export function getToolIcon(toolName) {
  const name = (toolName || '').toLowerCase();
  // SVG icons: 10x10 inline, same stroke style
  if (name === 'read' || name === 'glob' || name === 'grep' || name === 'search' || name === 'find') {
    return '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="4" cy="4" r="2.5"/><path d="M6 6l3 3" stroke-linecap="round"/></svg>';
  }
  if (name === 'write' || name === 'edit') {
    return '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M1.5 7.5l-0.5 2 2-0.5 5.5-5.5-1.5-1.5-5.5 5.5z" stroke-linejoin="round"/></svg>';
  }
  if (name === 'bash' || name === 'run' || name === 'execute' || name === 'command') {
    return '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.3"><polygon points="2,1.5 8,5 2,8.5" stroke-linejoin="round"/></svg>';
  }
  if (name === 'agent') {
    return '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3" y="1.5" width="4" height="4" rx="1"/><path d="M2 8c0-1.5 1.5-2 3-2s3 0.5 3 2" stroke-linecap="round"/></svg>';
  }
  // default: wrench/gear
  return '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="5" cy="5" r="2"/><path d="M6.5 1.5A4 4 0 0 0 5 1a4 4 0 0 0-2 0.5l1 1.5-1 1-1.5-1A4 4 0 0 0 1 5a4 4 0 0 0 0.5 2l1.5-1 1 1-1 1.5A4 4 0 0 0 5 9a4 4 0 0 0 2-0.5l-1-1.5 1-1 1.5 1A4 4 0 0 0 9 5a4 4 0 0 0-0.5-2l-1.5 1-1-1 1-1.5z"/></svg>';
}

// ==================== Tool 详情摘要 ====================

export function getToolDetail(tool) {
  const input = tool.input;
  if (!input) return '';
  if (typeof input === 'string') return input.slice(0, 30);
  if (typeof input === 'object') {
    // 提取合适长度的摘要
    const str = input.file_path || input.command || input.path || input.pattern || JSON.stringify(input);
    return String(str).slice(0, 35);
  }
  return '';
}
