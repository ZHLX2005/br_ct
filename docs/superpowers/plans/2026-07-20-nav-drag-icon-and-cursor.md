# Nav Drag Handle Icon and Whole-Nav Cursor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain drag-handle rectangle with a three-line icon and let the entire nav (except rows) act as a drag surface while still allowing row click.

**Architecture:** Extend the shared view CSS to draw three `bro-chat-nav__handle-bar` spans inside the handle and add `cursor: pointer` to the base nav rule. Move the four Pointer Event listeners from the handle to the nav itself; inside `pointerdown`, short-circuit when `event.target.closest('.bro-chat-nav__row')` matches so row click behavior is preserved. All changes are inside `view.js`; core lifecycle, entry, manifest, and platform adapters stay untouched.

**Tech Stack:** Vanilla JavaScript, CSS template literal, Pointer Events API, Node.js 22 `node:test`.

## Global Constraints

- Modify only `contentScripts/nav/view.js` and `tests/nav/view.test.mjs`.
- Do not modify `core.js`, `entry.js`, `manifest.json`, `platforms/*.js`, or `chrome.storage` usage.
- Add 3 `<span class="bro-chat-nav__handle-bar">` children inside `bro-chat-nav__handle`; each bar 10px × 1.5px, 1px border-radius, gap 1px.
- Bar color defaults to `rgba(15,17,21,0.45)`; on nav hover/dragging switches to `rgba(0, 60, 179, 0.7)`.
- Remove the `cursor: ns-resize` on the handle and add `cursor: pointer` to the base nav rule; `cursor: grabbing` on nav when `.is-dragging` is set.
- Move `pointerdown / pointermove / pointerup / pointercancel` listeners from the handle to the nav.
- In `pointerdown`, if `event.target.closest('.bro-chat-nav__row')` matches, return early so row click behavior is preserved; otherwise enter drag.
- Update `setPointerCapture`/`releasePointerCapture` to target the nav.
- Add `.is-dragging` to the nav (not just the handle) and preserve the existing transform/transition reset logic.
- Follow TDD: tests must fail on the old code before the production changes.
- Keep the complete 22-test nav regression green.
- Use the `code-reviewer` agent after modifying code.
- Create local Conventional Commits only; do not push.

---

### Task 1: Three-Line Handle Icon and Whole-Nav Drag Surface

**Files:**
- Modify: `tests/nav/view.test.mjs:1-138`
- Modify: `contentScripts/nav/view.js:1-220`

**Interfaces:**
- Consumes: existing `createNavView({ onSelect })` public API and injected style tag `#bro-chat-right-edges-nav-style`.
- Produces: same public API; the handle now has 3 bar spans; the nav itself accepts pointer events; row clicks still call `onSelect(index)`.

- [ ] **Step 1: Write the failing tests for the new icon and row-skip behavior**

In `tests/nav/view.test.mjs`, update the existing `'exposes a drag handle and lets pointer drag reposition the nav within the viewport'` test (around lines 77-123) to assert the new behavior, and add a dedicated row-skip test. After the updated existing test, add the new test.

Replace the existing test (the whole `test('exposes a drag handle ...', () => { ... });` block) with:

```js
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
  handle.pointerEvent('pointerdown', { clientY: 300 });
  assert.equal(handle.classList.contains('is-dragging'), true);
  assert.equal(nav.style.transform, 'none');
  handle.pointerEvent('pointermove', { clientY: 500 });
  assert.equal(nav.style.top, '300px');

  handle.pointerEvent('pointerup', { clientY: 500 });
  assert.equal(handle.classList.contains('is-dragging'), false);
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

  // Dispatch pointerdown targeted at the row; the listener must short-circuit.
  firstRow.pointerEvent('pointerdown', { clientY: 100, clientX: 0 });
  firstRow.pointerEvent('pointermove', { clientY: 500, clientX: 0 });
  // No drag means no transform/transition change and no top.
  assert.notEqual(nav.style.transform, 'none');
  assert.equal(nav.style.top, '');

  // Click still works.
  firstRow.click();
  assert.deepEqual(selected, [0]);
});
```

The existing `'clear() preserves the handle across a shrinking re-render'` test should keep passing unchanged.

- [ ] **Step 2: Run the view test and verify RED**

Run:

```bash
node --experimental-default-type=module --test tests/nav/view.test.mjs
```

Expected: at least one new test fails. The first new test fails because:

