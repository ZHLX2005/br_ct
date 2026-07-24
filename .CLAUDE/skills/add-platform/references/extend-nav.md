---
name: extend-nav
description: 增强通用 nav（contentScripts/nav）的指南。当需要给 nav 加复制到剪贴板、快捷键、折叠、自定义按钮等"对所有平台生效"的交互能力时使用。
---

# 增强通用 nav 指南

> 阅读本文档前请先看 `SKILL.md` 第 3 节"扩展点地图"。本文专注于"如何在不破坏现有 nav 架构的前提下加新交互"。

## 1. nav 模块边界（不可越界）

```
nav/
├── view.js          ← DOM/CSS 表现层（唯一可创建 DOM 的地方）
├── core/index.js    ← 编排器（业务逻辑入口）
├── core/collector.js     ← 纯函数（按 selector 拿 records）
├── core/observers.js     ← listener 工厂（IO/scroll/MO）
├── core/activeTracker.js ← active 行跟踪
├── util/disposer.js      ← 解构注册器
├── util/scheduler.js     ← rafThrottle / debounce
├── constants.js          ← 行为常量（CSS class 不在此）
├── export.js             ← Markdown 导出纯函数
└── platforms/{id}.js     ← 平台 adapter（只提供 selector 配置）
```

**铁律**：

| 模块 | 允许 | 禁止 |
|---|---|---|
| `platforms/*.js` | 只导出 `{ itemSel, listSel, textSel, extractText }` | 创建 DOM、副作用、回调、副作用 IIFE |
| `core/collector.js` | 纯函数 | 任何 IO / DOM 写入 |
| `core/observers.js` | listener 工厂 | 调用业务逻辑、直接修改 records |
| `core/activeTracker.js` | active 计算 | 直接操作 view |
| `core/index.js` | 编排、回调注入 | 自己实现 selector 解析（用 collector） |
| `view.js` | DOM/CSS | 调 selector / IO |
| `export.js` | 纯函数 + 下载 | 业务编排 |

## 2. 添加新交互的标准模板

新增任意交互（复制、折叠、快捷键……）都按下面三步走。

### 步骤 A：在 `view.js` 加按钮 + 样式

```javascript
// 1. 顶部新增 class 常量（与现有 EXPORT_CLASS 等同级）
const MY_BTN_CLASS = 'bro-chat-nav__mybtn';

// 2. NAV_CSS 模板字符串里追加样式（用 ${} 插值，不要硬编码）
//    注意：按钮 ≥ 3 个时建议收进 toolbar 容器（详见 nav-ux-patterns.md）
//    并排模式下 padding 不再带 14px 左边距，统一用 `padding: 1px 8px`
const NAV_CSS = `
  ...现有 CSS...
  .${MY_BTN_CLASS} {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 8px;
    font-size: 12px;
    color: var(--bro-chat-nav-text-idle);
    cursor: pointer;
    white-space: nowrap;
    border-radius: 4px;
    transition: color 0.2s ease, background 0.2s ease;
  }
  #${NAV_ID}:hover .${MY_BTN_CLASS} { display: inline-flex; }
  .${MY_BTN_CLASS}:hover { color: var(--bro-chat-nav-text); background: rgba(15,17,21,0.04); }
`;

// 3. createNavView 形参加 onMyAction
export function createNavView({ onSelect, onExport, onCopy, onMyAction }) {
  // ... 现有代码 ...

  const hasMyAction = typeof onMyAction === 'function';
  let myBtn = null;
  if (hasMyAction) {
    myBtn = document.createElement('span');
    myBtn.className = MY_BTN_CLASS;
    myBtn.textContent = '我的按钮';
    myBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onMyAction();
    });
    // 异步动作必须做状态机 + 防重入：参考 nav-ux-patterns.md §2
  }

  // 4. 拖拽判断里跳过新按钮
  //    多个按钮时推荐命中 toolbar 公共祖先，而不是各自 closest（见 nav-ux-patterns.md §1.3）
  nav.addEventListener('pointerdown', (event) => {
    // ...
    if (event.target.closest(`.${MY_BTN_CLASS}`)) return;  // ← 新增
    // ...
  });

  // 5. clear() / render() / destroy() 同步处理 myBtn
  //    clear: removeChild 后再 appendChild（与 exportBtn 同模式）
  //       若按钮 ≥ 3 个，改成 append / detach 整个 toolbar 容器
  //    destroy: 不需要单独处理（navEl.remove() 会带走所有子节点）
}
```

### 步骤 B：在 `core/index.js` 接回调

