# Nav Vertical Drag Handle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users drag the right-edge conversation nav vertically via a dedicated top handle, with viewport-clamped movement and no cross-tab persistence.

**Architecture:** Keep the existing shared view boundary unchanged. Replace the center-position transform with a `--bro-chat-nav-top` variable, add a static `bro-chat-nav__handle` element to the nav container, and use Pointer Events inside `view.js` to update `nav.style.top` while the handle is captured. core lifecycle, entry, manifest, and platform adapters are untouched.

**Tech Stack:** Vanilla JavaScript, CSS template literal, Pointer Events API, Node.js 22 `node:test`.

## Global Constraints

- Modify only `contentScripts/nav/view.js`, `tests/nav/view.test.mjs`, `tests/nav/fake-dom.mjs`, and the row index assertions in `tests/nav/core.test.mjs` (DOM structure changes by adding a handle child).
- Do not modify `core.js`, `entry.js`, `manifest.json`, `platforms/*.js`, or `chrome.storage` usage.
- Remove `top: 50%` and `transform: translateY(-50%)` from the nav rule; keep `right: 20px` and `position: fixed`.
- Introduce a new handle class `bro-chat-nav__handle` as the first child of the nav container.
- Use Pointer Events only (`pointerdown` / `pointermove` / `pointerup` / `pointercancel`).
- Clamp nav top to `[8, innerHeight - navHeight - 8]` and call `setPointerCapture` on `pointerdown` and `releasePointerCapture` on release/cancel.
- During dragging, set `nav.style.transition = 'none'` and reset on release.
- Block text selection while dragging by calling `preventDefault` on `pointermove`.
- Preserve all existing visual and DOM contracts (nav id, row/item/line classes, render/setActive/clear API, no ES module changes).
- Follow TDD: tests must fail on the old code before the production changes.
- Keep the complete 20-test nav regression green.
- Use the `code-reviewer` agent after modifying code.
- Create local Conventional Commits only; do not push.

---

### Task 1: Add a Vertical Drag Handle Inside the Shared Nav View

**Files:**
- Modify: `tests/nav/view.test.mjs:11-63`
- Modify: `tests/nav/fake-dom.mjs`
- Modify: `tests/nav/core.test.mjs:42-86` (shift row index assertions by +1)
- Modify: `contentScripts/nav/view.js:14-117`

**Interfaces:**
- Consumes: existing `createNavView({ onSelect })` public API and its injected style tag `#bro-chat-right-edges-nav-style`.
- Produces: same public API plus a leading `<div class="bro-chat-nav__handle">` element appended to the nav container before any rows.

- [ ] **Step 1: Extend fake DOM with Pointer Events + capture no-ops**

In `tests/nav/fake-dom.mjs`, inside `FakeElement`, replace the existing `addEventListener` / `click` block:

```js
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  click() {
    (this.listeners.get('click') || []).forEach((listener) => listener());
  }
```

with:

```js
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  click() {
    (this.listeners.get('click') || []).forEach((listener) => listener());
  }

  pointerEvent(type, options = {}) {
    (this.listeners.get(type) || []).forEach((listener) => {
      listener({ type, pointerId: 1, ...options, preventDefault() {} });
    });
  }

  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() { return false; }
```

Add the matching `innerWidth` field to `FakeDocument` (line near `documentElement`):

```js
    this.documentElement = { clientHeight: 1000, clientWidth: 1024 };
```

- [ ] **Step 2: Write the failing drag-handle test (grab-offset formula)**

In `tests/nav/view.test.mjs`, after the existing duplicate-mount test, add a new test block. Place it after the closing `});` of `refuses to mount a second shared nav instance`:

