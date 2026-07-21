# Nav 导出按钮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an export button to the nav that exports all user messages from the current conversation as a Markdown file.

**Architecture:** New `export.js` module handles Markdown generation + download. `collector.js` adds `fullText` to records. `view.js` adds export button UI with `onExport` callback. `core/index.js` orchestrates data flow from records → export.js. `entry.js` passes platform metadata to core.

**Tech Stack:** Pure ES modules (Chrome extension content script), chrome.downloads API, Node.js built-in test runner for testable pure functions.

## Global Constraints

- All strings in output are determined by the design decisions in the spec.
- File name format: `{platformId}-{YYYYMMDD-HHmmss}.md`
- Markdown export: YAML frontmatter + numbered list body
- `chrome.downloads` manifest permission already exists
- Platform adapter schema (`{itemSel, listSel, textSel?, extractText?}`) unchanged

---

### Task 0: Fix tests import path for core refactor

**Files:**
- Modify: `tests/nav/core.test.mjs`

**Context:** The old `core.js` was split into `core/index.js`. The test still imports from `../../contentScripts/nav/core.js`. Fix the import path to `../../contentScripts/nav/core/index.js`.

- [ ] **Step 1: Update core.test.mjs import path**

Old:
```js
import { createNav } from '../../contentScripts/nav/core.js';
```
New:
```js
import { createNav } from '../../contentScripts/nav/core/index.js';
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd D:/DevProjects/my/bro_chat && node --test tests/nav/core.test.mjs
```

Expected: All tests TAP ok.

- [ ] **Step 3: Commit**

```bash
cd D:/DevProjects/my/bro_chat && git add tests/nav/core.test.mjs && git commit -m "fix(nav): update test import path after core.js split into core/index.js"
```

---

### Task 1: collector.js — add fullText and skippedCount

**Files:**
- Modify: `contentScripts/nav/core/collector.js`
- Test: `tests/nav/collector.test.mjs` (new)

**Interfaces:**
- Consumes: `collectRecords({ itemSel, textSel, extractText })` — existing selector interface
- Produces: `collectRecords({ itemSel, textSel, extractText })` → `{ records: Array<{el: Element, text: string, fullText: string}>, skippedCount: number }`

- [ ] **Step 1: Extract raw text without truncation**

Add a new internal function `extractRaw` that extracts full text (no `.slice(0, LABEL_TRUNCATE)`). The existing `extractMessageText` becomes a wrapper that calls `extractRaw` then slices.

```js
// collector.js
function extractRaw(el, { textSel, extractText }) {
  if (extractText) {
    const extracted = extractText(el);
    if (extracted) return extracted.trim();
  }
  let text;
  if (textSel) text = el.querySelector(textSel)?.innerText;
  if (!text) text = el.innerText;
  return text?.trim() || undefined;
}
```

- [ ] **Step 2: Modify `collectRecords` to return fullText + skippedCount**

```js
export function collectRecords({ itemSel, textSel, extractText }) {
  const records = [];
  let skippedCount = 0;

  document.querySelectorAll(itemSel).forEach((el) => {
    const raw = extractRaw(el, { textSel, extractText });
    if (!raw) { skippedCount++; return; }
    records.push({
      el,
      text: raw.slice(0, LABEL_TRUNCATE),
      fullText: raw,
    });
  });

  return { records, skippedCount };
}
```

- [ ] **Step 3: Write the test**

```js
// tests/nav/collector.test.mjs
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { collectRecords } from '../../contentScripts/nav/core/collector.js';
import { FakeElement, installBrowserGlobals, resetBrowserGlobals } from './fake-dom.mjs';

afterEach(() => resetBrowserGlobals());

test('collectRecords returns both truncated text and fullText', () => {
  const { document } = installBrowserGlobals();
  const el = new FakeElement('div');
  el.innerText = 'a'.repeat(200);
  document.setQuerySelectorAll('.msg', [el]);

  const { records, skippedCount } = collectRecords({ itemSel: '.msg', textSel: null });
  assert.equal(records.length, 1);
  assert.equal(skippedCount, 0);
  assert.equal(records[0].text.length, 60);           // truncated
  assert.equal(records[0].fullText.length, 200);       // full
  assert.equal(records[0].el, el);
});

test('collectRecords skips empty text and increments skippedCount', () => {
  const { document } = installBrowserGlobals();
  const el1 = new FakeElement('div');
  el1.innerText = 'hello';
  const el2 = new FakeElement('div');
  el2.innerText = '   ';
  const el3 = new FakeElement('div');
  el3.innerText = 'world';
  document.setQuerySelectorAll('.msg', [el1, el2, el3]);

  const { records, skippedCount } = collectRecords({ itemSel: '.msg', textSel: null });
  assert.equal(records.length, 2);
  assert.equal(skippedCount, 1);
  assert.equal(records[0].fullText, 'hello');
  assert.equal(records[1].fullText, 'world');
});
```