```javascript
export function createNav(cfg) {
  // ... 现有 onSelect / onExport / onCopy 等 ...

  // 同步动作：返回 Promise<void>，view 基于"已执行"判定 success
  const onCopy = cfg.onCopy || (async () => {
    if (records.length === 0) return;
    const markdown = buildMarkdown(/* ... */);
    await navigator.clipboard.writeText(markdown);
  });

  // 异步动作（向 background 发消息）：**必须**返回 Promise<boolean>
  //   success → view 显示 is-success；error/throw → view 显示 is-error
  //   不要静默 try/catch 吞异常（参考 SKILL.md §5.8）
  const onMyAction = cfg.onMyAction || (async () => {
    if (records.length === 0) return false;
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'navMyAction',             // 自定义 action，在 background.js 注册
        platformId,                        // 来自 cfg，entry.js 已经传进来
        records: records.map(r => ({       // 即时读取，别缓存！records 是 let 可变
          text: r.text,
          fullText: r.fullText,
        })),
      });
      return !!(response && response.status === 'success');
    } catch (err) {
      console.warn('[nav] myAction failed', err);
      return false;
    }
  });

  const view = createNavView({ onSelect, onExport, onCopy, onMyAction });
  // ... 其余不变 ...
}
```

**为什么必须即时读 records**：nav 的 `records` 是 `let records = []` 可变变量；SPA 切对话 / 列表新增消息都会让 `rebuild()` 重新 collect，覆盖旧数组。如果在按钮 click 时不去**现场读** `records`，而是缓存进闭包，复用旧 list 的内容是大概率事件。

**异步动作的 UI 配套**：进入 `nav-ux-patterns.md` §2 查"按钮状态机"模板——`is-busy` 锁、`is-success/is-error` 反馈、setTimeout 还原。

### 步骤 C：测试

```javascript
// DevTools 验证：
JSON.stringify({
  btnExists: document.querySelector('.bro-chat-nav__mybtn') !== null,
  rows: document.querySelectorAll('.bro-chat-nav__row').length,
})
// 期望 btnExists: true（hover 时显示，平时 display: none）
```

## 3. 范例：完整复制到剪贴板

### 需求
nav hover 多一个"复制"按钮，把当前所有用户消息拼成 Markdown 复制到剪贴板。

### 实现位置选择

| 备选 | 优劣 |
|---|---|
| view.js + core/index.js（推荐） | 复用现有 nav 容器，符合所有 nav 现有交互模式 |
| contentScripts/{platform}.js 自己注入 | 重复造轮子，每个平台都得加一次 |
| 通过 chrome.runtime 转发到 background 复制 | 跨扩展消息，不如 content script 自己 clipboard 简单 |

**推荐**：用方案 1。

### 完整 diff（3 个文件）

#### 文件 1：`view.js`

```javascript
// 顶部常量
const COPY_CLASS = 'bro-chat-nav__copy';
const COPY_LABEL = '复制';

// NAV_CSS 末尾（在 EXPORT_CLASS 样式块之后追加）
.${COPY_CLASS} {
  display: none;
  align-items: center;
  gap: 4px;
  padding: 1px 8px 1px 14px;
  font-size: 12px;
  color: var(--bro-chat-nav-text-idle);
  cursor: pointer;
  white-space: nowrap;
}
#${NAV_ID}:hover .${COPY_CLASS} { display: flex; }
.${COPY_CLASS}:hover { color: var(--bro-chat-nav-text); }
.${COPY_CLASS}.is-success { color: #16a34a; }  /* 复制成功的反馈 */

// createNavView
export function createNavView({ onSelect, onExport, onCopy }) {
  if (document.getElementById(NAV_ID)) return null;
  injectStyle();
  const { nav, handle } = createContainer();

  // 现有 exportBtn 创建代码 ...
  let copyBtn = null;
  const hasCopy = typeof onCopy === 'function';
  if (hasCopy) {
    copyBtn = document.createElement('span');
    copyBtn.className = COPY_CLASS;
    copyBtn.textContent = COPY_LABEL;
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await onCopy();
        copyBtn.textContent = '已复制';
        copyBtn.classList.add('is-success');
        setTimeout(() => {
          copyBtn.textContent = COPY_LABEL;
          copyBtn.classList.remove('is-success');
        }, 1200);
      } catch (err) {
        copyBtn.textContent = '失败';
        setTimeout(() => { copyBtn.textContent = COPY_LABEL; }, 1200);
      }
    });
  }

  // 拖拽判断里跳过 copyBtn（与 exportBtn 同位置）
  nav.addEventListener('pointerdown', (event) => {
    // ...
    if (event.target.closest(`.${COPY_CLASS}`)) return;  // ← 新增
    // ...
  });

  // clear() 同步
  function clear() {
    while (nav.children.length > 1) nav.removeChild(nav.lastChild);
    if (hasCopy) nav.appendChild(copyBtn);
    if (hasExport) nav.appendChild(exportBtn);
  }

  // render() 同步
  function render(labels) {
    if (hasCopy && copyBtn.parentNode) nav.removeChild(copyBtn);
    if (hasExport && exportBtn.parentNode) nav.removeChild(exportBtn);

    while (nav.children.length - 1 > labels.length) {
      nav.removeChild(nav.lastChild);
    }
    const count = Math.min(nav.children.length - 1, labels.length);
    for (let i = 0; i < count; i++) {
      const row = nav.children[i + 1];
      const item = row.querySelector(`.${ITEM_CLASS}`);
      if (item.textContent !== labels[i]) item.textContent = labels[i];
    }
    for (let i = nav.children.length - 1; i < labels.length; i++) {
      const { row, item, line } = createRow({ label: labels[i], onSelect });
      nav.appendChild(row);
    }

    if (hasCopy) nav.appendChild(copyBtn);
    if (hasExport) nav.appendChild(exportBtn);
  }
}
```

