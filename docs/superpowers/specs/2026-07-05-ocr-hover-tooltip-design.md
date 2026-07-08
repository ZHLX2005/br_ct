# 图片 OCR 自定义 Hover Tooltip 设计文档

**日期**: 2026-07-05
**分支**: feature/popup-image-ocr
**作者**: Claude (brainstorming + writing-plans)

---

## 目标

把 `shared/imageOcr.js` 中基于 HTML `title` 属性的浏览器原生 hover tooltip 替换为**自定义独立 UI 组件**，并支持**点击复制识别文本到剪贴板**。所有 popup / sidebar 调用方零改动。

## 背景与现状

### 当前实现

- `shared/imageOcr.js`（242 行）为 popup 与 sidebar 的图片 OCR 提供 controller
- 在 `render()` 渲染每张图片缩略图时，使用浏览器原生 `title` 属性提供 hover 提示：

  ```js
  <div class="image-preview-item" data-image-id="..." title="${escapeAttr(tooltip)}">
  ```

  其中 `tooltip` = 成功时识别文本 / 错误时 `识别失败: ...` / 其他状态时 fileName。

### 调用方（零改动目标）

| 文件 | 角色 |
|------|------|
| `popup/main/main.html` + `mainUtils.js` | popup 上传图片预览 → OCR |
| `sidebar/main/aichat/aichat.html` + `aichatUtils.js` | sidebar aichat 图片预览 → OCR |

两者都通过 `createImageOcrController(deps)` 注入依赖，**不感知 tooltip 存在**。

### 不在范围

- `runjs/translation/content-ocr.js` / `content-ocr.css`：有独立的 `#ocr-image-preview` 渲染路径（content-script 上下文），**不**走 `createImageOcrController`，本次不动。
- `backgroudtask/translation/ocr.js`：纯 background service worker，零 UI。
- `prompt-optimizer` 之类的 OCR 流程：未用到该 controller，零影响。

## 决策记录（来自 brainstorming）

1. **hover 触发状态**：success **和** error 都显示 tooltip（识别中显示「识别中...」+ fileName，pending 显示 fileName）。保持与原 title 行为等价。
2. **复制反馈**：仅在 tooltip 顶部加一行「已复制」绿条，2 秒后消失。**不**调用 page-level `showTempMessage`（避免双 toast）。
3. **复制内容**：stripThinkTags 之后的纯识别文本（与 `buildImageInfo` 的子串一致；**不**包含 `[fileName]` 前缀）。
4. **架构选择**：tooltip 内置在 controller 内部，不拆成独立模块。理由：tooltip 与 image-preview-item 渲染深度耦合（mouseenter/mouseleave 绑在 item 上，定位依赖 item 中心坐标），独立化反而要传一堆回调。
5. **样式文件**：`shared/imageOcr.css`（新建），由 `imageOcr.js` 在模块首次加载时通过 `document.createElement('link')` 自注入到 `document.head`（与 aichat.js 自注入 `aichat.css` 同模式）。
6. **不使用原生 `title`**：image-preview-item 完全去掉 `title` 属性，确保浏览器不显示半透明黄色系统 tooltip。
7. **依赖注入新项**：`createImageOcrController(deps)` 新增可选 `enableTooltip: true`（默认开启），调用方显式传 `false` 可关闭。

## 设计

### 1. 模块改动（`shared/imageOcr.js`）

**新增模块级状态**：

```js
let tooltipEl = null;        // 单例 tooltip DOM 元素
let tooltipFeedbackTimer = null;  // 「已复制」绿条定时器
let tooltipHideTimer = null;  // 延迟隐藏定时器（用于在出现反馈条时延迟消失）
```

**新增函数 `ensureTooltip()`**：

- 检查 `tooltipEl` 是否存在，不存在则创建并挂到 `document.body`
- 创建时构造：

  ```html
  <div class="image-ocr-tooltip" role="tooltip" data-state="hidden">
    <div class="image-ocr-tooltip-feedback" data-role="feedback"></div>
    <div class="image-ocr-tooltip-body"></div>
  </div>
  ```

- 绑 `click` 监听：触发 `copyTooltipBody()`，**阻止冒泡**
- 模块首次执行时（顶层 IIFE 顶部）**自注入 CSS**：

  ```js
  if (typeof document !== 'undefined' && !document.querySelector('link[data-image-ocr-css]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './imageOcr.css';
    link.dataset.imageOcrCss = '1';
    document.head.appendChild(link);
  }
  ```

  popup 加载 `imageOcr.js` 走 ES module `<script type="module" src="...">` 由 `import` 拉入，**此分支不适用**。`document.createElement('link')` 在 module top-level 注入时 `document` 存在，OK。`aichat.js` 同模式已验证可行。

  注：popup `main.html` 不需要手动 `<link>`，由 module 自注入。