```js
test('exposes a drag handle and lets pointer drag reposition the nav within the viewport', () => {
  const { document, window } = installBrowserGlobals();
  globalThis.window = window;
  globalThis.window.innerHeight = 800;
  const view = createNavView({ onSelect() {} });
  view.render(['first prompt', 'second prompt']);

  const nav = document.getElementById('bro-chat-right-edges-nav');
  const handle = nav.children[0];
  assert.equal(handle.className, 'bro-chat-nav__handle');

  // Nav is 60px tall; render() must not have wiped the handle.
  assert.equal(nav.children.length, 3);
  assert.equal(nav.children[1].className, 'bro-chat-nav__row');

  // Simulate the nav starting at top 100 for realistic clamp math.
  nav.rect = { top: 100, left: 0, width: 28, height: 60 };
  // Set startTop via the pointerdown handler reading getBoundingClientRect.
  // Drag from clientY 300 down to clientY 500: delta = 200, new top = 100 + 200 = 300.
  handle.pointerEvent('pointerdown', { clientY: 300 });
  handle.pointerEvent('pointermove', { clientY: 500 });
  assert.match(nav.style.transition, /none/);
  assert.equal(nav.style.top, '300px');

  // Clamp the upper edge to 8.
  handle.pointerEvent('pointermove', { clientY: -1000 });
  assert.equal(nav.style.top, '8px');

  // Clamp the lower edge to innerHeight - navHeight - 8 = 800 - 60 - 8 = 732.
  handle.pointerEvent('pointermove', { clientY: 5000 });
  assert.equal(nav.style.top, '732px');

  // Release the pointer and reset the temporary transition.
  handle.pointerEvent('pointerup', { clientY: 500 });
  assert.doesNotMatch(nav.style.transition, /none/);

  // The handle must survive a subsequent render (clear() must preserve it).
  view.render(['only']);
  assert.equal(nav.children[0].className, 'bro-chat-nav__handle');
  assert.equal(nav.children[1].className, 'bro-chat-nav__row');
  assert.equal(nav.children.length, 2);
});
```

- [ ] **Step 3: Run the view test and verify RED**

Run:

```bash
node --experimental-default-type=module --test tests/nav/view.test.mjs
```

Expected: the new test fails with at least one of:

- `handle.className` mismatch (no handle yet);
- `nav.style.top` undefined (no drag logic);
- `nav.style.transition` mismatch.

- [ ] **Step 4: Update the CSS template and add the handle**

In `contentScripts/nav/view.js`:

1. Add the new class constant below the existing class constants:

```js
const HANDLE_CLASS = 'bro-chat-nav__handle';
```

2. Replace the `#${NAV_ID} { ... }` rule:

```css
#${NAV_ID} {
  --bro-chat-nav-text: #0f1115;
  --bro-chat-nav-text-idle: rgba(15,17,21,0.55);
  --bro-chat-nav-bg: #ffffff;
  --bro-chat-nav-border: rgba(15,17,21,0.06);
  --bro-chat-nav-line-color: rgba(15,17,21,0.35);
  --bro-chat-nav-line-active: rgba(0, 60, 179, 0.82);
  position: fixed;
  right: 20px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 0;
  box-shadow: 0 1px 2px transparent, 0 1px 3px transparent;
  padding: 10px 0;
  width: 28px;
  transition: width 0.3s ease, background 0.3s ease,
              border-color 0.3s ease, box-shadow 0.3s ease;
  max-height: 70vh;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  z-index: 2147483647;
}
```

with:

```css
#${NAV_ID} {
  --bro-chat-nav-text: #0f1115;
  --bro-chat-nav-text-idle: rgba(15,17,21,0.55);
  --bro-chat-nav-bg: #ffffff;
  --bro-chat-nav-border: rgba(15,17,21,0.06);
  --bro-chat-nav-line-color: rgba(15,17,21,0.35);
  --bro-chat-nav-line-active: rgba(0, 60, 179, 0.82);
  position: fixed;
  right: 20px;
  top: 50%;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 0;
  box-shadow: 0 1px 2px transparent, 0 1px 3px transparent;
  padding: 10px 0;
  width: 28px;
  transition: width 0.3s ease, background 0.3s ease,
              border-color 0.3s ease, box-shadow 0.3s ease;
  max-height: 70vh;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  z-index: 2147483647;
  transform: translateY(-50%);
}
```

3. Add the new handle rules immediately after the existing `#${NAV_ID}:hover` rule:

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

4. In `createContainer()`, replace:

```js
function createContainer() {
  const nav = document.createElement('div');
  nav.id = NAV_ID;
  document.body.appendChild(nav);
  return nav;
}
```

with:

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

5. In `createNavView()`, replace the existing `clear` function and the `lines`/state variables block. Replace:

```js
  function clear() {
    nav.replaceChildren();
    lines.length = 0;
  }
```

with:

```js
  function clear() {
    // Preserve the drag handle (children[0]) across renders.
    while (nav.children.length > 1) {
      nav.removeChild(nav.lastChild);
    }
    lines.length = 0;
  }
```

6. Still in `createNavView()`, replace the `createContainer()` call and add the drag handlers. Replace:

```js
export function createNavView({ onSelect }) {
  if (document.getElementById(NAV_ID)) return null;
  injectStyle();
  const nav = createContainer();
  const lines = [];
```

