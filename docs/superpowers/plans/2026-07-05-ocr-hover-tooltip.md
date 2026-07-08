# OCR Hover Tooltip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the browser-native `title`-attribute tooltip on OCR image previews with a custom in-page tooltip that supports click-to-copy of the recognized text, and works identically in popup and sidebar aichat.

**Architecture:** Tooltip logic lives inside `shared/imageOcr.js` (singleton controller-wide DOM element + event delegation), with its own `shared/imageOcr.css` auto-injected by the module. Caller sites (`mainUtils.js` / `aichatUtils.js`) get zero changes. Click handler writes `textContent` of the body to `navigator.clipboard` and shows a 2s "已复制" green strip at the top of the tooltip.

**Tech Stack:** Vanilla JS (Chrome extension), CSS, `navigator.clipboard.writeText` with `document.execCommand('copy')` fallback. No new dependencies.

## Global Constraints

- Storage key `translation.api.config` (referenced by the broader OCR pipeline): unchanged.
- Tooltip content must use `textContent` assignment, never `innerHTML` (XSS prevention).
- Tooltip class names: `.image-ocr-tooltip`, `.image-ocr-tooltip-feedback[data-role="feedback"]`, `.image-ocr-tooltip-body`.
- Tooltip z-index: `2147483000` (above all extension UI).
- `enableTooltip` is an optional dependency-injection field defaulting to `true`.
- Both popup and sidebar must behave identically.
- The `runjs/translation/content-ocr.js` content-script path is **out of scope** (independent render path).
- `manifest.json`, `popup/main/main.html`, `sidebar/main/aichat/aichat.html` are **not** modified (module auto-injects the CSS).
- `backgroudtask/translation/ocr.js` is **not** modified.
- All work on the current branch (main), one commit per task.

---

## File Structure

| Path | Action | Responsibility |
|------|--------|----------------|
| `shared/imageOcr.js` | Modify | Add tooltip state + 5 helper functions; replace `title` attribute with `mouseenter`/`mouseleave` listeners in `render()`; add `enableTooltip` to deps |
| `shared/imageOcr.css` | Create | Tooltip styles: `position: fixed`, dark background, click cursor, opacity transition, feedback strip |

No file splits, no new directories.

---

## Task 1: Create `shared/imageOcr.css`

**Files:**
- Create: `shared/imageOcr.css`

**Interfaces:**
- Consumes: 无
- Produces: CSS rules for `.image-ocr-tooltip`, `.image-ocr-tooltip-feedback`, `.image-ocr-tooltip-body`

**Steps:**

- [ ] **Step 1: Create the CSS file**

Write the entire file content:

```css
/* shared/imageOcr.css
 *
 * 自定义 hover tooltip 样式，用于图片 OCR 缩略图上的识别结果显示。
 * 由 shared/imageOcr.js 在模块首次加载时自注入。
 */

.image-ocr-tooltip {
  position: fixed;
  z-index: 2147483000;
  max-width: 320px;
  max-height: 200px;
  background: rgba(33, 33, 33, 0.95);
  color: #fff;
  font-size: 14px;
  line-height: 1.5;
  padding: 8px 10px;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  cursor: pointer;
  user-select: none;
  pointer-events: auto;
  word-break: break-word;
  white-space: pre-wrap;
  overflow: auto;
  transition: opacity 0.12s ease-in-out;
  opacity: 0;
  left: -9999px;
  top: -9999px;
}

.image-ocr-tooltip[data-state="visible"] {
  opacity: 1;
}

.image-ocr-tooltip-feedback {
  display: none;
  background: #4caf50;
  color: #fff;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 3px;
  margin-bottom: 6px;
  text-align: center;
}

.image-ocr-tooltip-feedback[data-visible="true"] {
  display: block;
}

.image-ocr-tooltip-body {
  white-space: pre-wrap;
  word-break: break-word;
}
```

- [ ] **Step 2: Verify the file was created**

```bash
cd 'D:/code/a_js/app_ext/bro_chat'
ls -la 'shared/imageOcr.css'
wc -l 'shared/imageOcr.css'
```

Expected: file exists, ~50 lines.