- `handle.children.length` returns 0 today (no bar spans exist yet);
- the bar class assertion cannot match;
- the drag-surface move from the handle may now short-circuit if listeners were already moved (it depends on order — if listeners were not moved, the test passes; RED is guaranteed by the row-skip test below).

The row-skip test fails because the current handler starts drag for any pointerdown on the handle (and after we move listeners to the nav, also on the row), so `nav.style.transform` becomes `none` and `nav.style.top` becomes `500px`, contradicting the asserts above.

- [ ] **Step 3: Update CSS and pointer listeners in `view.js`**

In `contentScripts/nav/view.js`:

1. Add a new class constant below the existing ones:

```js
const HANDLE_BAR_CLASS = 'bro-chat-nav__handle-bar';
```

2. Replace the existing `.${HANDLE_CLASS} { ... }` block:

```css
.${HANDLE_CLASS} {
  width: 16px;
  height: 6px;
  margin: 0 8px 4px 0;
  border-radius: 3px;
  background: transparent;
  cursor: ns-resize;
  align-self: flex-end;
  flex-shrink: 0;
  transition: background 0.2s ease;
}
#${NAV_ID}:hover .${HANDLE_CLASS} {
  background: rgba(15,17,21,0.08);
}
.${HANDLE_CLASS}:hover,
.${HANDLE_CLASS}.is-dragging {
  background: rgba(0, 60, 179, 0.18);
}
.${HANDLE_CLASS}.is-dragging {
  cursor: grabbing;
}
```

with:

```css
.${HANDLE_CLASS} {
  width: 16px;
  height: 6px;
  margin: 0 8px 4px 0;
  border-radius: 3px;
  background: transparent;
  align-self: flex-end;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  align-items: center;
  justify-content: center;
}
.${HANDLE_BAR_CLASS} {
  width: 10px;
  height: 1.5px;
  border-radius: 1px;
  background: rgba(15,17,21,0.45);
  flex-shrink: 0;
  transition: background 0.2s ease;
}
#${NAV_ID}:hover .${HANDLE_BAR_CLASS} {
  background: rgba(0, 60, 179, 0.7);
}
#${NAV_ID}.is-dragging .${HANDLE_BAR_CLASS} {
  background: rgba(0, 60, 179, 0.7);
}
```

3. Add `cursor: pointer` to the base `#${NAV_ID} { ... }` rule, immediately after the existing `gap: 4px;` line (or in any other property slot; keep indentation consistent):

```css
  gap: 4px;
  cursor: pointer;
```

4. Add the dragging cursor after the `gap: 4px; cursor: pointer;` lines:

```css
#${NAV_ID}.is-dragging {
  cursor: grabbing;
}
```

5. Replace the existing `createContainer()` function:

```js
function createContainer() {
  const nav = document.createElement('div');
  nav.id = NAV_ID;
  document.body.appendChild(nav);
  const handle = document.createElement('div');
  handle.className = HANDLE_CLASS;
  nav.appendChild(handle);
  return { nav, handle };
}
```

with (add three bar spans as children of the handle):

```js
function createContainer() {
  const nav = document.createElement('div');
  nav.id = NAV_ID;
  document.body.appendChild(nav);
  const handle = document.createElement('div');
  handle.className = HANDLE_CLASS;
  for (let i = 0; i < 3; i += 1) {
    const bar = document.createElement('span');
    bar.className = HANDLE_BAR_CLASS;
    handle.appendChild(bar);
  }
  nav.appendChild(handle);
  return { nav, handle };
}
```

6. Replace the existing pointer listener block (the four `addEventListener` calls and the `endDrag` closure) inside `createNavView()`:

```js
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    handle.classList.add('is-dragging');
    handle.setPointerCapture(event.pointerId);
    const rect = nav.getBoundingClientRect();
    // getBoundingClientRect().top reports the post-transform visual top.
    // The CSS rule still applies `transform: translateY(-50%)`, so we strip
    // it during drag so the box-top (nav.style.top) lines up with the visual
    // top — otherwise the 8px clamp is actually ~30px off the viewport edge.
    nav.style.transform = 'none';
    nav.style.transition = 'none';
    dragState = {
      startY: event.clientY,
      startTop: rect.top,
    };
  });
  handle.addEventListener('pointermove', (event) => {
    if (!dragState) return;
    event.preventDefault();
    const next = dragState.startTop + (event.clientY - dragState.startY);
    const maxTop = Math.max(8, window.innerHeight - nav.offsetHeight - 8);
    const clamped = Math.min(Math.max(8, next), maxTop);
    nav.style.top = `${clamped}px`;
  });
  const endDrag = (event) => {
    if (!dragState) return;
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
    handle.classList.remove('is-dragging');
    nav.style.transition = '';
    nav.style.transform = '';
    dragState = null;
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
```

