# Nav Tighter Row Spacing and Thinner Line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the nav by shrinking row vertical padding, halving the inter-row gap, and making the idle/active line slimmer while keeping the existing active-blue width transition.

**Architecture:** Update only the CSS template inside `contentScripts/nav/view.js` and extend `tests/nav/view.test.mjs` with the new exact-value assertions. No JS, no DOM, no selector, no lifecycle, and no behavior changes.

**Tech Stack:** Vanilla JavaScript, CSS template literal, Node.js 22 `node:test`.

## Global Constraints

- Modify only `contentScripts/nav/view.js` and `tests/nav/view.test.mjs`.
- Do not modify `core.js`, `entry.js`, `manifest.json`, `platforms/*.js`, or any other test file.
- Row padding: `4px 8px 4px 14px` → `1px 8px 1px 14px`.
- Container gap: `4px` → `2px`.
- Line height: `4px` → `2px`.
- Line border-radius: `2px` → `1px`.
- Line width stays `12px`; active width stays `20px`; active color stays `rgba(0, 60, 179, 0.82)`.
- Follow TDD: tests must fail on old CSS, pass after CSS changes.
- Keep the complete 23-test nav regression green.
- Use the `code-reviewer` agent after modifying code.
- Create local Conventional Commits only; do not push.

---

### Task 1: Tighten Row Spacing and Thin the Line

**Files:**
- Modify: `tests/nav/view.test.mjs:38-43`
- Modify: `contentScripts/nav/view.js:42, 93, 100-108`

**Interfaces:**
- Consumes: existing `createNavView` and its injected `#bro-chat-right-edges-nav-style`.
- Produces: same public API with updated CSS; no JS, no DOM, no selector changes.

- [ ] **Step 1: Update the existing view CSS assertions to expect the new values**

In `tests/nav/view.test.mjs`, inside the first test (`'renders the shared nav structure and reports compact click indexes'`), replace these three `assert.match` lines:

```js
  assert.match(style.textContent, /gap:\s*4px/);
  assert.match(
    style.textContent,
    /\.bro-chat-nav__row\s*\{[\s\S]*padding:\s*4px 8px 4px 14px/
  );
```

with:

```js
  assert.match(style.textContent, /gap:\s*2px/);
  assert.match(
    style.textContent,
    /\.bro-chat-nav__row\s*\{[\s\S]*padding:\s*1px 8px 1px 14px/
  );
```

Then add a focused test for the line and active line dimensions. Immediately after the first test block (after the closing `});`), add a new test:

```js
test('line is slimmer while active width and color are unchanged', () => {
  const { document } = installBrowserGlobals();
  createNavView({ onSelect() {} });
  const style = document.getElementById('bro-chat-right-edges-nav-style');
  assert.ok(style);
  assert.match(
    style.textContent,
    /\.bro-chat-nav__line\s*\{[\s\S]*height:\s*2px[\s\S]*border-radius:\s*1px[\s\S]*width:\s*12px/
  );
  assert.match(
    style.textContent,
    /\.bro-chat-nav__line\.is-active\s*\{[\s\S]*width:\s*20px[\s\S]*background:\s*rgba\(0, 60, 179, 0\.82\)/
  );
});
```

- [ ] **Step 2: Run the view test and verify RED**

Run:

```bash
node --experimental-default-type=module --test tests/nav/view.test.mjs
```

Expected: the first test fails on `gap: 2px` and `padding: 1px 8px 1px 14px`; the new line test fails on `height: 2px`.

- [ ] **Step 3: Apply the CSS changes in `view.js`**

In `contentScripts/nav/view.js`:

1. Replace `gap: 4px;` in the base `#${NAV_ID}` rule with `gap: 2px;`.

2. Replace the `.${ROW_CLASS}` rule's `padding: 4px 8px 4px 14px;` with `padding: 1px 8px 1px 14px;`.

3. Replace the `.${LINE_CLASS}` rule:

```css
.${LINE_CLASS} {
  display: block;
  width: 12px;
  height: 4px;
  background: var(--bro-chat-nav-line-color);
  border-radius: 2px;
  flex-shrink: 0;
  transition: width 0.3s ease, background 0.2s ease;
}
```

with:

```css
.${LINE_CLASS} {
  display: block;
  width: 12px;
  height: 2px;
  background: var(--bro-chat-nav-line-color);
  border-radius: 1px;
  flex-shrink: 0;
  transition: width 0.3s ease, background 0.2s ease;
}
```

Do not modify anything else in `view.js` (no handle rules, no view.js CSS, no JavaScript).

- [ ] **Step 4: Run the focused view test and verify GREEN**

Run:

```bash
node --experimental-default-type=module --test tests/nav/view.test.mjs
```

Expected: 6 tests pass, 0 fail (5 existing + 1 new line-dimension test).

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

Expected: 24 tests pass, 0 fail (was 23, +1 new line test).

- [ ] **Step 6: Run static boundary and diff checks**

Run:

```bash
git diff --check
git diff --name-only
rg -n "gap: 2px" contentScripts/nav/view.js
rg -n "height: 2px" contentScripts/nav/view.js
rg -n "padding: 1px 8px 1px 14px" contentScripts/nav/view.js
```

Expected:

- `git diff --check` emits no errors;
- `git diff --name-only` lists only `contentScripts/nav/view.js` and `tests/nav/view.test.mjs`;
- the three `rg` commands return at least one match each.

- [ ] **Step 7: Run mandatory code review**

Invoke the `code-reviewer` agent with this scope:

```text
Review only the nav tighter spacing and slimmer line diff. Verify the
approved exact CSS values (row padding 1px, gap 2px, line height 2px and
border-radius 1px), preserved active width and color, and absence of
unrelated lifecycle, JS, DOM, or adapter changes. Report actionable findings
with file:line references. Do not modify or push.
```

Resolve confirmed Critical/Important findings with a focused failing test and re-review. Record browser-only visual concerns separately; do not guess-edit without evidence.

- [ ] **Step 8: Commit locally**

Run:

```bash
git add contentScripts/nav/view.js tests/nav/view.test.mjs
git commit -m "style(nav): tighten row spacing and thin the idle line" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Expected: one local commit. Do not push.

- [ ] **Step 9: Report completion evidence**

Report:

- changed CSS values;
- focused test and full-suite counts;
- code-review findings and outcomes;
- working-tree status and local commit hash;
- any skipped browser verification;
- explicit confirmation that no push was performed.
