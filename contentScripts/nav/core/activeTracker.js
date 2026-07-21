/**
 * @fileoverview Active 可见度跟踪器。持有 activeIndex 真值。
 *
 * 输出 onChange(index) 回调（接入 view.setActive）。
 * 不直接操作 DOM。
 */

import {
  CLICK_LOCK_MS,
  SET_ACTIVE_THROTTLE_MS,
  ACTIVE_MIN_RATIO,
  ACTIVE_STABILITY_RATIO,
  ACTIVE_STABILITY_DELTA,
} from '../constants.js';
import { rafThrottle } from '../util/scheduler.js';

/**
 * @param {object} opts
 * @param {() => Array<{el: Element}>} opts.getRecords - 返回当前 records（含 el）
 * @param {(index: number) => void} [opts.onChange]   - active 变化时回调
 * @returns {{
 *   activeIndex: number,
 *   commit: (i: number) => void,
 *   evaluate: () => boolean,
 *   schedule: () => void,
 *   unlock: () => void,
 * }}
 */
export function createActiveTracker({ getRecords, onChange }) {
  let activeIndex = -1;
  let clickLockUntil = 0;
  let lastSetActiveTime = 0;

  function commit(i) {
    if (i === activeIndex) return;
    activeIndex = i;
    if (onChange) onChange(i);
  }

  function isLocked() {
    return Date.now() < clickLockUntil;
  }

  function lock() {
    clickLockUntil = Date.now() + CLICK_LOCK_MS;
  }

  function unlock() {
    clickLockUntil = 0;
  }

  /** 同步计算 viewport 中最可见的 row，设 active。返回是否设了。 */
  function evaluate() {
    if (isLocked()) return false;
    const records = getRecords();
    if (records.length === 0) return false;

    let bestIndex = -1;
    let bestRatio = 0;
    const vh = window.innerHeight || document.documentElement.clientHeight;

    records.forEach((rec, i) => {
      const rect = rec.el.getBoundingClientRect();
      const visible = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
      const ratio = visible / Math.max(rect.height, 1);
      if (ratio > bestRatio) { bestRatio = ratio; bestIndex = i; }
    });

    if (bestIndex < 0 || bestRatio < ACTIVE_MIN_RATIO) return false;

    // 稳定性：当前 active 与新候选比例接近时保留
    if (activeIndex >= 0 && activeIndex !== bestIndex) {
      const curRec = records[activeIndex];
      if (curRec) {
        const cr = curRec.el.getBoundingClientRect();
        const cv = Math.max(0, Math.min(cr.bottom, vh) - Math.max(cr.top, 0));
        const curRatio = cv / Math.max(cr.height, 1);
        if (curRatio >= ACTIVE_STABILITY_RATIO &&
            bestRatio - curRatio < ACTIVE_STABILITY_DELTA) {
          return true; // 保留
        }
      }
    }

    commit(bestIndex);
    lastSetActiveTime = Date.now();
    return true;
  }

  /**
   * rAF 节流包装的 evaluate，供 IO/scroll 高频场景调用。
   * 受 clickLock + 时间节流双重保护。
   */
  const schedule = rafThrottle(() => {
    if (isLocked()) return;
    if (Date.now() - lastSetActiveTime < SET_ACTIVE_THROTTLE_MS) return;
    evaluate();
  });

  return { activeIndex, commit, evaluate, schedule, lock, unlock };
}
