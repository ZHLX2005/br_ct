import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { createNav } from '../../contentScripts/nav/core/index.js';
import {
  FakeElement,
  installBrowserGlobals,
  resetBrowserGlobals,
} from './fake-dom.mjs';

afterEach(() => {
  resetBrowserGlobals();
  // Restore any patched globals that a test might have leaked.
  if (originalSetInterval) globalThis.setInterval = originalSetInterval;
  if (originalSetTimeout) globalThis.setTimeout = originalSetTimeout;
  if (originalClearInterval) globalThis.clearInterval = originalClearInterval;
  if (originalClearTimeout) globalThis.clearTimeout = originalClearTimeout;
});

const originalSetInterval = globalThis.setInterval;
const originalSetTimeout = globalThis.setTimeout;
const originalClearInterval = globalThis.clearInterval;
const originalClearTimeout = globalThis.clearTimeout;

function createMessage(text, textNodeText) {
  const message = new FakeElement('article');
  const textNode = new FakeElement('p');
  textNode.innerText = textNodeText !== undefined ? textNodeText : text;
  message.innerText = text;
  message.setQuerySelector('.message-text', textNode);
  return message;
}

// Captureable IO/MO factories used in lifecycle characterization tests.
// Installs on both globalThis (for `new X()`) and `window` (so core's
// `'IntersectionObserver' in window` guard finds it).
function captureObservers() {
  const intersectionCallbacks = [];
  const mutationCallbacks = [];
  let ioInstances = 0;
  let moInstances = 0;

  class CapturingIntersectionObserver {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      this.observed = [];
      this.disconnected = false;
      intersectionCallbacks.push({ callback, options, instance: this });
      ioInstances += 1;
    }
    observe(el) {
      this.observed.push(el);
    }
    disconnect() {
      this.disconnected = true;
      this.observed = [];
    }
  }

  class CapturingMutationObserver {
    constructor(callback, options) {
      this.callback = callback;
      this.observed = [];
      this.disconnected = false;
      mutationCallbacks.push({ callback, options, instance: this });
      moInstances += 1;
    }
    observe(target, options) {
      this.observed.push({ target, options });
    }
    disconnect() {
      this.disconnected = true;
      this.observed = [];
    }
  }

  globalThis.IntersectionObserver = CapturingIntersectionObserver;
  globalThis.MutationObserver = CapturingMutationObserver;
  if (globalThis.window) {
    globalThis.window.IntersectionObserver = CapturingIntersectionObserver;
    globalThis.window.MutationObserver = CapturingMutationObserver;
  }

  return {
    intersectionCallbacks,
    mutationCallbacks,
    counts: () => ({ ioInstances, moInstances }),
  };
}

function captureTimers() {
  const intervals = [];
  const timeouts = [];

  globalThis.setInterval = (cb, delay, ...args) => {
    const id = intervals.length + 1;
    intervals.push({ id, cb, delay, args });
    return id;
  };
  globalThis.setTimeout = (cb, delay, ...args) => {
    const id = timeouts.length + 1;
    timeouts.push({ id, cb, delay, args });
    return id;
  };
  globalThis.clearInterval = (id) => {
    const idx = intervals.findIndex((entry) => entry.id === id);
    if (idx >= 0) intervals[idx].cleared = true;
  };
  globalThis.clearTimeout = (id) => {
    const idx = timeouts.findIndex((entry) => entry.id === id);
    if (idx >= 0) timeouts[idx].cleared = true;
  };

  return {
    intervals,
    timeouts,
    drainTimeouts: () => {
      const drained = timeouts.splice(0, timeouts.length);
      drained.forEach(({ cb }) => cb());
    },
  };
}