- [ ] **Step 3: Commit**

```bash
cd 'D:/code/a_js/app_ext/bro_chat'
git add 'shared/imageOcr.css'
git -c user.name='claude' -c user.email='noreply@anthropic.com' commit -m "feat(shared): add image-ocr-tooltip stylesheet"
```

---

## Task 2: Modify `shared/imageOcr.js` — add tooltip state, helper functions, and CSS self-injection

**Files:**
- Modify: `shared/imageOcr.js` (add module-level state, helpers; modify `createImageOcrController` to thread `enableTooltip`)

**Interfaces:**
- Consumes: 现有 `render()` 的 image-preview-item 渲染逻辑（line 134-150）
- Produces:
  - 模块级状态: `tooltipEl`, `tooltipFeedbackTimer`, `tooltipHideTimer`
  - 函数: `ensureTooltip()`, `showTooltip(itemEl, text)`, `hideTooltip(opts)`, `showTooltipFeedback(msg)`, `copyTooltipBody(e)`, `getTooltipTextForItem(img)`
  - `createImageOcrController(deps)` 新增可选 `enableTooltip: true`

**Steps:**

- [ ] **Step 1: Add module-level tooltip state + CSS self-injection at the top of the file**

定位 `shared/imageOcr.js` 在 `STATUS_TEXT` 常量之后（约 line 91），在 `getStatusText` 函数之后插入：

```js
// 自定义 hover tooltip 状态（单例）
let tooltipEl = null;
let tooltipFeedbackTimer = null;
let tooltipHideTimer = null;
let tooltipEnable = true;
```

然后在 `escapeAttr` 函数**之前**（约 line 73 之前）插入 CSS 自注入 IIFE（即模块顶层，仅执行一次）：

```js
// 模块首次加载时自注入样式（仅一次；aichat/popup 加载路径均会触发）
if (typeof document !== 'undefined' && !document.querySelector('link[data-image-ocr-css]')) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './imageOcr.css';
  link.dataset.imageOcrCss = '1';
  document.head.appendChild(link);
}
```

- [ ] **Step 2: Add `ensureTooltip()` function**

把以下函数插在 `getStatusText()` 函数之后（保持 module-level 状态组织在一起）：

```js
/**
 * 确保 tooltip 元素存在并挂到 body。失败时（无 document.body）返回 null。
 */
function ensureTooltip() {
  if (tooltipEl) return tooltipEl;
  if (typeof document === 'undefined' || !document.body) return null;

  const root = document.createElement('div');
  root.className = 'image-ocr-tooltip';
  root.setAttribute('role', 'tooltip');
  root.setAttribute('data-state', 'hidden');

  const feedback = document.createElement('div');
  feedback.className = 'image-ocr-tooltip-feedback';
  feedback.setAttribute('data-role', 'feedback');

  const body = document.createElement('div');
  body.className = 'image-ocr-tooltip-body';

  root.appendChild(feedback);
  root.appendChild(body);

  root.addEventListener('click', copyTooltipBody);
  document.body.appendChild(root);

  tooltipEl = root;
  return tooltipEl;
}
```

- [ ] **Step 3: Add `getTooltipTextForItem(img)` helper**

紧跟 `ensureTooltip()` 之后插入：

```js
/**
 * 根据 image 状态返回 hover 显示的文本。
 * status: pending / recognizing / success / error
 */
function getTooltipTextForItem(img) {
  if (img.status === 'success' && img.recognizedText) return img.recognizedText;
  if (img.status === 'error' && img.recognizedText) return `识别失败: ${img.recognizedText}`;
  if (img.status === 'recognizing') return '识别中...';
  return img.fileName || '';
}
```

- [ ] **Step 4: Add `showTooltip(itemEl, text)` function**

紧跟 `getTooltipTextForItem()` 之后插入：

