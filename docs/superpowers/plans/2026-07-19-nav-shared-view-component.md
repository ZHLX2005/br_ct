# Nav Shared View Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or **superpowers:executing-plans** to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one runtime view component the sole source of nav CSS/DOM while reducing each platform adapter to selectors and optional text extraction data.

**Architecture:** The final architecture is Path A: `manifest.json` injects one classic `contentScripts/nav/entry.js` at `document_idle` for all supported platform hosts. `entry.js` routes by URL, reads the nav toggle, and dynamically imports the platform adapter plus `core.js`; `core.js` owns message/lifecycle state and drives `view.js`; `view.js` owns all nav CSS and DOM. `backgroudtask/platformScriptFiles.js` remains sendMessage-only.

**Tech Stack:** Chrome MV3, vanilla browser ES modules, Node.js 22 `node:test`, gstack `/browse` for live browser verification.

## Global Constraints

- Do not push any commit.
- `contentScripts/nav/view.js` is the only runtime source of nav CSS and row/item/line DOM.
- `contentScripts/nav/core.js` owns platform message data, scrolling, active state, and observers; it must not create nav presentation DOM or inject CSS.
- Platform adapters expose only `itemSel`, `listSel`, `textSel`, and optional `extractText`.
- All platforms use active blue `rgba(0, 60, 179, 0.82)`; adapters do not carry `navId` or `activeColor`.
- Preserve `right: 20px`, idle width `28px`, hover max-width `360px`, line `12px × 4px`, active line width `20px`, 800ms click lock, 30% visibility threshold, `-30%` root margin, 60ms rebuild debounce, and 30 × 300ms startup polling.
- CSS variables are scoped under `#bro-chat-right-edges-nav`, never `:root`.
- Manifest nav injection is resident and must not depend on background service-worker timing.
- `platformScriptFiles.js` returns only `contentScripts/<platform>.js`; it does not append nav entry or maintain nav settings cache.
- `entry.js` is the only classic nav script; `core.js`, `view.js`, and platform adapters load through dynamic `import()`.
- All live browser interaction uses gstack `/browse`.

## Current File Responsibilities

- `manifest.json`: one nav `content_scripts` block with all supported host matches, `entry.js`, `document_idle`, and `all_frames: false`; WAR covers dynamic module paths.
- `contentScripts/nav/entry.js`: URL routing, `hasNav`/`platformNavSettings` checks, dynamic imports, and storage-change reload fallback.
- `contentScripts/nav/view.js`: fixed namespace, style injection, container, row rendering, active-line rendering, clear, and compact click-index callbacks.
- `contentScripts/nav/core.js`: compact `{el,text}` records, text fallback chain, click scroll/lock, visible active calculation, list/shell observers, debounce, and startup retry.
- `contentScripts/nav/platforms/*.js`: selector-only adapters and optional `extractText` hooks.
- `backgroudtask/platformScriptFiles.js`: sendMessage injection list only.
- `.CLAUDE/skills/nav-platform/SKILL.md`: maintenance and debugging guide for the final architecture.

## Completed Work

- [x] Path B background-nav experiments were superseded by user-approved Path A commit `66676ae`; do not restore Path B cache/injection tests.
- [x] `view.js` extracted with fixed `bro-chat-nav__*` namespace and scoped variables.
- [x] `core.js` separated from view and compact index mapping fixed.
- [x] Lifecycle characterization tests added in `tests/nav/core.test.mjs` (11 tests).
- [x] All 15 adapters made data-only; `tests/nav/platform-configs.test.mjs` covers the contract.
- [x] `preview.html`, `tests/nav/injection.test.mjs`, and `tests/nav/processor.test.mjs` removed as duplicate/obsolete Path B artifacts.

## Remaining Tasks

### Task 5: Finalize Path A docs and contracts

**Files:**
- Modify: `background.js` — synchronous `setupTabUpdateListener()` call.
- Modify: `backgroudtask/ai_platform_processor.js` — no nav preload import; synchronous listener registration for sendMessage only.
- Modify: `backgroudtask/platformScriptFiles.js` — sendMessage-only implementation and compatibility comments.
- Create: `tests/nav/manifest-nav.test.mjs` — manifest-resident nav contract and sendMessage-only background contract.
- Delete: `contentScripts/nav/preview.html`.
- Delete: `tests/nav/injection.test.mjs` and `tests/nav/processor.test.mjs`.
- Modify: `.CLAUDE/skills/nav-platform/SKILL.md` — Path A workflow, adapter contract, static tests, and `/browse` checks.
- Modify: `docs/superpowers/specs/2026-07-19-nav-shared-view-component-design.md` — Path A architecture and acceptance criteria.
- Modify: this plan — remove superseded Path B instructions.
- Inspect: `manifest.json`, `contentScripts/nav/entry.js`.

