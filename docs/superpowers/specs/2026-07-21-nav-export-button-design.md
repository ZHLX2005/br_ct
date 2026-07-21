# Nav 导出按钮设计

## 背景

`contentScripts/nav/` 已重构为以下架构：

- `entry.js` — manifest 常驻注入，URL→platformId 路由，mount/unmount 开关
- `core/index.js` — orchestrator，编排 collector / view / activeTracker / observers
- `core/collector.js` — 采集 records（querySelectorAll + extractText），纯函数
- `core/activeTracker.js` — 可见度 active 跟踪，含稳定性保护和 clickLock
- `core/observers.js` — IntersectionObserver / scroll / MutationObserver / shell observer 工厂
- `util/disposer.js` — 资源清理（Disposer 模式）
- `util/scheduler.js` — rafThrottle / debounce
- `constants.js` — 行为常量
- `view.js` — 唯一 CSS + DOM 组件，增量 reconcile render/clear/setActive/destroy
- `platforms/*.js` — 17 个平台 adapter，只含 `{itemSel, listSel, textSel?, extractText?}`

现有权限已包含 `downloads`（manifest.json）。

用户希望通过 nav hover 展示时，底部新增一个导出按钮，点击导出当前会话所有发送的消息（用户消息）。

## 设计决策（brainstorm 阶段已确认）

| 决策 | 选择 | 理由 |
|------|------|------|
| 导出范围 | 仅用户消息（与 nav `itemSel` 一致） | 零平台额外适配 |
| 导出格式 | Markdown `.md`，带 YAML frontmatter | 人眼可读 + Obsidian/VSCode 预览 + 可 grep |
| 文件名 | `{platformId}-{YYYYMMDD-HHmmss}.md` | 简单，零适配 |
| 触发方式 | 点击立即下载，零中转 UI | nav 已是轻量组件，误触概率低 |
| 按钮位置 | nav 容器底部，与顶部 handle 上下对称 | 与 row label 同频淡入，hover 时才显示 |
| 特殊消息 | 图片用 `[image]` 占位，代码/公式保留 Markdown 原生语法 | 体积可控 + 结构化信息不丢 |
| 空消息 | 跳过不入导出文件，frontmatter 记录 `skippedCount` | 与 nav 「空文本不入 records」一致 |
| 生成策略 | 所有平台统一 Markdown 模板 | 零平台 adapter 改动 |

## 架构

```text
entry.js ──> core/index.js ──> collector.js (records + fullText)
                        │
                        ├──> view.js (新增导出按钮 UI, onExport 回调)
                        │
                        └──> export.js (新增, 纯函数: Markdown + download)
```

### 模块职责（无重叠）

| 模块 | 当前职责 | 新增职责 |
|------|----------|----------|
| `collector.js` | 采集 `{el, text}`（60字截断） | `records` 增加 `fullText` 字段，存完整文本 |
| `view.js` | 唯一 CSS + DOM + 增量 reconcile + 拖拽 | 底部导出按钮 DOM + CSS + hover 淡入动画；`onExport` 回调配置 |
| `core/index.js` | 编排 lifecycle | 接收 `platformId` / `platformName`；onExport 触发时从 records 取数据 + dynamic import export.js |
| `export.js` | — | Markdown 模板组装 + Blob 创建 + `chrome.downloads.download` |
| `entry.js` | URL 路由 + mount/unmount | 向 createNav 传递 `platformId`, `platformName` |

## 详细设计

### export.js

纯函数，无 DOM 依赖，可单元测试。

```js
@param {Array<{fullText: string}>} records — core 收集的完整消息文本
@param {object} meta
@param {string} meta.platformId
@param {string} meta.platformName
@param {string} meta.sourceUrl
@param {number} meta.messageCount
@param {number} meta.skippedCount

export function exportChat(records, meta) → void
```

**Markdown 模板：**

```markdown
---
exportedAt: "2026-07-21T18:30:00+08:00"
platform: chatgpt
platformName: ChatGPT
sourceUrl: https://chatgpt.com/c/67abc123ef
messageCount: 12
skippedCount: 0
---

# 会话消息

1. 用户第一条消息全文...

2. 用户第二条消息全文...
```

**Blob 下载链路：**