```js
/**
 * 显示 tooltip 在 item 上方居中，超出视口时自动调整。
 */
function showTooltip(itemEl, text) {
  if (!tooltipEnable) return;
  const tip = ensureTooltip();
  if (!tip) return;

  const body = tip.querySelector('.image-ocr-tooltip-body');
  body.textContent = text; // 必须 textContent，避免 XSS

  // 重置反馈条
  const feedback = tip.querySelector('.image-ocr-tooltip-feedback');
  feedback.textContent = '';
  feedback.removeAttribute('data-visible');
  if (tooltipFeedbackTimer) {
    clearTimeout(tooltipFeedbackTimer);
    tooltipFeedbackTimer = null;
  }

  // 取消延迟隐藏
  if (tooltipHideTimer) {
    clearTimeout(tooltipHideTimer);
    tooltipHideTimer = null;
  }

  // 先显示在屏幕外以测量尺寸
  tip.setAttribute('data-state', 'visible');
  tip.style.left = '0px';
  tip.style.top = '0px';

  const itemRect = itemEl.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  const margin = 8;

  let left = itemRect.left + itemRect.width / 2 - tipRect.width / 2;
  let top = itemRect.top - tipRect.height - margin;

  // 边界保护
  if (left < margin) left = margin;
  if (left + tipRect.width > window.innerWidth - margin) {
    left = window.innerWidth - tipRect.width - margin;
  }
  if (top < margin) {
    // 上方空间不足，改为下方
    top = itemRect.bottom + margin;
  }

  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}
```

- [ ] **Step 5: Add `hideTooltip(opts)` function**

紧跟 `showTooltip()` 之后插入：

```js
/**
 * 隐藏 tooltip。
 * opts.delay > 0 时延迟隐藏（毫秒）
 */
function hideTooltip(opts) {
  if (!tooltipEl) return;
  const delay = (opts && opts.delay) || 0;
  if (tooltipHideTimer) {
    clearTimeout(tooltipHideTimer);
    tooltipHideTimer = null;
  }
  const doHide = () => {
    if (!tooltipEl) return;
    tooltipEl.setAttribute('data-state', 'hidden');
    tooltipEl.style.left = '-9999px';
    tooltipEl.style.top = '-9999px';
  };
  if (delay > 0) {
    tooltipHideTimer = setTimeout(doHide, delay);
  } else {
    doHide();
  }
}
```

- [ ] **Step 6: Add `showTooltipFeedback(msg)` and `copyTooltipBody(e)` functions**

紧跟 `hideTooltip()` 之后插入：

```js
/**
 * 在 tooltip 顶部展示一条 2 秒的反馈条（绿底白字），用于「已复制」等提示。
 */
function showTooltipFeedback(msg) {
  const tip = ensureTooltip();
  if (!tip) return;
  const feedback = tip.querySelector('.image-ocr-tooltip-feedback');
  feedback.textContent = msg;
  feedback.setAttribute('data-visible', 'true');
  if (tooltipFeedbackTimer) clearTimeout(tooltipFeedbackTimer);
  tooltipFeedbackTimer = setTimeout(() => {
    feedback.textContent = '';
    feedback.removeAttribute('data-visible');
    tooltipFeedbackTimer = null;
  }, 2000);
}

/**
 * 复制 tooltip body 文本到剪贴板。
 * 优先 navigator.clipboard，失败时 fallback 到 textarea + execCommand。
 */
async function copyTooltipBody(e) {
  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
  const tip = ensureTooltip();
  if (!tip) return;
  const text = tip.querySelector('.image-ocr-tooltip-body').textContent || '';
  if (!text) return;

  let ok = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch (_) {
    // fallthrough to execCommand fallback
  }

  if (!ok) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (_) {
      ok = false;
    }
  }

  showTooltipFeedback(ok ? '已复制' : '复制失败');
}
```

- [ ] **Step 7: Modify `createImageOcrController` to destructure `enableTooltip`**

定位 `createImageOcrController(deps)` 函数体开头（约 line 118）：

```js
export function createImageOcrController(deps) {
  const { getPreviewContainer, showTempMessage, onChange } = deps;
```

改为：

```js
export function createImageOcrController(deps) {
  const { getPreviewContainer, showTempMessage, onChange, enableTooltip } = deps;
  // 模块级 enableTooltip 在该 controller 创建时设置（最后一个创建者生效）
  tooltipEnable = enableTooltip !== false; // 默认 true
```

