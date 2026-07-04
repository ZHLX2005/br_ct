---
name: runjs-module-standards
description: 当需要在 runjs/ 下新增内容脚本、或扩展 manifest.json 的 content_scripts 注入策略、或评估"是否应该把快捷键脚本放 runjs 还是 funcs"时触发。核心约束：(1) 必要的才注入 — 默认休眠 + 按需激活，避免无差别注入全量代码到所有页面；(2) 快捷键触发优先使用存放在 funcs/ — 快捷键 + 即用即走的脚本走 funcs/ + main() + executeScript 链路，不进 runjs/。
reference: code-standards-guide — runjs/ 内容脚本注入规范（归档版）
---

# runjs/ 内容脚本模块规范

## 核心原则

`runjs/` 是 **MV3 content_scripts 静态注入层** — 脚本会在浏览器打开任意匹配页面时**自动注入**，与 `funcs/` 的"按需 executeScript 注入"是**两套完全不同的生命周期**。

| 维度 | runjs/（content_scripts） | funcs/（executeScript） |
|------|--------------------------|------------------------|
| 注入时机 | 页面加载时自动注入 | popup 点击 / 快捷键触发时按需注入 |
| 生命周期 | 跟随页面，直到关闭 | 单次执行，main() 跑完结束 |
| 入口约定 | 无 main() 包裹，自动执行 | 必须 `function main() { ... }` 包裹 |
| 适用场景 | 持续监听页面（DOM 事件、消息总线、悬浮 UI） | 单次操作（抓取、复制、点击） |
| 默认激活 | 注入即激活 | 仅触发时激活 |
| 体积代价 | 每个匹配的页面都加载 | 仅触发标签页加载 |