- [ ] **Step 4: Run test**

```bash
cd D:/DevProjects/my/bro_chat && node --test tests/nav/collector.test.mjs
```

Expected: Tests pass.

- [ ] **Step 5: Update existing core.test.mjs that relies on collectRecords**

The core test heavily mocks DOM and captures `collectRecords` indirectly through `createNav`. The records object change is backward-compatible (adding `fullText` doesn't break any existing assertion), so no core test changes needed — verify by running core tests again.

```bash
cd D:/DevProjects/my/bro_chat && node --test tests/nav/core.test.mjs
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
cd D:/DevProjects/my/bro_chat && git add tests/nav/collector.test.mjs contentScripts/nav/core/collector.js && git commit -m "feat(nav): add fullText and skippedCount to collectRecords"
```

---

### Task 2: export.js — Markdown generation and download

**Files:**
- Create: `contentScripts/nav/export.js`
- Test: `tests/nav/export.test.mjs`

**Interfaces:**
- Consumes: `exportChat(records: Array<{fullText: string}>, meta: object)` — records of full texts, meta with platform info, sourceUrl, counts
- Produces: void — creates blob and triggers browser download

- [ ] **Step 1: Write the test**

```js
// tests/nav/export.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildMarkdown } from '../../contentScripts/nav/export.js';

test('buildMarkdown produces correct frontmatter and body', () => {
  const records = [
    { fullText: '帮我写一个 React hook' },
    { fullText: '以下是用 useRef 加 touch 事件实现' },
  ];
  const meta = {
    platformId: 'chatgpt',
    platformName: 'ChatGPT',
    sourceUrl: 'https://chatgpt.com/c/67abc123',
    messageCount: 2,
    skippedCount: 0,
  };

  const md = buildMarkdown(records, meta);

  // Frontmatter fields
  assert.match(md, /^---\n/);                         // starts with ---
  assert.match(md, /platform: chatgpt/);
  assert.match(md, /platformName: ChatGPT/);
  assert.match(md, /sourceUrl: https:\/\/chatgpt\.com\/c\/67abc123/);
  assert.match(md, /messageCount: 2/);
  assert.match(md, /skippedCount: 0/);
  assert.match(md, /exportedAt:/);

  // Body
  assert.match(md, /# 会话消息/);
  assert.match(md, /1\. 帮我写一个 React hook/);
  assert.match(md, /2\. 以下是用 useRef 加 touch 事件实现/);
});

test('buildMarkdown handles empty records', () => {
  const md = buildMarkdown([], { platformId: 'test', platformName: 'Test', sourceUrl: '', messageCount: 0, skippedCount: 0 });
  assert.match(md, /messageCount: 0/);
  assert.match(md, /# 会话消息/);
  assert.equal(md.split('\n').filter(l => /^\d+\./.test(l)).length, 0);
});

test('buildMarkdown uses platformId as fallback when platformName is missing', () => {
  const md = buildMarkdown([{ fullText: 'hi' }], { platformId: 'deepseek', sourceUrl: 'https://chat.deepseek.com/', messageCount: 1, skippedCount: 0 });
  assert.match(md, /platform: deepseek/);
});

test('buildMarkdown preserves code blocks and markdown syntax', () => {
  const records = [{ fullText: '```js\nconsole.log("hello")\n```\n\n$E=mc^2$' }];
  const md = buildMarkdown(records, { platformId: 't', sourceUrl: '', messageCount: 1, skippedCount: 0 });
  assert.match(md, /```js/);
  assert.match(md, /\$E=mc\^2\$/);
});

