import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { createNavView } from '../../contentScripts/nav/view.js';
import { installBrowserGlobals, resetBrowserGlobals } from './fake-dom.mjs';

afterEach(() => {
  resetBrowserGlobals();
});

test('renders the shared nav structure and reports compact click indexes', () => {
  const { document } = installBrowserGlobals();
  const selected = [];
  const view = createNavView({ onSelect: (index) => selected.push(index) });

  assert.ok(view);
  view.render(['first prompt', 'second prompt']);

  const nav = document.getElementById('bro-chat-right-edges-nav');
  const style = document.getElementById('bro-chat-right-edges-nav-style');
  assert.ok(nav);
  assert.ok(style);
  assert.match(style.textContent, /right:\s*20px/);
  assert.match(style.textContent, /--bro-chat-nav-line-active:\s*rgba\(0, 60, 179, 0\.82\)/);
  assert.doesNotMatch(style.textContent, /:root/);
  assert.match(style.textContent, /padding:\s*10px 0/);
  assert.match(style.textContent, /gap:\s*2px/);
  assert.match(style.textContent, /max-height:\s*70vh/);
  assert.match(style.textContent, /overflow-x:\s*hidden/);
  assert.match(style.textContent, /overflow-y:\s*auto/);
  assert.match(style.textContent, /scrollbar-width:\s*none/);
  assert.match(
    style.textContent,
    /#bro-chat-right-edges-nav::\-webkit-scrollbar\s*\{[\s\S]*display:\s*none/
  );
  assert.match(
    style.textContent,
    /\.bro-chat-nav__row\s*\{[\s\S]*padding:\s*1px 8px 1px 14px/
  );
  assert.match(
    style.textContent,
    /transition:\s*opacity 0\.2s ease,\s*transform 0\.2s ease,\s*max-width 0\.28s ease/
  );
  assert.doesNotMatch(style.textContent, /opacity 0\.8s/);
  assert.equal(nav.children.length, 3);

  const handle = nav.children[0];
  assert.equal(handle.className, 'bro-chat-nav__handle');

  const secondRow = nav.children[2];
  assert.equal(secondRow.className, 'bro-chat-nav__row');
  assert.equal(secondRow.children[0].className, 'bro-chat-nav__item');
  assert.equal(secondRow.children[0].textContent, 'second prompt');
  assert.equal(secondRow.children[1].className, 'bro-chat-nav__line');

  secondRow.click();
  assert.deepEqual(selected, [1]);

  view.setActive(1);
  assert.equal(nav.children[1].children[1].classList.contains('is-active'), false);
  assert.equal(nav.children[2].children[1].classList.contains('is-active'), true);

  view.clear();
  assert.equal(nav.children.length, 1);
  assert.equal(nav.children[0].className, 'bro-chat-nav__handle');
});

test('line is slimmer while active width and color are unchanged', () => {
  const { document } = installBrowserGlobals();
  createNavView({ onSelect() {} });
  const style = document.getElementById('bro-chat-right-edges-nav-style');
  assert.ok(style);
  assert.match(
    style.textContent,
    /\.bro-chat-nav__line\s*\{[\s\S]*width:\s*12px[\s\S]*height:\s*2px[\s\S]*border-radius:\s*1px/
  );
  assert.match(
    style.textContent,
    /\.bro-chat-nav__line\.is-active\s*\{[\s\S]*width:\s*20px[\s\S]*background:\s*var\(--bro-chat-nav-line-active\)/
  );
});

test('refuses to mount a second shared nav instance', () => {
  installBrowserGlobals();
  const first = createNavView({ onSelect() {} });
  const second = createNavView({ onSelect() {} });

  assert.ok(first);
  assert.equal(second, null);
});

test('drag handle renders a three-line icon and the nav accepts drag for handle/empty space', () => {
  const { document, window } = installBrowserGlobals();
  globalThis.window = window;
  globalThis.window.innerHeight = 800;
  const view = createNavView({ onSelect() {} });
  view.render(['first prompt', 'second prompt']);

  const nav = document.getElementById('bro-chat-right-edges-nav');
  const handle = nav.children[0];
  assert.equal(handle.className, 'bro-chat-nav__handle');
  const bars = handle.children;
  assert.equal(bars.length, 3);
  for (let i = 0; i < bars.length; i += 1) {
    assert.equal(bars[i].className, 'bro-chat-nav__handle-bar');
  }

  nav.rect = { top: 100, left: 0, width: 28, height: 60 };
  nav.offsetHeight = 60;

  // Drag from a row would be skipped: assert via the dedicated row-skip test.
  nav.pointerEvent('pointerdown', { clientY: 300 });
  assert.equal(nav.classList.contains('is-dragging'), true);
  assert.equal(nav.style.transform, 'none');
  nav.pointerEvent('pointermove', { clientY: 500 });
  assert.equal(nav.style.top, '300px');

  // Clamp the upper edge to 8.
  nav.pointerEvent('pointermove', { clientY: -1000 });
  assert.equal(nav.style.top, '8px');

  // Clamp the lower edge to innerHeight - navHeight - 8 = 800 - 60 - 8 = 732.
  nav.pointerEvent('pointermove', { clientY: 5000 });
  assert.equal(nav.style.top, '732px');

  nav.pointerEvent('pointerup', { clientY: 500 });
  assert.equal(nav.classList.contains('is-dragging'), false);
  assert.equal(nav.style.transform, '');
});

test('pointerdown on a row does not start a drag and lets row click fire', () => {
  const { document } = installBrowserGlobals();
  const selected = [];
  const view = createNavView({ onSelect: (index) => selected.push(index) });
  view.render(['first prompt', 'second prompt']);

  const nav = document.getElementById('bro-chat-right-edges-nav');
  const firstRow = nav.children[1];
  assert.equal(firstRow.className, 'bro-chat-nav__row');

  // Dispatch pointerdown on the nav with event.target set to the row, so
  // the nav-level listener receives the event and the `closest` short-circuit
  // is exercised end-to-end. (fake-dom does not bubble, so we dispatch
  // directly on the registered target.)
  nav.pointerEvent('pointerdown', { target: firstRow, clientY: 100, clientX: 0 });
  nav.pointerEvent('pointermove', { target: firstRow, clientY: 500, clientX: 0 });
  // No drag means no transform/transition change and no top.
  assert.notEqual(nav.style.transform, 'none');
  assert.equal(nav.style.top, '');

  // Click still works.
  firstRow.click();
  assert.deepEqual(selected, [0]);
});

test('clear() preserves the handle across a shrinking re-render', () => {
  const { document } = installBrowserGlobals();
  const view = createNavView({ onSelect() {} });
  view.render(['a', 'b', 'c']);

  const nav = document.getElementById('bro-chat-right-edges-nav');
  assert.equal(nav.children.length, 4);
  assert.equal(nav.children[0].className, 'bro-chat-nav__handle');

  view.render(['only label']);
  assert.equal(nav.children.length, 2);
  assert.equal(nav.children[0].className, 'bro-chat-nav__handle');
  assert.equal(nav.children[1].className, 'bro-chat-nav__row');
});

test('export button renders at bottom and fires onExport callback', () => {
  const { document } = installBrowserGlobals();
  let exportCalled = false;
  const view = createNavView({
    onSelect() {},
    onExport: () => { exportCalled = true; },
  });
  view.render(['msg']);

  const nav = document.getElementById('bro-chat-right-edges-nav');
  const exportBtn = nav.querySelector('.bro-chat-nav__export');
  assert.ok(exportBtn, 'export button exists');
  assert.equal(exportBtn.textContent, '导出');

  // CSS: hidden by default, visible on nav hover
  const style = document.getElementById('bro-chat-right-edges-nav-style');
  assert.match(style.textContent, /\.bro-chat-nav__export\s*\{[\s\S]*display:\s*none/);
  assert.match(
    style.textContent,
    /#bro-chat-right-edges-nav:hover \.bro-chat-nav__export\s*\{[\s\S]*display:\s*flex/
  );

  // Click triggers callback
  exportBtn.click();
  assert.equal(exportCalled, true);
});

test('export button does not prevent row click after it is added', () => {
  const { document } = installBrowserGlobals();
  const selected = [];
  const view = createNavView({ onSelect: (i) => selected.push(i), onExport() {} });
  view.render(['a', 'b']);

  const nav = document.getElementById('bro-chat-right-edges-nav');
  // rows come before export button
  nav.children[1].click();
  assert.deepEqual(selected, [0]);
});

test('clear() preserves both handle and export button', () => {
  const { document } = installBrowserGlobals();
  const view = createNavView({ onSelect() {}, onExport() {} });
  view.render(['a', 'b']);

  const nav = document.getElementById('bro-chat-right-edges-nav');
  assert.equal(nav.children.length, 4); // handle + 2 rows + export

  view.clear();
  assert.equal(nav.children.length, 2); // handle + export only
  assert.equal(nav.children[0].className, 'bro-chat-nav__handle');
  assert.equal(nav.children[1].className, 'bro-chat-nav__export');
});