**Contract:** `manifest-nav.test.mjs` must assert exactly one nav content-script entry, all 15 expected matches, `document_idle`, `all_frames: false`, and `js: ['contentScripts/nav/entry.js']`. It must also assert `getPlatformScriptFiles('yuanbao')` and an unknown platform return only their sendMessage file.

- [x] Remove preview and Path B test files.
- [x] Align processor/background/platformScriptFiles with Path A.
- [x] Add the manifest-resident contract test.
- [x] Rewrite the repository skill and design/implementation documents.
- [ ] Run the complete 16-test static suite and review the final diff.
- [ ] Commit locally with a Conventional Commit; do not push.

### Task 6: Verify the loaded extension on real platforms

Use gstack `/browse` before any browser action. Reload the unpacked extension and target tabs so manifest `document_idle` injection executes.

Verify an ordinary-list platform (prefer Yuanbao) and a special/virtual-list platform (DeepSeek, Doubao, or Xiaomi):

```js
const nav = document.getElementById('bro-chat-right-edges-nav');
const style = document.getElementById('bro-chat-right-edges-nav-style');
const rows = [...document.querySelectorAll('.bro-chat-nav__row')];
const lines = [...document.querySelectorAll('.bro-chat-nav__line')];
const computed = nav && getComputedStyle(nav);
({
  hasNav: Boolean(nav),
  hasStyle: Boolean(style),
  navCount: document.querySelectorAll('#bro-chat-right-edges-nav').length,
  rowCount: rows.length,
  position: computed?.position,
  right: computed?.right,
  width: computed?.width,
  zIndex: computed?.zIndex,
  activeIndex: lines.findIndex((line) => line.classList.contains('is-active')),
  lineWidths: lines.map((line) => getComputedStyle(line).width),
})
```

Expected:

- nav/style each exist exactly once;
- `position: fixed`, `right: 20px`, idle width `28px`, z-index `2147483647`;
- rows equal non-empty user messages and line widths are `12px` or `20px`;
- first/middle/last clicks scroll to the matching message and activate its line;
- active follows the most visible message after manual scrolling;
- SPA conversation switching rebuilds rows without duplicate nav or observers;
- DeepSeek/Xiaomi hooks and Doubao `textSel: null` produce readable labels.

If no authenticated tabs are available, report browser coverage as skipped; do not claim static tests prove runtime behavior.

### Task 7: Final review and verification

Dispatch `code-reviewer` over the entire nav refactor after the current Path A baseline. Review:

- manifest-resident dynamic-import compatibility and WAR paths;
- view/core boundary and CSS isolation;
- observer cleanup, list rebind, compact index mapping, click lock;
- all adapter selectors and extraction hooks;
- absence of preview/Path B artifacts;
- test quality and docs consistency.

For each confirmed Critical/Important finding, add a focused failing test, apply one minimal fix, rerun the covering test and full suite, and commit locally. Do not implement speculative or out-of-scope suggestions.

Final automated command:

```bash
node --experimental-default-type=module --test \
  tests/nav/view.test.mjs \
  tests/nav/core.test.mjs \
  tests/nav/platform-configs.test.mjs \
  tests/nav/manifest-nav.test.mjs
git diff --check
rg -n "style\.textContent|createElement" contentScripts/nav/core.js
rg -n "navId|activeColor" contentScripts/nav/platforms
rg -n "preview\.html|injection\.test|processor\.test|background.*追加.*entry" \
  contentScripts/nav .CLAUDE/skills/nav-platform/SKILL.md docs/superpowers 2>/dev/null
```

Expected: 16 tests pass, `git diff --check` is clean, core has no presentation-DOM operations, adapters have no forbidden fields, and no obsolete Path B/preview references remain in maintained source/docs.

Final report must include files, local commit hashes, exact test output, browser evidence or skipped coverage, review findings/outcomes, branch status, and: **No push was performed.**