- [ ] **Step 8: Modify `render()` to remove `title` and add mouseenter/leave**

定位 `render()` 函数内的 image-preview-item 模板（约 line 137-149）：

```js
      .map((img) => {
        // hover tooltip：成功时显示已识别文本，失败时显示错误信息，其他状态显示文件名
        const tooltip =
          img.status === 'success' && img.recognizedText
            ? img.recognizedText
            : img.status === 'error'
              ? `识别失败: ${img.recognizedText}`
              : img.fileName;
        return `
          <div class="image-preview-item" data-image-id="${escapeAttr(img.id)}" title="${escapeAttr(tooltip)}">
            <img src="${escapeAttr(img.dataUrl)}" alt="${escapeAttr(img.fileName)}" />
            <button class="image-preview-remove" data-action="remove" data-image-id="${escapeAttr(img.id)}">×</button>
            <div class="image-preview-status ${escapeAttr(img.status)}">${escapeAttr(getStatusText(img.status))}</div>
          </div>
        `;
      })
      .join('');
```

改为（保留 `enableTooltip === false` 时回退到原生 `title` 属性的能力）：

```js
      .map((img) => {
        const fallbackTitle = tooltipEnable ? '' : escapeAttr(getTooltipTextForItem(img));
        const titleAttr = fallbackTitle ? ` title="${fallbackTitle}"` : '';
        return `
          <div class="image-preview-item" data-image-id="${escapeAttr(img.id)}"${titleAttr}>
            <img src="${escapeAttr(img.dataUrl)}" alt="${escapeAttr(img.fileName)}" />
            <button class="image-preview-remove" data-action="remove" data-image-id="${escapeAttr(img.id)}">×</button>
            <div class="image-preview-status ${escapeAttr(img.status)}">${escapeAttr(getStatusText(img.status))}</div>
          </div>
        `;
      })
      .join('');
```

**说明**：
- `tooltipEnable === true`（默认）：不渲染 `title` 属性 → 不出现浏览器原生 tooltip
- `tooltipEnable === false`（调用方显式关闭）：渲染 `title` 属性 → 退化为原浏览器 tooltip 行为

`getTooltipTextForItem` 是 module-level 函数（不是 controller 闭包内），在模板字符串里可访问。

然后定位 `render()` 末尾绑定删除按钮的代码（约 line 154-160）：

```js
    // 绑定删除按钮
    container.querySelectorAll('[data-action="remove"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = e.currentTarget.dataset.imageId;
        removeImage(id);
      });
    });
```

在**这一段之后**追加鼠标事件绑定：

```js
    // 绑定 hover tooltip（mouseenter/leave 委托到每个 item）
    if (tooltipEnable) {
      container.querySelectorAll('.image-preview-item').forEach((item) => {
        item.addEventListener('mouseenter', () => {
          const id = item.dataset.imageId;
          const img = pendingImages.find((i) => i.id === id);
          if (!img) return;
          showTooltip(item, getTooltipTextForItem(img));
        });
        item.addEventListener('mouseleave', () => {
          hideTooltip({ delay: 0 });
        });
      });
    }
```

- [ ] **Step 9: Verify the modified file is syntactically valid**

```bash
cd 'D:/code/a_js/app_ext/bro_chat'
node -e "import('file:///D:/code/a_js/app_ext/bro_chat/shared/imageOcr.js').then(m => console.log('exports:', Object.keys(m)))" 2>&1 | head -20
```

Expected output: `exports: [ 'getOcrPrompt', 'recognizeImage', 'stripThinkTags', 'createImageOcrController' ]`

If you see a `SyntaxError`, locate the bad insertion and fix.

- [ ] **Step 10: Confirm only the expected file changed**

```bash
cd 'D:/code/a_js/app_ext/bro_chat'
git status -s
git diff 'shared/imageOcr.js' | head -50
```

Expected: only `shared/imageOcr.js` modified. The diff should show:
- 2 new module-level `let` declarations
- A new `link` injection block at module top
- 6 new functions: `ensureTooltip`, `getTooltipTextForItem`, `showTooltip`, `hideTooltip`, `showTooltipFeedback`, `copyTooltipBody`
- Modified `createImageOcrController` destructure line
- Modified `render()` template string (no `title` attribute by default)
- New mouseenter/leave block in `render()` (gated by `tooltipEnable`)