test('filters empty messages before mapping row clicks to platform elements', () => {
  const { document } = installBrowserGlobals();
  const list = new FakeElement('main');
  const first = createMessage('first prompt');
  const empty = createMessage('   ');
  const last = createMessage('last prompt');

  document.setQuerySelector('.message-list', list);
  document.setQuerySelectorAll('.user-message', [first, empty, last]);

  createNav({
    itemSel: '.user-message',
    listSel: '.message-list',
    textSel: '.message-text',
  });

  const nav = document.getElementById('bro-chat-right-edges-nav');
  assert.ok(nav);
  // The handle sits at children[0]; rows are children[1..N];
// export button at children[N+1].
  assert.equal(nav.children.length, 4);
  assert.equal(nav.children[0].className, 'bro-chat-nav__handle');
  assert.equal(nav.children[1].children[0].textContent, 'first prompt');
  assert.equal(nav.children[2].children[0].textContent, 'last prompt');

  nav.children[2].click();

  assert.deepEqual(first.scrollCalls, []);
  assert.deepEqual(empty.scrollCalls, []);
  assert.deepEqual(last.scrollCalls, [
    { behavior: 'smooth', block: 'center' },
  ]);
  assert.equal(nav.children[1].children[1].classList.contains('is-active'), false);
  assert.equal(nav.children[2].children[1].classList.contains('is-active'), true);
});

// ─── 1. Duplicate shared view container ──────────────────────────────────────
test('createNav is a no-op when the shared nav container is already mounted', () => {
  const { document } = installBrowserGlobals();
  const observers = captureObservers();
  const timers = captureTimers();

  // Pre-mount a nav container (mimics second createNav call: createNavView
  // returns null because the container already exists).
  const preexisting = new FakeElement('div');
  preexisting.id = 'bro-chat-right-edges-nav';
  document.body.appendChild(preexisting);

  createNav({
    itemSel: '.user-message',
    listSel: '.message-list',
    textSel: '.message-text',
  });

  assert.equal(observers.counts().ioInstances, 0);
  assert.equal(observers.counts().moInstances, 0);
  assert.equal(timers.intervals.length, 0);

  // Original container untouched, no rows appended.
  assert.equal(preexisting.children.length, 0);
});

// ─── 2. Text extraction priority/fallback + initial active ───────────────────
test('extractText overrides textSel when present', () => {
  const { document } = installBrowserGlobals();
  const list = new FakeElement('main');
  const msg = createMessage('inner fallback', 'innerText via textSel');
  document.setQuerySelector('.message-list', list);
  document.setQuerySelectorAll('.user-message', [msg]);

  createNav({
    itemSel: '.user-message',
    listSel: '.message-list',
    textSel: '.message-text',
    extractText: () => 'from extractor',
  });

  const nav = document.getElementById('bro-chat-right-edges-nav');
  assert.equal(nav.children[1].children[0].textContent, 'from extractor');
});

test('extractText returning empty falls through to textSel', () => {
  const { document } = installBrowserGlobals();
  const list = new FakeElement('main');
  const msg = createMessage('inner fallback', 'via textSel');
  document.setQuerySelector('.message-list', list);
  document.setQuerySelectorAll('.user-message', [msg]);

  createNav({
    itemSel: '.user-message',
    listSel: '.message-list',
    textSel: '.message-text',
    extractText: () => '',
  });

  const nav = document.getElementById('bro-chat-right-edges-nav');
  assert.equal(nav.children[1].children[0].textContent, 'via textSel');
});

test('textSel null falls through to el.innerText', () => {
  const { document } = installBrowserGlobals();
  const list = new FakeElement('main');
  const msg = new FakeElement('article');
  msg.innerText = 'from innerText';
  document.setQuerySelector('.message-list', list);
  document.setQuerySelectorAll('.user-message', [msg]);

  createNav({
    itemSel: '.user-message',
    listSel: '.message-list',
    textSel: null,
  });

  const nav = document.getElementById('bro-chat-right-edges-nav');
  assert.equal(nav.children[1].children[0].textContent, 'from innerText');
});

test('textSel pointing to an element with no innerText falls through to el.innerText', () => {
  const { document } = installBrowserGlobals();
  const list = new FakeElement('main');
  const msg = new FakeElement('article');
  msg.innerText = 'inner fallback';
  msg.setQuerySelector('.message-text', null);
  document.setQuerySelector('.message-list', list);
  document.setQuerySelectorAll('.user-message', [msg]);

  createNav({
    itemSel: '.user-message',
    listSel: '.message-list',
    textSel: '.message-text',
  });

  const nav = document.getElementById('bro-chat-right-edges-nav');
  assert.equal(nav.children[1].children[0].textContent, 'inner fallback');
});

