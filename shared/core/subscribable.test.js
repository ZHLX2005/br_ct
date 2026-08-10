/**
 * Tests for shared/core/subscribable.js
 *
 * Run with: node shared/core/subscribable.test.js
 * Uses node:assert only; no external test framework.
 */

import { strict as assert } from "node:assert";
import { createSubscribable } from "./subscribable.js";

let passed = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); failed++; }
};

test("subscribe returns unsubscribe function", () => {
  const s = createSubscribable();
  const noop = () => {};
  const unsub = s.subscribe(noop);
  assert.equal(typeof unsub, "function");
  assert.equal(s.getSubscribers(), 1);
  const removed = unsub();
  assert.equal(removed, true);
  assert.equal(s.getSubscribers(), 0);
  // calling unsubscribe twice must not throw
  const removedAgain = unsub();
  assert.equal(removedAgain, false);
  assert.equal(s.getSubscribers(), 0);
});

test("emit triggers all subscribers", () => {
  const s = createSubscribable();
  let countA = 0;
  let countB = 0;
  s.subscribe(() => { countA++; });
  s.subscribe(() => { countB++; });
  s.emit("x");
  assert.equal(countA, 1);
  assert.equal(countB, 1);
});

test("throwing subscriber does not break others", () => {
  // silence the expected console.error so test output stays clean
  const origError = console.error;
  console.error = () => {};
  try {
    const s = createSubscribable();
    let counter = 0;
    s.subscribe(() => { throw new Error("boom"); });
    s.subscribe(() => { counter++; });
    s.emit(null);
    assert.equal(counter, 1);
  } finally {
    console.error = origError;
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);