**两个铁律：**
1. **必要的才注入** — 默认进入休眠（`isActive = false`），仅在用户开启 / 快捷键触发时才挂载 DOM 监听。
2. **快捷键触发优先使用存放在 funcs/** — 见末尾章节。

---

## 模块职责边界

| 模块 | 职责 | 禁止混入 |
|------|------|---------|
| `runjs/tripleSpace/` | 持续监听键盘三连空格，弹出笔记面板 | 单次抓取 / 复制逻辑（应放 funcs/） |
| `runjs/translation/content.js` | 划词后弹出翻译面板 + 收藏快捷键监听 | 单次抓取脚本、单次 API 调用函数 |
| `runjs/translation/content-ocr.js` | OCR 框选 + 结果面板 + OCR 快捷键 | 仅在用户主动触发时才挂载的逻辑 |
| `runjs/translation/selection-ask.js` | AI 平台页面的划词模板面板 | 与划词无关的纯抓取脚本 |
| `runjs/translation/sidebar-selection-content.js` | 边栏划词浮动按钮（**默认休眠 + 消息激活**） | — |
| `runjs/translation/lib/` | 第三方库的本地副本（marked、katex） | 自写业务代码 |

---

## 铁律 1：必要的才注入（按需激活）

### 反面案例（bad_example）

```javascript
// runjs/xxx.js
// ❌ 注入到所有页面，但只有 1% 用户使用，且功能与具体场景无关

class FeatureManager {
  constructor() {
    this.panel = this.createPanel();   // 注入即创建 DOM
    document.body.appendChild(this.panel);
    this.attachListeners();            // 注入即挂载监听
    this.startObservers();             // 注入即开启 MutationObserver
  }
  // ...
}

new FeatureManager(); // 注入即激活，100% 页面承受 100% 代价
```

```json
// manifest.json — ❌ 无差别全量注入
"content_scripts": [{
  "matches": ["<all_urls>"],
  "js": ["runjs/heavy.js", "runjs/heavy2.js"]
}]
```

**问题**：用户在不需要这个功能的页面（看视频、查文档、刷社交媒体）也要加载全部代码 + 监听器 + DOM。每个 runjs/ 脚本都是全量注入到所有页面。

### 正面案例（good_eg）

参考 `runjs/translation/sidebar-selection-content.js` 的 **`injected-dom-toggle-pattern`** —— 注入即存在，但默认 `isActive = false`，仅在收到广播消息或 storage 状态匹配时才挂载 DOM 监听。

```javascript
// runjs/xxx.js
(function() {
  'use strict';

  let panel = null;
  let isActive = false; // ✅ 默认休眠

  // 监听器只在激活时挂载
  const onMouseUp = (e) => {
    if (!isActive) return;          // ✅ 休眠状态下立即返回
    // ... 处理逻辑
  };

  function activate() {
    if (isActive) return;           // ✅ 防重复
    isActive = true;
    document.addEventListener('mouseup', onMouseUp);
    // ... 其他监听
  }

  function deactivate() {
    if (!isActive) return;
    isActive = false;
    cleanupUI();                    // ✅ 同时清理 DOM
    document.removeEventListener('mouseup', onMouseUp);
  }

  // 初始化只读 storage 状态，不挂载任何监听
  async function initFromStorage() {
    const result = await chrome.storage.local.get(['xxxEnabled']);
    if (result.xxxEnabled) activate();
  }

  // 接收 background 广播消息激活 / 休眠
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'xxxToggle') {
      msg.enabled ? activate() : deactivate();
    }
  });

  initFromStorage();
})();
```

### 必需的才注入 — 检测清单

新增 runjs/ 脚本前必须自检：

- [ ] 这个功能是否 100% 用户 / 100% 页面都需要？若否，必须默认休眠。
- [ ] 监听器（`document.addEventListener`、`MutationObserver`、`setInterval`）是否在激活前就挂载了？若已挂载，需改成激活时才挂。
- [ ] DOM（面板、按钮、遮罩）是否在注入时就创建？若已创建，需改成激活时才创建。
- [ ] 能否按 `matches` 缩小注入范围（如 `<all_urls>` → `https://example.com/*`）？

### 进阶：限定 matches 范围

```json
// ❌ 全量注入
"matches": ["<all_urls>"]

// ✅ 限定注入范围（仅在匹配页面才注入）
"matches": ["https://chat.openai.com/*", "https://gemini.google.com/*"]
```

只在用户**必然**访问的页面（AI 平台）注入 — 浏览器打开其他页面时根本不加载 runjs/。

---

## 铁律 2：快捷键触发优先使用存放在 funcs/

### 为什么快捷键脚本不放 runjs/

| 维度 | runjs/ + content_scripts | funcs/ + executeScript |
|------|--------------------------|------------------------|
| 注入时机 | 每次打开页面都加载 | 仅按快捷键时才加载 |
| 是否需要持久监听 | 是（持续监听快捷键） | 否（单次执行） |
| 入口约定 | 无 main() | 必须 `function main() { ... }` |
| 体积影响 | 每个页面常驻 | 仅触发标签页加载 |
| 复用 popup 点击 | 否（content script 不在 popup 列表） | 是（同一个文件可被 popup 调用 + 快捷键调用） |

**关键判断**：如果脚本是「**按下快捷键 → 抓一下 / 点一下 / 复制一下 → 完事**」，它属于 **funcs/**（单次执行），不属于 runjs/（持久监听）。

### 反面案例（bad_example）

```javascript
// runjs/imgsPicker.js — ❌ 快捷键触发的"抓图脚本"放错位置

let currentShortcut = null;

chrome.storage.local.get(['imgs.shortcut'], (result) => {
  currentShortcut = result['imgs.shortcut'];
});

document.addEventListener('keydown', (e) => {
  if (!currentShortcut) return;
  if (isShortcutMatch(e, currentShortcut)) {
    e.preventDefault();
    pickImagesOnPage();   // ❌ 单次操作，常驻监听换单次执行
  }
});

// 问题 1：每个匹配页面常驻 200 行监听代码
// 问题 2：popup 列表里看不到，无法被点击触发
// 问题 3：快捷键失效需要刷新页面才能重新加载
```

```json
// manifest.json — ❌ 用了 content_scripts
"content_scripts": [{
  "matches": ["<all_urls>"],
  "js": ["runjs/imgsPicker.js"]
}],
"commands": {
  "imgs_picker": { "suggested_key": { "default": "Alt+D" } }
}
```

### 正面案例（good_eg）

**Step 1：脚本放 funcs/**

```javascript
/**
 * @fileoverview 蒙版选区复制工具
 *
 * @scenario    需要从页面蒙版选区中复制文本
 * @feature     蒙版高亮选中区域，复制对应文本到剪贴板
 * @effect      注入蒙版高亮DOM，复制选中区域文本到剪贴板
 * @category    DOM创建
 * @platform    通用
 * @entry       main()
 */