with:

```js
export function createNavView({ onSelect }) {
  if (document.getElementById(NAV_ID)) return null;
  injectStyle();
  const { nav, handle } = createContainer();
  const lines = [];

  // Vertical drag: pointer move on the handle updates nav top with the
  // grab-offset formula (preserve the initial grab position). Position is
  // in-memory only; refresh resets to center.
  let dragState = null;
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    handle.classList.add('is-dragging');
    handle.setPointerCapture(event.pointerId);
    const rect = nav.getBoundingClientRect();
    dragState = {
      startY: event.clientY,
      startTop: rect.top,
    };
    nav.style.transition = 'none';
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
    if (handle.hasPointerCapture && handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
    handle.classList.remove('is-dragging');
    nav.style.transition = '';
    dragState = null;
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
```

7. The remaining `render` and `setActive` functions continue to reference `nav` and `lines`; no further changes are required beyond the `clear()` fix above.

- [ ] **Step 4.5: Shift core row index assertions by +1**

In `tests/nav/core.test.mjs`, the handle is now `children[0]`, so every row index shifts by one. Update the first test's row assertions:

- `nav.children.length === 2` becomes `nav.children.length === 3`.
- `nav.children[0].children[0].textContent` becomes `nav.children[1].children[0].textContent`.
- `nav.children[1].click()` becomes `nav.children[1].click()` (the active-line check needs `nav.children[1].children[1]` and `nav.children[0]` no longer exists, so update the line assertions to use `children[1]`).

The exact lines are in `tests/nav/core.test.mjs` around the `filters empty messages` test (lines 42-86). Shift every `nav.children[N]` to `nav.children[N+1]` and add `assert.equal(nav.children[0].className, 'bro-chat-nav__handle');` to confirm the handle. Do not change `createMessage`, `setQuerySelector`, or message-text semantics.

Also update the lifecycle tests in the same file that read `nav.children[0]` (e.g. click-lock, list disappearance) to use `nav.children[1]`.

- [ ] **Step 5: Run the focused view test and verify GREEN**

Run:

```bash
node --experimental-default-type=module --test tests/nav/view.test.mjs
```

Expected: 3 tests pass, 0 fail (original 2 + the new drag-handle test).

- [ ] **Step 6: Run the complete nav regression**

Run:

```bash
node --experimental-default-type=module --test \
  tests/nav/view.test.mjs \
  tests/nav/core.test.mjs \
  tests/nav/platform-configs.test.mjs \
  tests/nav/manifest-nav.test.mjs \
  tests/nav/platform-routing.test.mjs
```

Expected: 22 tests pass, 0 fail (was 21, +1 new drag test).

- [ ] **Step 7: Run static boundary and diff checks**

Run:

```bash
git diff --check
git diff --name-only
rg -n "translateY\(-50%\)|top: 50%" contentScripts/nav/view.js
rg -n "is-dragging" tests/nav/view.test.mjs
```

Expected:

- `git diff --check` emits no errors;
- `git diff --name-only` lists only `contentScripts/nav/view.js`, `tests/nav/view.test.mjs`, `tests/nav/fake-dom.mjs`, and `tests/nav/core.test.mjs`;
- `rg` for `translateY(-50%)` returns one match (the `transform: translateY(-50%)` line in the base rule for default centering);
- `rg` for `is-dragging` returns at least one match in the test.

- [ ] **Step 8: Run mandatory code review**

Invoke the `code-reviewer` agent with this scope:

```text
Review only the nav vertical drag-handle diff. Verify the approved exact CSS
class, layout change (top + transform), Pointer Events flow, clamp math,
isolation from row click/active/scroll, and absence of unrelated lifecycle or
adapter changes. Report actionable findings with file:line references.
Do not modify or push.
```

Resolve confirmed Critical/Important findings with a focused failing test and re-review. Record browser-only visual concerns separately; do not guess-edit without evidence.

- [ ] **Step 9: Commit locally**

Run:

```bash
git add contentScripts/nav/view.js tests/nav/view.test.mjs tests/nav/fake-dom.mjs tests/nav/core.test.mjs
git commit -m "feat(nav): add vertical drag handle to shared view" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Expected: one local commit. Do not push.

- [ ] **Step 10: Report completion evidence**

Report:

- changed rules and handle flow;
- focused test and full-suite counts;
- code-review findings and outcomes;
- working-tree status and local commit hash;
- any skipped browser verification;
- explicit confirmation that no push was performed.
