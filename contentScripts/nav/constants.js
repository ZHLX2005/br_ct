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

// ---- 重建防抖 ----
export const REBUILD_DEBOUNCE_MS = 60;

// ---- 启动兜底 ----
export const RETRY_INTERVAL_MS = 300;
export const RETRY_MAX = 30;

// ---- IntersectionObserver ----
export const IDLE_ROOT_MARGIN = '-30% 0px -30% 0px';
export const IO_THRESHOLDS = [0, 0.25, 0.5, 0.75, 1];