test('labels truncate to 60 characters and last surviving record is initially active', () => {
  const { document } = installBrowserGlobals();
  const list = new FakeElement('main');
  const longText = 'x'.repeat(200);
  const a = createMessage(longText);
  const b = createMessage('   ');
  const c = createMessage('short');
  document.setQuerySelector('.message-list', list);
  document.setQuerySelectorAll('.user-message', [a, b, c]);

  createNav({
    itemSel: '.user-message',
    listSel: '.message-list',
    textSel: '.message-text',
  });

  const nav = document.getElementById('bro-chat-right-edges-nav');
  assert.equal(nav.children.length, 3);
  assert.equal(nav.children[0].className, 'bro-chat-nav__handle');
  assert.equal(nav.children[1].children[0].textContent, 'x'.repeat(60));
  assert.equal(nav.children[2].children[0].textContent, 'short');
  assert.equal(nav.children[1].children[1].classList.contains('is-active'), false);
  assert.equal(nav.children[2].children[1].classList.contains('is-active'), true);
});

// ─── 3. Click lock + scroll handoff ──────────────────────────────────────────
test('click lock holds active against viewport evaluation, then scroll hands off', () => {
  const { document, windowListeners } = installBrowserGlobals();
  const observers = captureObservers();

  const list = new FakeElement('main');
  const first = createMessage('first');
  const second = createMessage('second');
  document.setQuerySelector('.message-list', list);
  document.setQuerySelectorAll('.user-message', [first, second]);

  // Default rect (top:0, bottom:100, height:100) on both — viewport 1000 tall.
  createNav({
    itemSel: '.user-message',
    listSel: '.message-list',
    textSel: '.message-text',
  });

  const nav = document.getElementById('bro-chat-right-edges-nav');
  // Initial active: last surviving record = second.
  assert.equal(nav.children[2].children[1].classList.contains('is-active'), true);

  // Click first row → lock + set active=0.
  nav.children[1].click();
  assert.deepEqual(first.scrollCalls, [
    { behavior: 'smooth', block: 'center' },
  ]);
  assert.equal(nav.children[1].children[1].classList.contains('is-active'), true);
  assert.equal(nav.children[2].children[1].classList.contains('is-active'), false);

  // While click lock is active, IntersectionObserver callback must NOT transfer
  // active. We can prove the IO callback alone is a no-op under lock by
  // asserting active remains on row 0 regardless of rect changes.
  second.rect = { top: 0, bottom: 1000, height: 1000 };
  first.rect = { top: 5000, bottom: 5100, height: 100 };
  observers.intersectionCallbacks[0].callback();
  assert.equal(nav.children[1].children[1].classList.contains('is-active'), true);
  assert.equal(nav.children[2].children[1].classList.contains('is-active'), false);

  // Fire the captured scroll listener. It should clear the lock and let the
  // viewport evaluator transfer active to whichever record is most visible
  // (second, with top:0..1000 covering the full viewport).
  const scrollListeners = windowListeners.get('scroll') || [];
  assert.ok(scrollListeners.length >= 1);
  scrollListeners[scrollListeners.length - 1]();
  assert.equal(nav.children[1].children[1].classList.contains('is-active'), false);
  assert.equal(nav.children[2].children[1].classList.contains('is-active'), true);
});

// ─── 4. List identity lifecycle ─────────────────────────────────────────────
test('shell mutation rebinds when document.querySelector(listSel) returns a new list', () => {
  const { document } = installBrowserGlobals();
  const observers = captureObservers();
  const timers = captureTimers();

  const listA = new FakeElement('main');
  const a1 = createMessage('a1');
  document.setQuerySelector('.message-list', listA);
  document.setQuerySelectorAll('.user-message', [a1]);

  createNav({
    itemSel: '.user-message',
    listSel: '.message-list',
    textSel: '.message-text',
  });

  const nav = document.getElementById('bro-chat-right-edges-nav');
  assert.equal(nav.children.length, 2);
  assert.equal(nav.children[0].className, 'bro-chat-nav__handle');
  const initialListObserver = observers.mutationCallbacks.find(
    (entry) => entry.instance.observed[0] && entry.instance.observed[0].target === listA
  );
  assert.ok(initialListObserver);

  // Simulate conversation switch: querySelector(listSel) now returns listB.
  const listB = new FakeElement('main');
  const b1 = createMessage('b1');
  const b2 = createMessage('b2');
  document.setQuerySelector('.message-list', listB);
  document.setQuerySelectorAll('.user-message', [b1, b2]);

  // Fire the shell observer callback (the one watching document.body).
  const shellOb = observers.mutationCallbacks.find(
    (entry) => entry.instance.observed[0] && entry.instance.observed[0].target === document.body
  );
  assert.ok(shellOb);
  shellOb.callback();

  // Drain the setTimeout(ensureListBound, 0) the shell callback scheduled.
  timers.drainTimeouts();

  assert.equal(initialListObserver.instance.disconnected, true);
  const reboundObserver = observers.mutationCallbacks.find(
    (entry) => entry !== initialListObserver
      && entry.instance.observed[0]
      && entry.instance.observed[0].target === listB
  );
  assert.ok(reboundObserver);
  assert.equal(nav.children.length, 3);
  assert.equal(nav.children[1].children[0].textContent, 'b1');
  assert.equal(nav.children[2].children[0].textContent, 'b2');
});