test('buildMarkdown handles image-only message as text placeholder', () => {
  const records = [{ fullText: undefined }];
  const meta = { platformId: 't', sourceUrl: '', messageCount: 0, skippedCount: 1 };
  const md = buildMarkdown(records, meta);
  assert.match(md, /skippedCount: 1/);
});
```

- [ ] **Step 2: Write export.js**

```js
/**
 * @fileoverview Nav export module — Markdown generation + browser download.
 *
 * Pure function: buildMarkdown(records, meta) → string.
 * URL/download boilerplate in exportChat().
 */

/**
 * Build YAML frontmatter + Markdown body from conversation records.
 * @param {Array<{fullText: string}>} records
 * @param {object} meta
 * @param {string} meta.platformId
 * @param {string} [meta.platformName]
 * @param {string} meta.sourceUrl
 * @param {number} meta.messageCount
 * @param {number} meta.skippedCount
 * @returns {string}
 */
export function buildMarkdown(records, meta) {
  const lines = [];

  // YAML frontmatter
  lines.push('---');
  lines.push(`exportedAt: "${new Date().toISOString()}"`);
  lines.push(`platform: ${meta.platformId}`);
  lines.push(`platformName: ${meta.platformName || meta.platformId}`);
  lines.push(`sourceUrl: ${meta.sourceUrl}`);
  lines.push(`messageCount: ${meta.messageCount}`);
  lines.push(`skippedCount: ${meta.skippedCount}`);
  lines.push('---');
  lines.push('');
  lines.push('# 会话消息');
  lines.push('');

  // Body
  records.forEach((record, index) => {
    const text = record.fullText || '[empty]';
    lines.push(`${index + 1}. ${text}`);
    lines.push('');
  });

  return lines.join('\n');
}

/**
 * Export chat records as a Markdown file download.
 * Uses chrome.downloads if available, falls back to <a download>.
 *
 * @param {Array<{fullText: string}>} records
 * @param {object} meta — same as buildMarkdown meta
 */
