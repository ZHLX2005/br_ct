/**
 * Minimal synchronous pub/sub primitive used by shared stores.
 *
 * Subscribers are stored in a Set so duplicate registrations collapse.
 * emit() runs each subscriber in insertion order; if a subscriber throws,
 * the error is caught, logged via console.error, and the remaining
 * subscribers still execute. One bad subscriber must never abort the chain.
 *
 * @module shared/core/subscribable
 */

/**
 * Create a new subscribable channel.
 *
 * @returns {{
 *   subscribe: (cb: Function) => () => boolean,
 *   emit: (value: any) => void,
 *   getSubscribers: () => number
 * }}
 */
export function createSubscribable() {
  const subs = new Set();

  function subscribe(cb) {
    subs.add(cb);
    let unsubscribed = false;
    return function unsubscribe() {
      if (unsubscribed) return false;
      unsubscribed = true;
      return subs.delete(cb);
    };
  }

  function emit(value) {
    for (const cb of subs) {
      try {
        cb(value);
      } catch (err) {
        console.error("subscribable subscriber threw:", err);
      }
    }
  }

  function getSubscribers() {
    return subs.size;
  }

  return { subscribe, emit, getSubscribers };
}