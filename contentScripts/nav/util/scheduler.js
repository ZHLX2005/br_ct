/**
 * @fileoverview 节流/防抖工具函数。
 */

/**
 * rAF 节流：同一帧内的多次调用合并为一次。
 * 适合高频率 IO/scroll 回调。
 */
export function rafThrottle(fn) {
  let scheduled = false;
  return (...args) => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      fn(...args);
    });
  };
}

/**
 * 防抖：N ms 内多次调用只执行最后一次。
 * 适合 MO childList 变化等批量触发场景。
 */
export function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  };
}