with (target the nav instead of the handle, add the row short-circuit, and track dragging class on the nav):

```js
  nav.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest(`.${ROW_CLASS}`)) return;
    nav.classList.add('is-dragging');
    nav.setPointerCapture(event.pointerId);
    const rect = nav.getBoundingClientRect();
    // getBoundingClientRect().top reports the post-transform visual top.
    // The CSS rule still applies `transform: translateY(-50%)`, so we strip
    // it during drag so the box-top (nav.style.top) lines up with the visual
    // top — otherwise the 8px clamp is actually ~30px off the viewport edge.
    nav.style.transform = 'none';
    nav.style.transition = 'none';
    dragState = {
      startY: event.clientY,
      startTop: rect.top,
    };
  });
  nav.addEventListener('pointermove', (event) => {
    if (!dragState) return;
    event.preventDefault();
    const next = dragState.startTop + (event.clientY - dragState.startY);
    const maxTop = Math.max(8, window.innerHeight - nav.offsetHeight - 8);
    const clamped = Math.min(Math.max(8, next), maxTop);
    nav.style.top = `${clamped}px`;
  });
  const endDrag = (event) => {
    if (!dragState) return;
    if (nav.hasPointerCapture(event.pointerId)) {
      nav.releasePointerCapture(event.pointerId);
    }
    nav.classList.remove('is-dragging');
    nav.style.transition = '';
    nav.style.transform = '';
    dragState = null;
  };
  nav.addEventListener('pointerup', endDrag);
  nav.addEventListener('pointercancel', endDrag);
```

7. The `clear()` and `render` functions remain unchanged: the handle now contains its three bar spans and `clear()`'s existing `while (nav.children.length > 1) nav.removeChild(nav.lastChild)` still preserves `children[0]` (the handle, with its bars intact).

- [ ] **Step 4: Run the focused view test and verify GREEN**

Run:

```bash
node --experimental-default-type=module --test tests/nav/view.test.mjs
```

Expected: 5 tests pass, 0 fail (renders-the-shared-nav-structure + refuses-a-second-instance + drag-handle-icon + row-skip + clear-preserves-handle).

- [ ] **Step 5: Run the complete nav regression**

Run:

```bash
node --experimental-default-type=module --test \
  tests/nav/view.test.mjs \
  tests/nav/core.test.mjs \
  tests/nav/platform-configs.test.mjs \
  tests/nav/manifest-nav.test.mjs \
  tests/nav/platform-routing.test.mjs
```

Expected: 23 tests pass, 0 fail (was 22, +1 new row-skip test).

- [ ] **Step 6: Run static boundary and diff checks**

Run:

```bash
git diff --check
git diff --name-only
rg -n "bro-chat-nav__handle-bar" contentScripts/nav/view.js
rg -n "cursor: pointer" contentScripts/nav/view.js
rg -n "cursor: grabbing" contentScripts/nav/view.js
rg -n "ns-resize" contentScripts/nav/view.js
```

Expected:

- `git diff --check` emits no errors;
- `git diff --name-only` lists only `contentScripts/nav/view.js` and `tests/nav/view.test.mjs`;
- the first three `rg` commands return at least one match each;
- the `ns-resize` `rg` returns no output (the old handle cursor must be gone).

- [ ] **Step 7: Run mandatory code review**

Invoke the `code-reviewer` agent with this scope:

```text
Review only the nav drag handle icon and whole-nav cursor diff. Verify the
approved three-line icon CSS, listener migration from handle to nav, row
short-circuit via event.target.closest, .is-dragging on the nav, cursor
pointer/grabbing, and absence of unrelated lifecycle or adapter changes.
Report actionable findings with file:line references. Do not modify or push.
```

Resolve confirmed Critical/Important findings with a focused failing test and re-review. Record browser-only visual concerns separately; do not guess-edit without evidence.

- [ ] **Step 8: Commit locally**

Run:

```bash
git add contentScripts/nav/view.js tests/nav/view.test.mjs
git commit -m "feat(nav): draw three-line drag handle and whole-nav cursor" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Expected: one local commit. Do not push.

- [ ] **Step 9: Report completion evidence**

Report:

- changed CSS rules and listener migration;
- focused test and full-suite counts;
- code-review findings and outcomes;
- working-tree status and local commit hash;
- any skipped browser verification;
- explicit confirmation that no push was performed.
