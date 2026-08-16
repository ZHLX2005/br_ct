/**
 * @fileoverview Nav 行为常量。CSS class/id 仍在 view.js 中（表现层职责）。
 */

// ---- 点击锁 ----
/** 用户点击 nav row 后锁定 active 不跟随视口，单位 ms */
export const CLICK_LOCK_MS = 800;

// ---- 节流 ----
/** evaluateActiveByViewport 节流间隔，单位 ms */
export const SET_ACTIVE_THROTTLE_MS = 120;

// ---- 可见度阈值 ----
/** 一条 row 的 visible ratio 超过此值才参与 active 竞争 */
export const ACTIVE_MIN_RATIO = 0.3;
/** 当前 active row 的 ratio 低于此值才让出新 active */
export const ACTIVE_STABILITY_RATIO = 0.15;
/** 新候选 ratio 必须超出当前 active 至少此差值才会切换 */
export const ACTIVE_STABILITY_DELTA = 0.1;

// ---- 文本截断 ----
/** 每个 nav label 的最大字符数 */
export const LABEL_TRUNCATE = 60;

// ---- 复制过滤 ----
/** 「复制全部」时，超过此字符数的条目被排除（太长复制出来没有意义） */
export const COPY_MAX_LEN = 400;

// ---- 重建防抖 ----
export const REBUILD_DEBOUNCE_MS = 60;

// ---- 启动兜底 ----
export const RETRY_INTERVAL_MS = 300;
export const RETRY_MAX = 30;

// ---- IntersectionObserver ----
export const IDLE_ROOT_MARGIN = '-30% 0px -30% 0px';
export const IO_THRESHOLDS = [0, 0.25, 0.5, 0.75, 1];

// ---- 总结模板 ----
/**
 * 总结按钮拼装消息时使用的模板。%s 用与"复制"按钮相同的多消息原文
 * （以 ========== 分隔）填充。
 *
 * 用于"识别 nav 记录中哪些是总结发出的消息"：通过 SUMMARY_MARKER
 * 全文包含判定，详见 isSummaryMessage。
 */
export const SUMMARY_TEMPLATE =
  '%s,这是我向你提出的这些问题 现在重新对每个问题进行总结,讲解整个知识体系,让整个所有提问和体系更加自然';

/**
 * 识别一段 fullText 是否由"总结"按钮发出——任何包含 SUMMARY_MARKER
 * 的子串都是上一轮总结的产物。模板里 %s 替换后是用户第一条问题（位置
 * 不固定），所以不能用 startsWith 检测，只能用"全文包含"匹配。
 */
export const SUMMARY_MARKER = '这是我向你提出的这些问题';
/**
 * 工具函数：给定 nav 记录（或任意文本），判断是否由"总结"按钮发出。
 * 任何含 SUMMARY_MARKER 的文本一律视为总结产物。
 */
export function isSummaryMessage(text) {
  if (!text) return false;
  return text.includes(SUMMARY_MARKER);
}