export function exportChat(records, meta) {
  if (!records || records.length === 0) return;

  const markdown = buildMarkdown(records, meta);
  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const filename = `${meta.platformId}-${dateStr}-${timeStr}.md`;

  const done = () => {
    URL.revokeObjectURL(url);
  };

  if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
    chrome.downloads.download({ url, filename }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[nav export] download failed:', chrome.runtime.lastError);
      }
      done();
    });
  } else {
    // Fallback: <a download> for non-extension contexts
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      done();
    }, 1000);
  }
}
```

- [ ] **Step 3: Run tests**

```bash
cd D:/DevProjects/my/bro_chat && node --test tests/nav/export.test.mjs
```

Expected: Tests pass.

- [ ] **Step 4: Commit**

```bash
cd D:/DevProjects/my/bro_chat && git add contentScripts/nav/export.js tests/nav/export.test.mjs && git commit -m "feat(nav): add export.js — Markdown export + download"
```

---

### Task 3: view.js — add export button

**Files:**
- Modify: `contentScripts/nav/view.js`
- Modify: `tests/nav/view.test.mjs` — add export button test

**Interfaces:**
- Consumes: `createNavView({ onSelect, onExport? })` — new optional `onExport` callback
- Produces: export button DOM element in nav container under hover, with CSS animation

- [ ] **Step 1: Add export button CSS to NAV_CSS**

Append before the closing backtick of `NAV_CSS`:

```css
.${EXPORT_CLASS} {
  display: none;
  align-items: center;
  gap: 4px;
  padding: 1px 8px 1px 14px;
  font-size: 12px;
  color: var(--bro-chat-nav-text-idle);
  cursor: pointer;
  white-space: nowrap;
}
#${NAV_ID}:hover .${EXPORT_CLASS} {
  display: flex;
}
.${EXPORT_CLASS}:hover {
  color: var(--bro-chat-nav-text);
}
```

Add EXPORT_CLASS constant at top of file:

```js
const EXPORT_CLASS = 'bro-chat-nav__export';
```

- [ ] **Step 2: Add export button DOM in createContainer**

In `createContainer()`, after appending handle to nav, create and append the export button:

```js
function createContainer(onExport) {
  // ... existing handle creation ...

  if (typeof onExport === 'function') {
    const exportBtn = document.createElement('span');
    exportBtn.className = EXPORT_CLASS;
    exportBtn.textContent = '📥 导出';
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onExport();
    });
    nav.appendChild(exportBtn);
  }

  return { nav, handle };
}
```

- [ ] **Step 3: Thread onExport through createNavView**

```js
export function createNavView({ onSelect, onExport }) {
  if (document.getElementById(NAV_ID)) return null;
  injectStyle();
  const { nav, handle } = createContainer(onExport);

  // clear() — protect export button (children count > 1 + (onExport ? 1 : 0))
  function clear() {
    const exportCount = typeof onExport === 'function' ? 1 : 0;
    while (nav.children.length > 1 + exportCount) {
      nav.removeChild(nav.lastChild);
    }
  }

  // render() — account for export button in length checks
  const exportCount = typeof onExport === 'function' ? 1 : 0;

  function render(labels) {
    while (nav.children.length - 1 - exportCount > labels.length) {
      nav.removeChild(nav.lastChild);
    }

    const count = Math.min(nav.children.length - 1 - exportCount, labels.length);
    for (let i = 0; i < count; i++) {
      const row = nav.children[i + 1]; // +1 skip handle
      const item = row.querySelector(`.${ITEM_CLASS}`);
      if (item.textContent !== labels[i]) {
        item.textContent = labels[i];
      }
    }

    for (let i = nav.children.length - 1 - exportCount; i < labels.length; i++) {
      const { row } = createRow({ label: labels[i], onSelect });
      nav.appendChild(row);
    }
  }

  // setActive — unchanged, still iterates nav.children with .${LINE_CLASS} filter
  // destroy — unchanged

  return { render, setActive, clear, destroy };
}
```

- [ ] **Step 4: Add export button test to view.test.mjs**

```js
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
  assert.equal(exportBtn.textContent, '📥 导出');

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
```

- [ ] **Step 5: Run tests**

```bash
cd D:/DevProjects/my/bro_chat && node --test tests/nav/view.test.mjs
```

Expected: All view tests pass (existing + new export button tests).

- [ ] **Step 6: Commit**

```bash
cd D:/DevProjects/my/bro_chat && git add contentScripts/nav/view.js tests/nav/view.test.mjs && git commit -m "feat(nav): add export button UI with onExport callback"
```

---

### Task 4: core/index.js + entry.js — wire export into lifecycle

**Files:**
- Modify: `contentScripts/nav/core/index.js`
- Modify: `contentScripts/nav/entry.js`
- Modify: `tests/nav/core.test.mjs` — update core test for new fields

**Interfaces:**
- Consumes: `createNav({ ...platformCfg, platformId, platformName })` — receives platform metadata
- Produces: on export click → `exportChat(records, meta)` via dynamic import

- [ ] **Step 1: Update core/index.js — add onExport lifecycle**

```js
// core/index.js — add to createNav(cfg)
const { itemSel, listSel, textSel, extractText, platformId, platformName } = cfg;
let skippedCount = 0;

// rebuild: use new collectRecords return type
function rebuild() {
  const result = collectRecords(collector);
  records = result.records;
  skippedCount = result.skippedCount;
  view.render(records.map((r) => r.text));
  // ... rest unchanged ...
}

