/**
 * ccConstants.js — Claude Code 模块的常量和共享状态
 *
 * 零依赖模块，提供配置常量和模块间共享的可变状态。
 */

// ==================== 常量 ====================

export const CC_DEFAULT_PATH = 'C:\\Windows\\System32';
export const QUERY_TIMEOUT_MS = 0;          // 无超时：长任务（编辑文件等）可能执行数小时，靠 WS done 事件自然结束
export const STATUS_POLL_INTERVAL = 30000;

// ==================== 共享状态 ====================

/**
 * 模块间共享的可变状态。
 * 使用 ref 风格对象而非裸变量，以便跨模块引用同一引用。
 */
export const state = {
  statusTimer: null,
  sessionCounter: 1,
  /** @type {{ resolve: Function, reject: Function } | null} */
  pendingQuery: null,
  runtimeInit: false,
  /** 当前是否有正在执行的 query（控制发送↔停止按钮切换） */
  isStreaming: false,
};
