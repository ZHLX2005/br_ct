# Nav Compact Height Styling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shared right-edge nav respond faster, use denser vertical spacing, and stay within 70% of the viewport with hidden-scrollbar internal scrolling.

**Architecture:** Keep the existing shared-view boundary unchanged. Extend the CSS assertions in `tests/nav/view.test.mjs`, then update only the `NAV_CSS` template in `contentScripts/nav/view.js`; core lifecycle, manifest Path A injection, entry routing, and platform adapters remain untouched.

**Tech Stack:** Vanilla JavaScript, CSS template literal, Node.js 22 built-in `node:test`.

## Global Constraints

- Modify only `contentScripts/nav/view.js` and `tests/nav/view.test.mjs`.
- Do not modify core lifecycle, entry, manifest, background injection, platform adapters, or selectors.
- Item opacity and transform transitions must be `0.2s ease`.
- Item max-width transition must be `0.28s ease`.
- Nav gap must be `4px`.
- Nav vertical padding must be `10px` (`padding: 10px 0`).
- Row padding must be `4px 8px 4px 14px`.
- Nav maximum height must be `70vh`.
- Nav must use `overflow-x: hidden` and `overflow-y: auto`; the old shorthand `overflow: hidden` must be removed.
- Scrollbars must be hidden with `scrollbar-width: none` and a WebKit scrollbar rule.
- Preserve font size `13px`, line-height `18px`, idle line `12px × 4px`, active line `20px`, nav right offset `20px`, idle width `28px`, hover max-width `360px`, active blue, DOM structure, and public view API.
- Follow TDD: tests must fail for the old values before production CSS changes.
- Run the complete 20-test nav regression plus the updated view test.
- Use the `code-reviewer` agent after modifying code.
- Create local Conventional Commits only; do not push.

---

### Task 1: Make the Shared Nav Faster, Denser, and Height-Bounded

**Files:**
- Modify: `tests/nav/view.test.mjs:11-35`
- Modify: `contentScripts/nav/view.js:14-96`

**Interfaces:**
- Consumes: existing `createNavView({ onSelect })` and its injected style tag `#bro-chat-right-edges-nav-style`.
- Produces: the same `createNavView({ onSelect }): { render, setActive, clear } | null` API and unchanged nav DOM classes.

- [ ] **Step 1: Add failing CSS contract assertions**

In `tests/nav/view.test.mjs`, extend the first test immediately after `assert.doesNotMatch(style.textContent, /:root/);` with:

```js
  assert.match(style.textContent, /padding:\s*10px 0/);
  assert.match(style.textContent, /gap:\s*4px/);
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
    /\.bro-chat-nav__row\s*\{[\s\S]*padding:\s*4px 8px 4px 14px/
  );
  assert.match(
    style.textContent,
    /transition:\s*opacity 0\.2s ease,\s*transform 0\.2s ease,\s*max-width 0\.28s ease/
  );
  assert.doesNotMatch(style.textContent, /overflow:\s*hidden/);
  assert.doesNotMatch(style.textContent, /opacity 0\.8s/);
```

Keep all existing structure, click-index, active, clear, and duplicate-mount assertions unchanged.

- [ ] **Step 2: Run the view test and verify RED**

Run:

```bash
node --experimental-default-type=module --test tests/nav/view.test.mjs
```

Expected: the first test fails because the current CSS still contains `padding: 16px 0`, `gap: 10px`, `overflow: hidden`, row padding `6px 8px 6px 14px`, and `0.8s` item transitions; the duplicate-mount test still passes.

- [ ] **Step 3: Implement the minimal CSS changes**

In `contentScripts/nav/view.js`, update only `NAV_CSS`:

1. Replace:

```css
  padding: 16px 0;
```

with:

```css
  padding: 10px 0;
```

2. Replace:

```css
  overflow: hidden;
```

with:

```css
  max-height: 70vh;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: none;
```

3. Replace:

```css
  gap: 10px;
```

with:

```css
  gap: 4px;
```

4. Immediately after the closing brace of the base `#${NAV_ID}` rule, add:

```css
#${NAV_ID}::-webkit-scrollbar {
  display: none;
}
```

5. Replace row padding:

```css
  padding: 6px 8px 6px 14px;
```

with:

```css
  padding: 4px 8px 4px 14px;
```

6. Replace the item transition:

```css
  transition: opacity 0.8s ease, transform 0.8s ease, max-width 0.8s ease;
```

with:

```css
  transition: opacity 0.2s ease, transform 0.2s ease, max-width 0.28s ease;
```

Do not change any JavaScript function, DOM class, line size, font metrics, width, color, or active rule.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
node --experimental-default-type=module --test tests/nav/view.test.mjs
```

Expected: 2 tests pass, 0 fail.

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

Expected: 20 tests pass, 0 fail.

- [ ] **Step 6: Run static boundary and diff checks**

Run:

```bash
git diff --check
git diff --name-only
rg -n "padding: 16px 0|gap: 10px|overflow: hidden|opacity 0\.8s" \
  contentScripts/nav/view.js
```

Expected:

- `git diff --check` emits no errors;
- `git diff --name-only` lists only `contentScripts/nav/view.js` and `tests/nav/view.test.mjs`;
- `rg` emits no output.

- [ ] **Step 7: Run mandatory code review**

Invoke the `code-reviewer` agent with this scope:

```text
Review only the nav compact-height style diff. Verify the approved exact values,
CSS overflow/scrollbar behavior, unchanged view API/DOM structure, host CSS
isolation, test quality, and absence of unrelated lifecycle/adapter changes.
Report actionable findings with file:line references. Do not modify or push.
```

Resolve confirmed Critical/Important findings with a focused failing test and re-review. Record browser-only visual concerns separately; do not guess-edit without evidence.

- [ ] **Step 8: Commit locally**

Run:

```bash
git add contentScripts/nav/view.js tests/nav/view.test.mjs
git commit -m "style(nav): tighten spacing and bound nav height" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Expected: one local commit. Do not push.

- [ ] **Step 9: Report completion evidence**

Report:

- changed values;
- focused test and full-suite counts;
- code-review findings and outcomes;
- working-tree status and local commit hash;
- any skipped browser verification;
- explicit confirmation that no push was performed.
