/**
 * @fileoverview Disposer 模式：collect deregister fns, flush on destroy.
 */

/**
 * Create a disposer collection.
 * Returns `{ add(fn), flush() }`.
 * `flush()` 逆序调用所有已注册的清理函数，然后清空。
 */
export function createDisposer() {
  const fns = [];
  return {
    add: (fn) => { fns.push(fn); return fn; },
    flush: () => { while (fns.length) fns.pop()?.(); },
  };
}