// funcs/元素dom/div_copy_wrapper.js
function main() {
  // ... 单次执行逻辑
  return { copied: text.length };
}
```

**Step 2：manifest.json 的 commands 加快捷键**

```json
"commands": {
  "execute_div_copy": {
    "suggested_key": { "default": "Alt+C" },
    "description": "执行 div Copy 脚本"
  }
}
```

**Step 3：func_executor.js 的 setupFuncCommandListener 加分支**

```javascript
if (command === "execute_div_copy") {
  executeFunctionScript("元素dom/div_copy_wrapper.js", (response) => {
    console.log("快捷键执行结果:", response);
  });
}
```

**好处：**
- ✅ 页面加载时不消耗任何代价
- ✅ 同一个脚本既能快捷键触发，又能 popup 点击触发
- ✅ 符合 [[add-func-script]] 的 9 类别 `@category` 标注体系
- ✅ 走 `executeScript({ files: [...] })` 注入链路，与 popup 调用链路一致

### 快捷键脚本归属决策树

```
新脚本是？
│
├── 持续监听页面（DOM 变化 / 消息总线 / 悬浮 UI / 长时间运行的快捷键）
│   └── ✅ 放 runjs/（默认休眠 + 按需激活）
│
├── 单次操作（按快捷键抓一下 / 点一下 / 复制一下）
│   └── ✅ 放 funcs/（main() 包裹 + manifest commands + func_executor 监听）
│
└── 不确定
    └── 问自己一个问题："这个脚本是否需要监听器长期挂载？"
        ├── 是 → runjs/
        └── 否 → funcs/
```

**当前仓库中的好例子：**
- `funcs/元素dom/div_copy_wrapper.js` → `Alt+C` 触发（funcs/ 路径 ✅）
- `funcs/元素dom/div_Img_wrapper.js` → `Alt+D` 触发（funcs/ 路径 ✅）
- `funcs/元素dom/copy2file.js` → `Alt+F` 触发（funcs/ 路径 ✅）

详见 [[add-func-script]] skill。

---

## 反面 / 正面 案例汇总

### 案例 1：注入策略

#### bad_example

```json
"content_scripts": [{
  "matches": ["<all_urls>"],
  "js": [
    "runjs/heavy-feature-a.js",
    "runjs/heavy-feature-b.js",
    "runjs/heavy-feature-c.js"
  ]
}]
```

所有脚本所有页面都加载 — 即使 90% 用户用不到。

#### good_eg

```json
"content_scripts": [{
  "matches": ["<all_urls>"],
  "js": ["runjs/translation/..."]
}]
```

并在每个脚本内部用 `injected-dom-toggle-pattern` 默认休眠。

### 案例 2：快捷键脚本位置

#### bad_example

```bash
# ❌ 快捷键触发的抓图脚本
runjs/imgsPicker.js     # 200 行 + 持续监听 + content_scripts 注入
```

#### good_eg

```bash
# ✅ 同一功能，正确的位置
funcs/元素dom/div_Img_wrapper.js   # main() + executeScript + 按需注入
```

### 案例 3：默认激活 vs 默认休眠

#### bad_example

```javascript
// runjs/xxx.js
class Feature { /* ... */ }
new Feature(); // 注入即激活，无开关
```

#### good_eg

```javascript
// runjs/xxx.js
let isActive = false;
function activate() { /* 挂载监听 + 创建 DOM */ }
function deactivate() { /* 移除监听 + 清理 DOM */ }
// 注入即休眠，仅在收到 broadcast 消息 / storage 匹配时才激活
```

---

## 模块依赖矩阵

| 文件 | 行数 | 状态 | 注入策略 | 默认激活 |
|------|------|------|---------|---------|
| `tripleSpace/tripleSpace.js` | 295 | ✅ | content_scripts | ✅ 持续监听 |
| `tripleSpace/tripleSpace.css` | 337 | ✅ | content_scripts | — |
| `translation/content.js` | 1537 | ⚠️ 偏大 | content_scripts | ✅ 持续监听 |
| `translation/content-ocr.js` | 1668 | ⚠️ 偏大 | content_scripts | ✅ 持续监听 |
| `translation/sidebar-selection-content.js` | 151 | ✅ | content_scripts | ❌ 默认休眠（**参考范例**） |
| `translation/selection-ask.js` | 466 | ✅ | content_scripts | ✅ 仅 AI 平台激活 |
| `translation/content.css` | 778 | ⚠️ 偏大 | content_scripts | — |
| `translation/content-ocr.css` | 516 | ⚠️ 偏大 | content_scripts | — |
| `translation/selection-ask.css` | 96 | ✅ | content_scripts | — |
| `translation/lib/marked.min.js` | 6 (实际 ≈ 30KB) | ✅ 第三方 | content_scripts | — |
| `translation/lib/katex.min.js` | 0 (实际 ≈ 270KB) | ✅ 第三方 | content_scripts | — |
| `translation/lib/marked.min.css` | — | ✅ 第三方 | content_scripts | — |
| `translation/lib/katex.min.css` | 1 | ✅ 第三方 | content_scripts | — |

**注意**：`content.js` / `content-ocr.js` 各自 1500+ 行且每个匹配的页面都加载 — 后续如需继续膨胀，建议拆分为"轻量骨架（content.js）+ 按需激活子模块（content-xxx.js，默认休眠）"。

---

## 代码异味识别

### 模块大小检查

```bash
# 超过 1500 行的文件需要拆分
for f in $(find . -type f -name "*.js"); do
  lines=$(wc -l < "$f")
  if [ "$lines" -gt 1500 ]; then
    echo "⚠️  $f: $lines 行"
  fi