// onExport handler
function onExport() {
  if (records.length === 0) return;
  import('./export.js').then(({ exportChat }) => {
    exportChat(
      records.map(r => ({ fullText: r.fullText })),
      {
        platformId,
        platformName: platformName || platformId,
        sourceUrl: location.href,
        messageCount: records.length,
        skippedCount,
      }
    );
  }).catch((err) => {
    console.warn('[nav] export 加载失败', err);
  });
}
```

Then pass `onExport` to `createNavView`:

```js
const view = createNavView({ onSelect, onExport });
```

Add a dynamic import path hint for the bundler. Since `core/index.js` imports `./export.js` dynamically, the path is relative to `core/`. The entry.js already uses `./core/index.js` as the base path, so the bundler will resolve it correctly.

Note: Change `import('./export.js')` to a full relative path that works from `core/`:
```js
import('../export.js').then(...)
```

Wait — `core/index.js` is at `nav/core/index.js`, and `export.js` is at `nav/export.js`. So the relative import from core is `../export.js`.

```js
function onExport() {
  if (records.length === 0) return;
  import('../export.js').then(({ exportChat }) => {
    // ...
  }).catch(...)
}
```

- [ ] **Step 2: Update entry.js — pass platformId and platformName**

```js
// entry.js — inside mount()
const handle = createNav({
  ...platformCfg,
  platformId,
  platformName: PLATFORM_CONFIG[platformId]?.name || platformId,
});
```

- [ ] **Step 3: Update core.test.mjs — pass platformId/platformName to createNav**

All existing createNav({...}) calls need the new fields, even though core doesn't do anything with them yet (onExport only fires on button click). Add optional fields with defaults to keep existing tests passing without changes.

The `createNav` function destructures many fields from `cfg`. Since `platformId` and `platformName` are accessed directly, they'll be `undefined` in existing tests — but `onExport` only fires when the button is clicked, so they're never read during the test. No test changes needed for existing tests.

- [ ] **Step 4: Create integration test for export in core.test.mjs**

```js
test('onExport sends records to exportChat via dynamic import', async () => {
  const { document } = installBrowserGlobals();
  const list = new FakeElement('main');
  const msg = new FakeElement('div');
  msg.innerText = 'hello world';
  document.setQuerySelector('.message-list', list);
  document.setQuerySelectorAll('.user-message', [msg]);
  captureTimers();

  // We need to mock the dynamic import of export.js
  let exportCalledWith = null;
  const origImport = globalThis.import;
  globalThis.import = (path) => {
    if (path.endsWith('export.js')) {
      return Promise.resolve({
        exportChat: (records, meta) => { exportCalledWith = { records, meta }; },
      });
    }
    return origImport ? origImport(path) : Promise.reject(new Error('no mock'));
  };

  createNav({
    itemSel: '.user-message',
    listSel: '.message-list',
    textSel: null,
    platformId: 'test-platform',
    platformName: 'Test Platform',
  });

  const nav = document.getElementById('bro-chat-right-edges-nav');
  const exportBtn = nav.querySelector('.bro-chat-nav__export');
  assert.ok(exportBtn);

  exportBtn.click();

  // Allow dynamic import microtask to settle
  await new Promise(r => setTimeout(r, 10));

  assert.ok(exportCalledWith);
  assert.equal(exportCalledWith.records.length, 1);
  assert.equal(exportCalledWith.records[0].fullText, 'hello world');
  assert.equal(exportCalledWith.meta.platformId, 'test-platform');
  assert.equal(exportCalledWith.meta.platformName, 'Test Platform');
  assert.equal(exportCalledWith.meta.messageCount, 1);
  assert.equal(exportCalledWith.meta.skippedCount, 0);

  globalThis.import = origImport;
});
```

- [ ] **Step 5: Run all nav tests**

```bash
cd D:/DevProjects/my/bro_chat && node --test tests/nav/*.test.mjs
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
cd D:/DevProjects/my/bro_chat && git add contentScripts/nav/core/index.js contentScripts/nav/entry.js tests/nav/core.test.mjs && git commit -m "feat(nav): wire export into core lifecycle and entry"
```

---

## Self-Review Checklist

1. **Spec coverage:** Every requirement from the spec has a corresponding task:
   - collector.js returns fullText + skippedCount → Task 1
   - export.js builds Markdown + triggers download → Task 2
   - view.js adds export button with hover animation → Task 3
   - core/index.js orchestrates export lifecycle → Task 4
   - entry.js passes platformId/platformName → Task 4, Step 2

2. **Placeholder scan:** All steps contain actual code. No TBD/TODO.

3. **Type consistency:** 
   - `collectRecords` returns `{ records, skippedCount }` consistently in Tasks 1-4
   - `exportChat(records, meta)` signature matches in Task 2 and Task 4
   - `createNavView({ onSelect, onExport })` matches in Task 3 and Task 4