test('list disappearance clears records and disconnects both observers', () => {
  const { document } = installBrowserGlobals();
  const observers = captureObservers();
  const timers = captureTimers();

  const list = new FakeElement('main');
  const m1 = createMessage('m1');
  document.setQuerySelector('.message-list', list);
  document.setQuerySelectorAll('.user-message', [m1]);

  createNav({
    itemSel: '.user-message',
    listSel: '.message-list',
    textSel: '.message-text',
  });

  const nav = document.getElementById('bro-chat-right-edges-nav');
  assert.equal(nav.children.length, 2);
  assert.equal(nav.children[0].className, 'bro-chat-nav__handle');
  const listObserver = observers.mutationCallbacks.find(
    (entry) => entry.instance.observed[0] && entry.instance.observed[0].target === list
  );
  assert.ok(listObserver);
  const ioInstance = observers.intersectionCallbacks[0].instance;
  assert.equal(ioInstance.disconnected, false);

  // Simulate list vanishing: drop the queryOne entry so querySelector
  // falls back to body-tree traversal (which returns null since list is not
  // attached under document.body in this fake).
  document.queryOne.delete('.message-list');

  const shellOb = observers.mutationCallbacks.find(
    (entry) => entry.instance.observed[0] && entry.instance.observed[0].target === document.body
  );
  shellOb.callback();

  // Drain the setTimeout(ensureListBound, 0).
  timers.drainTimeouts();

  assert.equal(listObserver.instance.disconnected, true);
  assert.equal(ioInstance.disconnected, true);
  // clear() preserves the handle; only rows are removed.
  assert.equal(nav.children.length, 1);
  assert.equal(nav.children[0].className, 'bro-chat-nav__handle');
});

test('shell mutation bursts queue only one list-bound check', () => {
  const { document } = installBrowserGlobals();
  const observers = captureObservers();
  const timers = captureTimers();

  const list = new FakeElement('main');
  document.setQuerySelector('.message-list', list);
  document.setQuerySelectorAll('.user-message', [createMessage('m1')]);

  createNav({
    itemSel: '.user-message',
    listSel: '.message-list',
    textSel: '.message-text',
  });

  const shellOb = observers.mutationCallbacks.find(
    (entry) => entry.instance.observed[0]?.target === document.body
  );
  assert.ok(shellOb);

  shellOb.callback();
  shellOb.callback();
  shellOb.callback();

  assert.equal(timers.timeouts.length, 1);
  assert.equal(timers.timeouts[0].delay, 0);

  timers.drainTimeouts();
  shellOb.callback();
  assert.equal(timers.timeouts.length, 1);
});

// ─── 5. Startup polling ─────────────────────────────────────────────────────
test('startup polling uses 300ms interval and clears after the existing retry limit', () => {
  installBrowserGlobals();
  const timers = captureTimers();

  // No list mounted — createNav falls into the polling branch.
  createNav({
    itemSel: '.user-message',
    listSel: '.message-list',
    textSel: '.message-text',
  });

  assert.equal(timers.intervals.length, 1);
  assert.equal(timers.intervals[0].delay, 300);

  // Reference implementation uses `bootRetries > 30` (post-increment), so the
  // interval survives the first 30 invocations and clears on the 31st.
  for (let i = 0; i < 30; i += 1) {
    timers.intervals[0].cb();
    assert.equal(timers.intervals[0].cleared, undefined,
      `interval cleared too early at invocation ${i + 1}`);
  }
  // 31st invocation crosses the limit and clears.
  timers.intervals[0].cb();
  assert.equal(timers.intervals[0].cleared, true);
});