- [ ] **Step 11: Commit**

```bash
cd 'D:/code/a_js/app_ext/bro_chat'
git add 'shared/imageOcr.js'
git -c user.name='claude' -c user.email='noreply@anthropic.com' commit -m "feat(shared): custom hover tooltip on image OCR previews with click-to-copy"
```

---

## Task 3: End-to-end verification

**Files:** none (verification only)

**Steps:**

- [ ] **Step 1: Confirm callers unchanged**

```bash
cd 'D:/code/a_js/app_ext/bro_chat'
git diff 'popup/main/mainUtils.js' 'sidebar/main/aichat/aichatUtils.js' 'popup/main/main.html' 'sidebar/main/aichat/aichat.html' 'manifest.json'
```

Expected: empty output. Callers and manifest are unchanged.

- [ ] **Step 2: Confirm no other files accidentally changed**

```bash
cd 'D:/code/a_js/app_ext/bro_chat'
git log --oneline -3
git diff --stat HEAD~2..HEAD
```

Expected: only 2 commits on top of the spec (Task 1 CSS + Task 2 JS). Files changed: exactly `shared/imageOcr.css` (new) + `shared/imageOcr.js` (modified).

- [ ] **Step 3: Confirm exports and signature compatibility**

```bash
cd 'D:/code/a_js/app_ext/bro_chat'
node -e "import('file:///D:/code/a_js/app_ext/bro_chat/shared/imageOcr.js').then(m => console.log('exports:', Object.keys(m), 'controller type:', typeof m.createImageOcrController))"
```

Expected: `exports: [ 'getOcrPrompt', 'recognizeImage', 'stripThinkTags', 'createImageOcrController' ] controller type: function`

- [ ] **Step 4: Manual browser test — popup**

Reload the extension at `chrome://extensions/`. Open popup. Drop or paste an image.

1. Image preview appears
2. **No** native browser yellow tooltip on hover (no `title` attribute set)
3. Hover the preview thumbnail → custom dark tooltip appears above the image with the recognized text (or "识别中..." / "识别失败: ..." / fileName)
4. Tooltip text wraps correctly; long text scrolls within 200px max-height
5. Move mouse away → tooltip disappears
6. Click the tooltip while it shows → clipboard receives the recognized text → tooltip's top green strip shows "已复制" for 2s

- [ ] **Step 5: Manual browser test — sidebar aichat**

Open the extension's side panel, switch to aichat mode, paste an image.

1. Same hover/click behavior as popup
2. Tooltip positions correctly within sidebar's narrower viewport
3. Click → clipboard receives text

- [ ] **Step 6: Manual browser test — failure path**

Drop an image, but force a recognition failure (e.g., temporarily disconnect network or use invalid API key).

1. Preview status shows "失败"
2. Hover → tooltip shows `识别失败: <error message>`
3. Click → clipboard still receives that error-prefixed text; feedback says "已复制"

- [ ] **Step 7: Optional — verify `enableTooltip: false` opt-out works**

If you want to test the opt-out path, temporarily add `enableTooltip: false` to one caller's `createImageOcrController({...})` and confirm:
- Native `title` attribute appears (yellow browser tooltip on hover)
- Custom dark tooltip does **not** appear
- Clicking does nothing for tooltip (no custom element)
- Remove the `enableTooltip: false` and revert before committing

- [ ] **Step 8: Final report**

Confirm in `task-3-report.md`:
- Tasks 1 & 2 commits present in `git log`
- Manual tests passed
- No regression to existing image-previews (remove button still works, status text still updates, etc.)

---

## Implementation Completion Checklist (implementer self-fill)

- [ ] Task 1 — `shared/imageOcr.css` created and committed
- [ ] Task 2 — `shared/imageOcr.js` extended with tooltip + click-to-copy and committed
- [ ] Task 3 — End-to-end verification passed (popup + sidebar + failure path)