#### 文件 2：`core/index.js`

```javascript
import { buildMarkdown } from '../export.js';

export function createNav(cfg) {
  // ... 现有 ...
  const onExport = () => { /* 现有实现 */ };

  // 新增 onCopy：默认把 records 拼成 Markdown 复制到剪贴板
  const onCopy = cfg.onCopy || (async () => {
    if (records.length === 0) return;
    const markdown = buildMarkdown(
      records.map(r => ({ fullText: r.fullText })),
      {
        platformId,
        platformName: platformName || platformId,
        sourceUrl: location.href,
        messageCount: records.length,
        skippedCount,
      }
    );
    await navigator.clipboard.writeText(markdown);
    console.log('[nav] copied', records.length, 'messages');
  });

  const view = createNavView({ onSelect, onExport, onCopy });
  // ...
}
```

#### 文件 3：`constants.js`（可选）

```javascript
export const COPY_FEEDBACK_DURATION_MS = 1200;
```

### 测试清单

- [ ] DevTools：`document.querySelector('.bro-chat-nav__copy')` 存在
- [ ] 鼠标 hover nav → 复制按钮显示
- [ ] 点击复制 → 剪贴板有 Markdown
- [ ] 复制后按钮变绿显示"已复制"
- [ ] 拖拽 nav 时不触发复制按钮（pointerdown 跳过）
- [ ] nav 销毁后复制按钮不存在

## 4. 副作用陷阱清单

| 陷阱 | 后果 | 正确做法 |
|---|---|---|
| **id/class 命名冲突** | nav 在 `<all_urls>` 注入，新旧 class 名撞了会让所有页面错乱 | class 名加 `bro-chat-nav__` 前缀 + 子名（如 `__copy`、`__collapse`） |
| **改老 class 名** | 现有逻辑失效；v1.x 已上线用户报错 | 只**新增** class；不要改 `ROW_CLASS` / `ITEM_CLASS` 等 |
| **destroy 漏清理** | 反复创建/销毁后内存泄漏，DOM 残留 | `destroy()` 只需 `navEl.remove()`（会自动带走所有子节点），但 `STYLE_ID` 也要 `style.remove()` |
| **不阻止拖拽** | 拖拽 nav 时点复制按钮会触发拖拽 | `pointerdown` 监听里 `event.target.closest(新按钮 class)` 提前 return |
| **render 没把按钮加回去** | rows 增量更新后按钮消失 | render 末尾 + clear 都要 append 新按钮 |
| **业务逻辑写到 view.js** | view.js 变臃肿，难测 | view.js 只做 DOM/CSS，业务放在 core/index.js 回调里 |
| **adapter 写交互** | 不同平台行为不一致，破坏"通用"特性 | adapter 永远是纯配置对象 |
| **clipboard.writeText 失败无降级** | 用户不知道失败原因 | try/catch + 按钮文字反馈（已复制 / 失败），或参考下方"回调契约" |
| **异步按钮无防重入** | 连点触发多次 sendMessage | `.is-busy` 类锁住第二次点击（见 `nav-ux-patterns.md` §2） |
| **异步回调静默 catch + 没有 return false** | 失败时按钮永远显示绿色 | callback 必须返回 `Promise<boolean>`，或主动 `throw` |
| **按钮各自独立成行 ≥ 3 个** | nav 纵向被撑爆，触发 70vh 限制 | 收进 toolbar 容器（见 `nav-ux-patterns.md` §1） |

## 5. 与 records 生命周期对齐

新交互通常基于 `records` 数组。注意 records 在以下时刻会变：

| 时刻 | 触发 | records 行为 |
|---|---|---|
| 页面 boot 后 | `observeShell` → `onListReady` → `rebuild()` | 重新 collect |
| 列表新增消息 | `observeList` MO → `rebuild()` | 重新 collect |
| 列表删除消息 | 同上 | 重新 collect |
| 用户点击 row | `onSelect` | 不变（只是 scrollIntoView） |
| 用户切换 nav 开关 | entry.js `unmount` → `mount` | 销毁后重建 |
| view.setActive | `tracker.commit` | 不变 |