**新增函数 `showTooltip(itemEl, text, isError)`**：

- 计算 `itemEl.getBoundingClientRect()` 中心点
- tooltip 内容：
  - 主体（`image-ocr-tooltip-body`）：`textContent = text`（**不**用 innerHTML，避免 XSS）
  - 反馈条（`image-ocr-tooltip-feedback`）：清空、隐藏
- 位置算法（默认在 item 上方居中）：
  1. `tooltipEl` 临时显示（`data-state="visible"`），测量其 `getBoundingClientRect()`
  2. 候选 left = `itemRect.left + itemRect.width/2 - tooltipRect.width/2`
  3. 候选 top = `itemRect.top - tooltipRect.height - 8`
  4. 边界保护：
     - left < 8 → left = 8
     - left + tooltipRect.width > window.innerWidth - 8 → left = window.innerWidth - tooltipRect.width - 8
     - top < 8 → 改为下方：top = itemRect.bottom + 8
     - 仍然超出 → 仍展示（避免与下文冲突）
  5. 写入 `style.left = left + 'px'` / `style.top = top + 'px'`
- 清空 `tooltipHideTimer`

**新增函数 `hideTooltip(opts)`**：

- `opts.delay = 0` 立即隐藏；`opts.delay > 0` 延迟隐藏
- 设置 `data-state="hidden"`、`style.left = '-9999px'`（彻底离开屏幕避免 hover 测试触发）
- 清除 `tooltipFeedbackTimer`

**新增函数 `showTooltipFeedback(msg)`**：

- 在 `image-ocr-tooltip-feedback` 内 `textContent = msg`（**不**用 innerHTML）
- 移除 hidden class（CSS 控制可见性）
- 清除/重置 2 秒定时器
- 定时器到期：清空 textContent、添加 hidden class

**新增函数 `copyTooltipBody()`**：

- 读 `image-ocr-tooltip-body` 的 `textContent`
- `navigator.clipboard.writeText(text).then(() => showTooltipFeedback('已复制')).catch(() => showAPI... 实际是 showTooltipFeedback('复制失败'))`
- 异常处理：`navigator.clipboard` 可能在非安全上下文失败；fallback 用 `document.execCommand('copy')` 创建一个临时 `<textarea>` + `selectText` + `execCommand`。**但** Chrome extension popup / sidebar 是 `chrome-extension://` scheme，clipboard API **可用**，所以 fallback 保留但不预期触发。
- `e.stopPropagation()` 阻止 click 冒泡到 image-preview-item（item 本身没 click 监听，但若未来增加（例如点图片放大）不会误触发）

**修改 `render()` 函数**：

- 去掉 `title="${escapeAttr(tooltip)}"` 属性
- 给每个 `.image-preview-item` 绑：
  - `mouseenter` → 计算当前 item 的 hover 文案 → `showTooltip(item, text, isError)`
  - `mouseleave` → `hideTooltip({ delay: 0 })`
  - `click`（整个 item）→ **不**新增 click（item 上保持零行为，避免误点）

- 文案选择：
  - `status === 'success'` → `recognizedText`
  - `status === 'error'` → `识别失败: ${recognizedText}`
  - `status === 'recognizing'` → `识别中...`
  - `status === 'pending'` → `fileName`
- 如果 controller 的 `enableTooltip` 为 false：`render()` 保留 `title` 属性（fallback 行为，向后兼容）
- 如果 `ensureTooltip()` 在 `document` 不可用的环境（罕见：某些 background 注入场景）被调用，`document.body` 不存在 → 直接 return（避免抛错）

**修改 `createImageOcrController(deps)`**：

- 解构新增 `enableTooltip`（默认 `true`）
- 把 `enableTooltip` 通过闭包传给 `render()`

### 2. 样式（`shared/imageOcr.css`，新建）