1. `new Blob([markdown], { type: 'text/markdown' })`
2. `URL.createObjectURL(blob)` → `objectUrl`
3. `chrome.downloads.download({ url: objectUrl, filename: 'chatgpt-20260721-183000.md' })`
4. 下载回调中 `URL.revokeObjectURL(objectUrl)`

**降级：** 当 `chrome.downloads` 不可用（非扩展上下文），回退到 `<a download="..." href={url}>` 临时元素触发下载。

### collector.js 改动

`collectRecords` 返回类型从 `Array<{el, text}>` 改为 `{ records: Array<{el, text, fullText}>, skippedCount: number }`。

内部实现：`extractMessageText` 在提取时不截断，返回原始文本；调用方负责截断用于 nav 显示和保存完整文本用于导出。

```js
/**
 * @returns {{ records: Array<{el: Element, text: string, fullText: string}>, skippedCount: number }}
 */
export function collectRecords({ itemSel, textSel, extractText }) {
  const records = [];
  let skippedCount = 0;

  document.querySelectorAll(itemSel).forEach((el) => {
    const rawText = extractRawMessageText(el, { textSel, extractText });
    if (!rawText) { skippedCount++; return; }
    records.push({
      el,
      text: rawText.slice(0, LABEL_TRUNCATE),  // nav 显示用
      fullText: rawText,                         // 导出用
    });
  });

  return { records, skippedCount };
}
```

### view.js 改动

**新增 CSS（追加到 `NAV_CSS` 末尾）：**

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

**createNavView 签名：**

```js
createNavView({ onSelect, onExport? }) → { render, setActive, clear, destroy }
```

**按钮创建逻辑：**

- `createContainer()` 在 handle 之后创建一个 exportBtn（`span` 或 `div`），内容 `📥 导出`
- `clear()` 和 `render()` 跳过 exportBtn（与 handle 一样作为固定子节点）
- 点击 exportBtn → `onExport()` 回调

### core/index.js 改动

```js
// createNav(cfg) 中接收新字段
const { itemSel, listSel, textSel, extractText, platformId, platformName } = cfg;
let skippedCount = 0;

// rebuild() 适配 collectRecords 新返回类型
function rebuild() {
  const result = collectRecords(collector);
  records = result.records;
  skippedCount = result.skippedCount;
  view.render(records.map((r) => r.text));
  ...
}

// onExport 回调
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
    console.warn('[nav] exportChat 加载失败', err);
  });
}

view = createNavView({ onSelect, onExport });
```

### entry.js 改动

```js
const handle = createNav({
  ...platformCfg,
  platformId,
  platformName: PLATFORM_CONFIG[platformId]?.name || platformId,
});
```

## 错误处理

| 场景 | 行为 |
|------|------|
| records 为空 | exportChat 直接 return，不创建空文件 |
| chrome.downloads 不可用 | 回退到 `<a download>` 方式 |
| 下载被用户取消 | download 回调检查 `chrome.runtime.lastError`，静默忽略 |
| URL.createObjectURL 失败 | catch → console.warn，不破坏 nav |
| export.js dynamic import 失败 | console.warn + onExport 静默跳过 |
| 导出过程中 records 变化 | 导出已触发时当前快照不变，下次导出取最新数据 |

## 文件变更清单

```
新增：
  contentScripts/nav/export.js                      ~80 行

修改：
  contentScripts/nav/core/index.js                  ~+20 行
  contentScripts/nav/core/collector.js              ~+15 行
  contentScripts/nav/view.js                        ~+40 行
  contentScripts/nav/entry.js                       ~+2 行

不修改：
  manifest.json        — downloads 权限已存在
  constants.js         — 无新常量需要
  activeTracker.js, observers.js, util/*  — 不影响
  platforms/*.js       — adapter schema 不变
```

## 验收标准

- nav hover 时底部出现「📥 导出」按钮
- 点击按钮后浏览器下载一个 `.md` 文件
- 文件名格式：`{platformId}-{YYYYMMDD-HHmmss}.md`
- frontmatter 包含正确的平台信息、URL、消息计数
- 导出内容为用户发送的文本消息全文，不截断
- 空文本消息跳过，frontmatter 记录 `skippedCount`
- 图片消息以 `[image]` 占位
- 代码块和公式保留 Markdown 原生格式
- records 为空时无导出行
- 非扩展上下文回退到 `<a download>` 方案
- nav 其他功能无回归（增量 reconcile、hover 展开、点击滚动、active 跟随、拖拽、SPA 重建）