`onCopy` / `onMyAction` 等回调应在调用时即时读取 records 数组（而不是缓存），因为 records 是 `let records = []` 可变变量。

## 6. 进阶：把 records 暴露给 background

如果新交互需要把数据发到 background 处理（如调用 native host、把汇总消息直接发给当前 AI 平台），有两条路径。

### 路径 A（推荐）：复用 `directSend`，触发 background 自动注入 + 发送

`directSend` 已经在 `backgroudtask/ai_platform_processor.js` 中实现，**sidebar 也在用**。它会复用已注入的 tab、等待 `complete`、按需注入 sendMessage 脚本、重试一次。

```javascript
// core/index.js — "向当前 AI 平台发一条汇总消息" 按钮
async function onSummary() {
  if (records.length === 0) return false;
  const questions = records.map(r => r.fullText).join('\n\n==========\n\n');
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'directSend',
      platform: platformId,             // 来自 cfg，entry.js 已注入
      message: SUMMARY_TEMPLATE.replace('%s', questions),
      switchToTab: false,               // 当前就在本页
    });
    return !!(response && response.status === 'success');
  } catch (err) {
    return false;
  }
}
```

**优点**：nav 不需要关心哪些平台已经注入了 sendMessage 脚本，全交给 background。完整 UI 模板见 `nav-ux-patterns.md` §2（状态机）、§3（异步动作）。

**缺点**：想自定义"发完之后再收集 AI 回复"这种 workflow 就需要走路径 B。

### 路径 B（自定义 action）：直接发 records 给 background

```javascript
const onMyAction = () => {
  if (records.length === 0) return;
  chrome.runtime.sendMessage({
    action: 'navMyAction',             // 在 background.js register setupMessageListener 中注册
    platformId,
    records: records.map(r => ({ text: r.text, fullText: r.fullText })),
  });
};
```

注意：content script 跨扩展消息需要 `manifest.json` 已声明的 `externally_connectable`，本扩展没声明，所以**只能在 content script 内自己处理**或通过 `chrome.runtime.sendMessage` 给自己的 background（默认允许）。

### 两条路径的差别

| 维度 | 路径 A: `directSend` | 路径 B: 自定义 action |
|---|---|---|
| 注入管理 | background 自动按需注入 sendMessage 脚本 | 自己处理（手动注入 / 直接调 `window.__platformScript`） |
| 触发场景 | "向当前 AI 平台发一条消息" | 自定义后续处理（如收集回复、保存历史） |
| 复用 sidebar 基础设施 | ✅ 直接复用 sidebar 已用的路径 | ❌ 需要自己在 background 写 listener |
| 失败处理 | background 内置 retry | 自己实现 |
| 推荐度 | ✅ 90% 场景下用这条 | 仅需要自定义 workflow 时用 |

## 7. 测试用例样例

手动测试时建议覆盖：

| 用例 | 期望 |
|---|---|
| nav 渲染后 hover 显示新按钮 | 按钮可见、可点击 |
| 新交互回调报错 | 按钮状态恢复（不卡死） |
| records=0 时点新按钮 | 不报错 / 不复制空内容 |
| SPA 切对话（records 全换） | 新按钮立即用新 records |
| nav 销毁再重建（新平台进入） | 按钮重新出现 |
| 拖拽 nav 到底部 | 复制按钮仍能点击，不触发拖拽 |

## 8. 与现有 export 功能的对比

| 维度 | 现有 export | 新加 copy |
|---|---|---|
| 触发 | "导出"按钮 | "复制"按钮 |
| 输出 | `<a download>` Markdown 文件 | 剪贴板 Markdown 文本 |
| 复用 | `export.js` `exportChat()` | `export.js` `buildMarkdown()` + `clipboard.writeText` |
| 用户场景 | 存档整段会话 | 粘贴到 IM/邮件 |

可以共用 `buildMarkdown` 纯函数；不要重复实现 frontmatter 拼装逻辑。

## 9. 相关 UX 模式

本文档给出"加新交互"的标准流程。当交互变得更复杂时（如按钮 ≥ 3 个、异步动作）配套阅读：

| Ref | 何时读 |
|---|---|
| [[nav-ux-patterns]] §1 Toolbar 容器 | 按钮数量 ≥ 3，把它们收成横排一行避免 nav 纵向被撑爆 |
| [[nav-ux-patterns]] §2 按钮状态机 | 异步动作必须有的 `busy/success/error` 反馈 + 防重入 |
| [[nav-ux-patterns]] §3 异步动作 | 经 `chrome.runtime.sendMessage` 到 background 的标准结构（directSend vs 自定义 action） |
| [[nav-ux-patterns]] §4 三模式配合 | 复制 / 总结 / 导出 + toolbar 的完整示例 |