```css
.image-ocr-tooltip {
  position: fixed;
  z-index: 2147483000;        /* 浮于一切之上 */
  max-width: 320px;
  max-height: 200px;
  background: rgba(33, 33, 33, 0.95);
  color: #fff;
  font-size: 14px;
  line-height: 1.5;
  padding: 8px 10px;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  cursor: pointer;             /* 提示可点击 */
  user-select: none;           /* 防止选中文本触发浏览器默认 */
  pointer-events: auto;
  word-break: break-word;
  white-space: pre-wrap;       /* 保留换行 */
  overflow: auto;
  transition: opacity 0.12s ease-in-out;
  opacity: 0;
}

.image-ocr-tooltip[data-state="visible"] {
  opacity: 1;
}

.image-ocr-tooltip-feedback {
  display: none;               /* 默认隐藏 */
  background: #4caf50;
  color: #fff;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 3px;
  margin-bottom: 6px;
  text-align: center;
}

.image-ocr-tooltip-body {
  white-space: pre-wrap;
  word-break: break-word;
}
```

**说明**：
- `cursor: pointer` + `user-select: none`：提示用户可点击；阻止文本选中（避免误触「复制」期望的纯文本选中）
- 实际「复制全文」靠 `click` 触发 **整段** body 的 `textContent`，不依赖文本选区

### 3. 调用方改动

| 文件 | 改动 |
|------|------|
| `popup/main/main.html` | **无**（module 自注入 CSS） |
| `popup/main/mainUtils.js` | **无**（依赖注入接口不变） |
| `sidebar/main/aichat/aichat.html` | **无** |
| `sidebar/main/aichat/aichatUtils.js` | **无** |
| `manifest.json` | **无**（`chrome-extension://` 同源，`<link>` 直接引用本地 CSS） |

### 4. 依赖注入新项

`createImageOcrController(deps)` 扩展为：

```js
{
  getPreviewContainer,   // 已有
  showTempMessage,       // 已有
  onChange,              // 已有
  enableTooltip,         // 新增（可选，默认 true）
}
```

### 5. 错误处理

| 场景 | 行为 |
|------|------|
| `document.body` 不存在（罕见） | `ensureTooltip()` return；render 退化为原 `title` 行为 |
| `navigator.clipboard` 不可用 | fallback 到 `textarea + execCommand('copy')`；若都失败 → tooltip 顶部显示「复制失败」2 秒 |
| 多次 hover 不同 item | 复用 tooltip，更新内容 + 重定位 |
| mouseleave 触发瞬间点 click | `click` 在 `mouseenter`/`mouseleave` 之后由事件循环触发；`hideTooltip` 后仍可点中 tooltip（即使被隐藏） → 实际不会（隐藏后 `pointer-events: auto` 但坐标 `-9999px`，不可点）。**安全。** |
| mouseleave 时反馈条仍显示 | 当前实现：mouseleave 立即隐藏（`delay: 0`）；反馈条视觉上未消失就 hide → 视觉不佳但**功能正常**。如需改进：mouseleave 改为 `delay: 200`，并取消未触发的 hide 定时器。**实施时按简单方案先行，必要时再优化。** |

### 6. 测试要点

1. 打开 popup，上传一张图片 → hover 缩略图 → 自定义 tooltip 出现（**无**浏览器默认半透明黄色 title 出现）
2. tooltip 内容 = 识别成功的纯文本（多行保留换行）
3. 点击 tooltip → 系统剪贴板有该文本 → 顶部绿条「已复制」2 秒消失
4. 移开鼠标 → tooltip 立即消失
5. 上传图片后等失败状态 → hover → tooltip 内容 = `识别失败: ...`
6. 同一 popup / sidebar 在多种状态（pending → recognizing → success / error）切换时，hover 文案实时跟随
7. sidebar aichat 上下文行为一致
8. 滚动 popup 内容时 tooltip 位置不更新（按设计选择，简单实现）

## 文件改动清单

| 动作 | 路径 |
|------|------|
| 修改 | `shared/imageOcr.js`（去掉 title，加 mouseenter/leave，新增 ensureTooltip/showTooltip/hideTooltip/showTooltipFeedback/copyTooltipBody） |
| 新建 | `shared/imageOcr.css` |

## 不在本次范围

- 不改 `content-ocr.js` / `content-ocr.css`（独立 content-script 渲染路径）
- 不改 `backgroudtask/translation/ocr.js`（纯 background）
- 不改 `popup/main/main.html`（module 自注入 CSS）
- 不改 `sidebar/main/aichat/aichat.html` / `aichat.js`（aichat.js 已自注入 `aichat.css`，新 CSS 由 `imageOcr.js` 自注入）
- 不改 `manifest.json`（chrome-extension scheme 同源）
- 不引入 npm 依赖
- 不监听 scroll/resize 重新定位 tooltip（YAGNI 简化版）