done
```

**输出应无新行**（`content.js` / `content-ocr.js` 已偏大，新增内容不应加剧）。

### 重复模式检测

```bash
# 检测是否在 runjs/ 中出现 "监听快捷键 + 调用 main 风格函数"（应放 funcs/）
grep -rn "addEventListener.*keydown" runjs/ --include="*.js" | grep -v "Escape"
grep -rn "isShortcutMatch\|currentShortcut" runjs/ --include="*.js"
```

**预期**：除 content.js / content-ocr.js 的现有快捷键监听外，新增脚本不应再写"持续监听快捷键"代码。

### 注入无差别检测

```bash
# 检测 manifest 是否过度使用 <all_urls>
grep -A3 "content_scripts" manifest.json | grep -B1 "<all_urls>"
```

**改进方向**：若新增脚本只用于特定平台，应缩窄 matches。

### 重复 API 调用检测

content.js / content-ocr.js 各自实现了一份 `callLLMNonStream` / `callLLMStream` — 这是潜在的代码重复，未来若需重构应下沉到 `modules/translation/api.js` 共享。

---

## 错误案例警示

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| 单次抓取脚本放进 runjs/ | 每个页面常驻 200 行只为按一次快捷键 | 放进 funcs/ + main() + commands |
| 默认激活 + 持续监听 | 用户访问任何页面都承受 100% 代价 | 默认休眠 + 消息激活（参考 sidebar-selection-content.js） |
| 无差别 `<all_urls>` 注入 | 90% 用户用不到也要加载 | 缩窄 matches 或缩窄功能 |
| 新增 runjs/ 脚本后忘了同步 manifest.json | 注入失败但无报错 | 每次新增都同步 content_scripts.js 数组 |
| 快捷键脚本没用 main() 包裹 | popup 无法复用同一个脚本 | funcs/ 路径强制 main()（见 [[add-func-script]]） |
| manifest commands 加了但 func_executor 没监听 | 快捷键按下无反应 | 两处字符串完全一致 |

---

## 成功标准检查清单

新增 / 修改 runjs/ 模块时确认：

- [ ] 脚本职责是"持续监听"而非"单次操作"（若是后者应放 funcs/）
- [ ] 若不需要 100% 页面激活，默认 `isActive = false`，仅在收到 broadcast 消息时激活
- [ ] DOM 创建和监听器挂载都在 `activate()` 内部，**不在 IIFE 顶层**
- [ ] `deactivate()` 清理所有 DOM + 监听器，避免内存泄漏
- [ ] 注入范围 `matches` 已尽量缩窄（除非确实需要全量）
- [ ] `manifest.json` 的 `content_scripts.js` 数组已同步新增脚本
- [ ] 配套的 CSS 文件放在脚本同目录
- [ ] 监听器数量控制在合理范围（< 5 个 document 级监听）
- [ ] 文件大小未超过 1500 行（拆分参考 sidebar-selection-content.js 的轻量骨架模式）

若涉及快捷键：

- [ ] 快捷键脚本优先放 `funcs/` + main()（参考 [[add-func-script]]）
- [ ] `manifest.json` 的 `commands` 与 `func_executor.js` 的 `setupFuncCommandListener` 字符串完全一致

---

## 相关 Skill

- [[add-func-script]] — 函数脚本（funcs/）的添加规范、main() 包裹、9 类别 `@category`、快捷键绑定三步骤
- [[keyboard-shortcut-architecture]] — 整个扩展的快捷键分层架构（Chrome Commands / content script / 用户自定义）
- [[content-script-reactive-config]] — content_scripts 与 settings 页面的响应式配置同步（已应用在 content.js / content-ocr.js）