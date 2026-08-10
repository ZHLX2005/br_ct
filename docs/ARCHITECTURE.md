# 架构技术文档

> 本文档描述 Chrome MV3 扩展 **AI Assistant**（v1.5.0）的整体架构。
> 覆盖：多上下文模型、shared 数据层、popup/sidebar/options 三大 UI、background 后台任务、native host 原生通信、内容脚本注入、提示词系统。

---

## 目录

- [1. 总览](#1-总览)
- [2. 多上下文运行时模型](#2-多上下文运行时模型)
- [3. 目录结构](#3-目录结构)
- [4. shared 共享数据层](#4-shared-共享数据层)
- [5. popup 弹出页](#5-popup-弹出页)
- [6. sidebar 侧边栏](#6-sidebar-侧边栏)
- [7. options 设置页](#7-options-设置页)
- [8. background 后台服务](#8-background-后台服务)
- [9. native host 原生通信](#9-native-host-原生通信)
- [10. contentScripts 内容脚本](#10-contentscripts-内容脚本)
- [11. 平台配置中心](#11-平台配置中心)
- [12. 提示词系统](#12-提示词系统)
- [13. 消息发送流程](#13-消息发送流程)
- [14. 跨上下文数据同步机制](#14-跨上下文数据同步机制)
- [15. 单元测试](#15-单元测试)
- [16. 关键设计模式与约定](#16-关键设计模式与约定)
- [17. 相关文档](#17-相关文档)

---

## 1. 总览

**AI Assistant** 是一个多端 AI 调度 Chrome 扩展：
- 在 popup / sidebar / options 三个 UI 中调度多个 AI 平台（元宝、Gemini、ChatGPT、Claude、豆包、DeepSeek、Kimi、Grok 等 18 个）
- 统一拼装提示词模板，将用户消息发送到选定的平台 Tab
- 支持提示词模板管理（新建/编辑/删除/分组）、平台可见性控制、历史记录、页面文本提取、图片 OCR、Claude Code（CC）模式、Git 导入、环境变量管理、云备份等

**技术栈**：Manifest V3 + ES Modules（原生，无打包器）+ Go native host。

### 核心架构决策

| 决策 | 说明 |
|---|---|
| **MV3 service worker 后台** | `background.js` 聚合所有后台任务模块，`type: module` |
| **三个独立 UI 上下文** | popup / sidebar / options 各自加载独立 JS module 实例 |
| **chrome.storage 作为跨上下文总线** | 数据同步靠 `chrome.storage.local` + `chrome.storage.onChanged` |
| **shared/ 无状态 + store 模式** | 每个特性（prompts/platforms/history）一个 store，封装缓存 + 读写 + 订阅 |
| **原生通信走单一中继** | background 维护唯一 `connectNative` 连接，各页面通过 `chrome.runtime.sendMessage` 中转 |
| **平台配置集中式** | 所有平台信息在 `config/platformConfig.js` 一处定义 |

---

## 2. 多上下文运行时模型

这是整个架构的基石。理解它才能理解其他所有部分。

### 2.1 每个页面是独立 JS 上下文

```
┌──────────────────────────────────────────────────────────────────────┐
│                      Chrome 扩展运行时（MV3）                          │
│                                                                      │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐             │
│  │  popup.html  │   │ sidebar.html │   │ options.html │  UI 上下文    │
│  │  (独立 JS)    │   │  (独立 JS)    │   │  (独立 JS)    │             │
│  │  mainUtils   │   │  aichatUtils │   │  platform.js │             │
│  │  promptsStore│   │  promptsStore│   │  promptsStore│ ← 各加载一份  │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘             │
│         │                  │                  │                      │
│         └──────────────────┴──────────────────┘                      │
│                          │                                          │
│              chrome.storage.local / session                          │
│              chrome.storage.onChanged  ← 跨上下文总线                │
│                          │                                          │
│  ┌───────────────────────▼─────────────────────────┐                │
│  │  background.js (service worker, 唯一长驻)        │                │
│  │  - native_relay 单一 connectNative 中继           │                │
│  │  - ai_platform_processor Tab 管理/注入           │                │
│  │  - backup / cloud_backup / translation / ...     │                │
│  └───────────────────────┬─────────────────────────┘                │
│                          │                                          │
│                  ┌───────▼────────┐                                  │
│                  │  native host   │  Go 程序 (brochat_native_host)   │
│                  │  (com.brochat) │  文件操作 / 提示词 / Git / 命令    │
│                  └────────────────┘                                  │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 核心含义

1. **模块级状态是 per-context 副本**，不是全局单例。`popup` 关闭再打开，整个 document 销毁重建，module 从零加载。
2. **用户视角的"数据一致"靠的是**：进程内 `subs.emit()` + 跨上下文 `chrome.storage.onChanged` 触发异上下文订阅者重新读取。
3. **不能在模块级 `let` 变量上共享跨页状态**。任何需要跨页面可见的数据必须走 shared store → chrome.storage。
4. **所有"看起来像单例"的数据**（提示词 / 平台可见性 / 历史 / 当前选中模板）都通过 `shared/<feature>/<feature>Store.js` 层。

> ⚠️ 参见 `memory/cross-context-module-instance-not-singleton.md`。

---

## 3. 目录结构

```
bro_chat/
├── manifest.json              # MV3 清单（权限 / 入口 / content_scripts）
├── background.js              # service worker 入口，聚合所有后台任务
├── config/
│   └── platformConfig.js      # 平台配置中心（18 个平台元信息 + URL 映射）
├── shared/                    # ★ 共享数据层（popup/sidebar/options 共用）
│   ├── core/
│   │   ├── subscribable.js    # 最小 pub/sub 原语（Set + emit）
│   │   ├── storageKeys.js     # 所有 chrome.storage 键名集中声明
│   │   └── nativeBridge.js    # chrome.runtime.sendMessage → native 的 Promise 封装
│   ├── prompts/
│   │   ├── promptsStore.js    # 提示词缓存 + loadAllPrompts + savePromptFile + subscribe
│   │   ├── promptsEditorApi.js# addPrompt / updatePrompt / deletePrompt CRUD
│   │   ├── promptsCore.js     # parseTemplate / composeTemplate / applyPromptTemplate 决策树
│   │   ├── promptsBootstrap.js# 模块加载时的兜底种子数据
│   │   └── promptsCore.test.js
│   ├── platforms/
│   │   └── platformsStore.js  # 平台可见性缓存 + 读写 + subscribe
│   ├── history/
│   │   └── historyStore.js    # 历史记录（LRU 30 条）缓存 + 读写 + subscribe
│   ├── sendMessage.js         # popup/sidebar 共享的发送原语（buildFinalMessage 等）
│   ├── imageOcr.js            # 图片 OCR 控制器
│   ├── inputPersistence.js    # 输入框持久化
│   └── debouncedSave.js       # 防抖保存器
├── popup/                     # action popup（点击扩展图标弹出）
│   ├── shell.js               # 引导：注册视图、hash 路由、打开 sidebar 按钮
│   ├── viewSystem/
│   │   └── viewController.js  # 多视图挂载控制器（attach/detach/init/onActivate/teardown）
│   ├── main/                  # 主页视图（平台选择 + 发送 + 提示词）
│   │   ├── main.js            # init/onActivate/teardown 生命周期
│   │   ├── mainUtils.js       # elements（getter）/ initializePopup / loadStoredData ...
│   │   ├── platformRenderer.js# 动态渲染平台选项
│   │   ├── dragDropHandler.js # 拖放事件
│   │   ├── prompts/
│   │   │   ├── promptsUI.js   # optimizer 下拉 + 内联编辑 + installOptimizer
│   │   │   ├── prompts.js     # PROMPT_TEMPLATES（旧静态模板）
│   │   │   └── groups/*.js    # 各分组的模板文件
│   │   └── modules/uiHelpers.js # checkbox / 按钮 loading / 输入校验 等 DOM 工具
│   ├── func_execute/          # 函数执行视图
│   ├── translation/           # 翻译视图
│   └── _boot_diag.js
├── sidebar/                   # side_panel 侧边栏
│   └── main/
│       ├── main.js            # 双模式切换：aichat ↔ claude-code
│       ├── aichat/            # AI Chat 模式（核心聊天）
│       │   ├── aichat.js      # mount/unmount 生命周期
│       │   ├── aichatUtils.js # 元素绑定 / picker / 历史 / 发送编排（大文件）
│       │   ├── aichat.html    # 布局：top-bar / prompt-bar / 消息区 / 历史
│       │   ├── aichat.css
│       │   ├── promptsPanel.js# 提示词面板（内联编辑 + click-to-apply）
│       │   ├── promptEditor.js# 全屏提示词编辑器（5 字段：label/alias/body/good/bad）
│       │   └── dragDropImageHandler.js
│       └── cc/                # Claude Code 模式（ccDispatcher/ccSkills/ccTabs/...）
├── options/                   # options_ui（打开标签页的设置中心）
│   ├── options.html/js/css    # 侧边导航框架
│   ├── platform/              # 平台显示设置
│   ├── prompts_editor/        # 提示词编辑器（addPrompt 复用范例）
│   ├── storage/               # 存储管理
│   ├── local_cmd/             # 本地命令（core.js / git.js / skill.js / envvar.js）
│   └── focusScroll/           # iframe 滚动
├── backgroudtask/             # 后台任务模块（由 background.js 聚合）
│   ├── ai_platform_processor.js # 平台 Tab 注入 + 发送队列
│   ├── func_executor.js       # 函数执行
│   ├── native_relay/index.js  # ★ native host 单一中继
│   ├── cloud_backup/          # 云备份（登录 + KV 备份/恢复）
│   ├── translation/           # 翻译/OCR/划词
│   ├── html_text_reader/      # 页面文本提取
│   ├── sidebar_toggle.js      # Alt+S 快捷键
│   ├── chatgpt_copy_automation.js
│   ├── message_http_server.js
│   ├── video_plane_server.js
│   └── nxce_ws.js             # CC 模式业务消息 WebSocket
├── contentScripts/            # 注入到 AI 平台页面的脚本
│   ├── nav/                   # 导航高亮系统（entry.js / core/* / platforms/*）
│   └── <platform>.js          # 各平台消息注入（chatgpt/claude/gemini/...）
├── runjs/                     # 通过 web_accessible_resources 暴露的脚本
│   ├── translation/           # 翻译/OCR/划词 content scripts
│   └── sidebar/               # sidebar-selection-content / sidebar-tab-switch
├── modules/                   # bookmarks / translation 辅助
├── funcs/                     # 自定义功能（mods / x / 元素dom / 平台专属）
├── plugins/happy-test/        # 插件
├── native_host/               # Go native host
│   ├── main.go                # 入口：注册全部 command handler
│   └── internal/              # envvars / executor / fileops / gitimporter / gitmon / handler / protocol / prompts / register
└── docs/                      # 技术文档（本文档）
```

---

## 4. shared 共享数据层

### 4.1 设计原则

1. **无状态**：函数不持有 UI DOM 引用，参数传入。
2. **不区分调用方**：popup 与 sidebar 用同一套 API，调用方负责各自 UI 差异。
3. **对称性**：所有 store（prompts/platforms/history）遵循相同模式：
   - 模块级 `cache`（per-context 副本）
   - `createSubscribable()` 的 `subs`
   - 进程内 `subs.emit(cache)` + 跨上下文 `chrome.storage.onChanged` 双重通知

### 4.2 core 原语

**`shared/core/subscribable.js`** — 最小同步 pub/sub：
```js
export function createSubscribable() {
  const subs = new Set();
  return {
    subscribe(cb)   // → () => boolean（unsubscribe）
    emit(value)     // 逐个调用，单个订阅者抛错不影响其余
    getSubscribers()
  };
}
```
- 用 `Set` 使重复注册折叠
- `emit` 内 try/catch，一个坏订阅者不会中断链

**`shared/core/storageKeys.js`** — 所有 `chrome.storage` 键名的唯一权威：
```js
export const STORAGE_KEYS = {
  HISTORY: "messageHistory",
  OPTIMIZER: "selectedOptimizer",
  PLATFORM_VISIBILITY: "platformVisibilitySettings",
  PLATFORM_NAV: "platformNavSettings",
  LAST_MESSAGE: "lastMessage",
  PLATFORM_STATES: "platformStates",
  LAST_PROMPT_TEMPLATE: "lastPromptTemplate",
  PROMPTS_VERSION: "promptsVersion",
};
```
> **约定**：任何新的 chrome.storage 键必须先在此声明。

**`shared/core/nativeBridge.js`** — native 通信的 Promise 封装：
```js
export function sendNativeMessage(payload) {
  // chrome.runtime.sendMessage({ action: 'nativeMessage', payload }, cb)
  // 处理 lastError / 无响应 / status==='error' → 统一 reject(new Error)
}
```
> 所有页面必须经它调用 native，不要直接碰 `chrome.runtime`。

### 4.3 store 模式（以 platformsStore 为最简参照）

每个 store 的四件套：

```js
// ① 模块级缓存（per-context 副本）
let cache = {};

// ② 订阅通道
const subs = createSubscribable();

// ③ 读：加载到 cache（从 chrome.storage.local）
export async function loadPlatformVisibility() { ... cache = result; return { ...cache }; }

// ④ 写：先写 storage，再更新 cache，再进程内 emit
export async function savePlatformVisibility(settings) {
  await chrome.storage.local.set({ ... }, ...);
  cache = { ...settings };
  subs.emit(cache);                    // 进程内立即通知
}

// ⑤ 订阅：进程内 subs.subscribe + 跨上下文 onChanged 双重注册
export function subscribeToPlatforms(cb) {
  const unsub = subs.subscribe(cb);
  const handler = (changes, area) => {
    if (area === 'local' && changes[KEY]) {
      cache = changes[KEY].newValue;
      cb(cache);
    }
  };
  chrome.storage.onChanged.addListener(handler);
  return () => { unsub(); chrome.storage.onChanged.removeListener(handler); };
}
```

### 4.4 promptsStore 特有逻辑

`shared/prompts/promptsStore.js`：
- **数据源**：磁盘上的 `.js` 文件（每个分组一个），经 native host 读写
- **Native 命令**：`getPromptsDir` / `listDir` / `parsePrompts` / `savePrompts`
- **加载**：`loadAllPrompts()` 遍历目录，`parsePrompts` 每个 `<group>.js`，`stamp()` 补 `group` 字段，合并为 `{ [group]: [...] }` cache
- **保存**：`savePromptFile(group, list)` 写文件 → 更新 cache → 读版本 → 写版本 `+1` → `subs.emit(cache)`
- **版本号**：`chrome.storage.local[promptsVersion]`，作为跨上下文"内容变了"的信号（订阅者无需比较内容）

> ⚠️ 写后**必须** bump 版本 + `subs.emit`，两者缺一会导致某侧页面看不到更新。

**`shared/prompts/promptsEditorApi.js`** — 薄 CRUD 封装：
```js
addPrompt({ group, label, alias, template })      // 唯一性检查 + push + savePromptFile
updatePrompt({ group, oldLabel, newLabel, newAlias, newTemplate })
deletePrompt({ group, label })
```
- 唯一性检查：label / alias 均不允许重复
- 成功后自动触发 `subscribeToPrompts`（跨页同步）

**`shared/prompts/promptsCore.js`** — 模板格式与拼接：
- `parseTemplate(template)` → `{ body, good_eg, bad_eg, image_info }`（剥离系统注释）
- `composeTemplate({ body, good_eg, bad_eg, image_info })` → 拼回字符串（注入系统注释）
- `applyPromptTemplate(template, { userMessage, extractedText, imageInfo })` → **整个扩展唯一的"提示词映射"决策树**（详见 [第 12 节](#12-提示词系统)）

### 4.5 历史 / 平台 store

- **historyStore**：`messageHistory`，LRU 最多 30 条，`addToHistory` 去重 + unshift + 截断
- **platformsStore**：`platformVisibilitySettings`，空对象 = 全部可见

---

## 5. popup 弹出页

### 5.1 shell 引导

`popup/shell.js`：
- `setMountPoint(#view-mount)` + `register([...views])` 注册三个视图：main / func / translation
- **主页 inline 特例**：主页 DOM 已 inline 在 shell.html 里，通过 `setViewDom('main', mainInline)` 注入，首次 mount 跳过 fetch（消除首屏挂载延迟）
- **hash 路由**：`VIEW_BY_HASH`，`hashchange → mount(id)`
- **打开 sidebar 按钮**：`chrome.sidePanel.open({ tabId })` 后 `window.close()`

### 5.2 viewController 生命周期

`popup/viewSystem/viewController.js` 是核心中间件，在单一 mount 点 attach/detach 各视图，切换时切页级 `<link>` 隔离 CSS。

生命周期（每个视图）：

```
首次 mount:   loadBody (异步取 body, 期间旧视图仍可见)
              └→ attach(dom) → onActivate(dom) → init(dom)     [view.ready = true]
再次 mount:   attach(dom) → onActivate(dom)
unmount:      teardown(dom) → detach(dom)
```

| 钩子 | 调用时机 | 职责 |
|---|---|---|
| `loadBody` | 仅首次，异步 | fetch 视图 HTML |
| `attach` | 每次 mount，同步 | 挂 DOM |
| `onActivate` | 每次 mount（attach 后，init 前）| ★ 注册 **document 级副作用**（document.addEventListener / body 挂载的 popup / chrome.runtime.onMessage）|
| `init` | 仅首次 mount（onActivate 后）| 一次性绑定 / DOM 缓存 / storage 读取 |
| `teardown` | 每次 unmount | 清理 onActivate 注册的副作用 |
| `detach` | 每次 unmount，同步 | 移除 DOM |

**关键设计**：
- **detach 不销毁实例** → 状态/监听保留，重挂载不重跑 init
- **document 级副作用必须在 onActivate 注册、teardown 清理**（fix round 1 引入的分工）——否则 teardown 清了监听但下次 mount 不重注册，会导致"外点关闭 / 平台可见性更新失效"
- **CSS 加载等待**：`waitForCssLoad` 等新视图 `<link>` CSSOM 解析完再切 DOM，消除"css 从无到有"跳变

### 5.3 主页 main

`popup/main/main.js` 生命周期：
```js
export async function init(rootEl) {
  initializePlatformOptions(rootEl);   // 动态生成平台选项（统一配置）
  await initializePopup(rootEl);       // 缓存 DOM（elements 用 getter）
  setupEventListeners();               // 元素级事件绑定（仅一次）
  setupDragDropEvents(rootEl);
  const optimizerCleanup = installOptimizer(elements.promptOptimizerSelect);
  await loadStoredData();              // 最后恢复 lastPromptTemplate
}
export function onActivate(rootEl) {
  registerDocumentSideEffects(rootEl); // 外点关闭 / alias popup / 平台可见性 onMessage
}
export function teardown(rootEl) {
  teardownView();                      // 统一清理 viewCleanups
}
```

**`mainUtils.js` 的 elements 用 getter（live query）**：
```js
export const elements = {
  get platformCheckboxes() {
    return (_viewRoot || document).querySelectorAll('.platform-icon-option input[type="checkbox"]');
  },
  // ...
};
```
> 这是修复 Bug C 引入的**关键模式**：`querySelectorAll` 返回静态 NodeList，DOM 重渲染后快照陈旧或空。任何在视图生命周期内可能被替换/延迟渲染的 DOM 都要用 getter 而非快照。

**init 顺序敏感**：`installOptimizer` 必须在 `loadStoredData` 之前（populateOptimizer 会生成下拉项，若先恢复 selected-value 会被覆盖回"不使用优化"）。

---

## 6. sidebar 侧边栏

### 6.1 双模式

`sidebar/main/main.js` 管理两种模式，切换时完全卸载旧视图再挂载新视图：

```js
const MODES = { AICHAT: 'aichat', CLAUDE_CODE: 'claude-code' };
function setMode(mode) {
  if (prev === MODES.AICHAT) unmountAichat(view);
  else unmountCc(view);
  if (mode === MODES.AICHAT) mountAichat(view);
  else mountCc(view);
}
```

### 6.2 aichat 模式

`sidebar/main/aichat/` 是核心聊天界面。

**`aichat.js`** — mount/unmount 生命周期（挂载 `aichat.html` 布局到 `#app-view`）。

**`aichatUtils.js`** — 大文件（~1000+ 行），编排一切：
- `elements`（含 `getPlatformCheckboxes()` getter，修复空 NodeList 用）
- `buildPromptPicker()` — 点击 `#prompt-bar` 弹出的分组+模板选择浮层
  - 左侧：分组列表（`mouseenter` 切换 activeGroup）
  - **右侧：顶部"✚ 新建"按钮 + 下方可滚动提示词列表**（新建提示词功能）
  - 每行有编辑图标 → `openInlineEditOnPicker` → 全屏 `promptEditor.open`
  - 点击行 → 应用模板 → 写入 `#prompt-optimizer-select .selected-value` → dispatch `change`
- `syncPromptIndicator()` — 刷新 prompt-bar 指示器
- 历史区 `renderHistorySection`（订阅 history）
- 发送流程编排（调用 shared/sendMessage 原语）
- `viewCleanups` 数组 + `teardownView()`（对齐 popup 的 mainUtils）

**`promptsPanel.js`** — 提示词面板（独立命名空间 `sidebar-prompt-*` / `sidebar-inline-*`）：
- `mountPromptsPanel` / `unmountPromptsPanel`
- 内联编辑 `startInlineEdit`：label/alias/template 三输入 + 确认/取消
- 保存走 `promptsEditorApi.updatePrompt` → 触发 subscribe → 重渲染
- `bindApplyHandler`：点击 prompt 标签即"采用"，写入 `#prompt-optimizer-select` 并 dispatch change

**`promptEditor.js`** — 全屏编辑器（5 字段：label / alias / body / good_eg / bad_eg）：
- 经 native host `parsePrompts` / `savePrompts` 直接读写磁盘 `.js` 文件
- 用 `promptsCore` 的 `parseTemplate` / `composeTemplate` 在 body+good+bad 与单字符串间互转

> ⚠️ **两条并行编辑路径**（历史遗留）：
> - 路径 A：`promptsPanel.js` 内联 → `promptsEditorApi`（共享数据层，跨页同步）
> - 路径 B：`promptEditor.js` 全屏 → 原生 host `savePrompts`（直接写磁盘）
> 新增 UI 建议走路径 A（`promptsEditorApi` + `subscribeToPrompts` 自动跨页同步）。

### 6.3 cc 模式

`sidebar/main/cc/` 是 Claude Code 模式，模块化：
- `modules/features/ccDispatcher.js` — 指令分发
- `ccExtract.js` / `ccSend.js` / `ccSkills.js` / `ccTabs.js` / `ccUI.js`
- `modules/common/ccBgComms.js` — 与 background 通信

---

## 7. options 设置页

`options/options.html` 打开为标签页，左侧导航 + 右侧 iframe 内容：
- **platform/index.html** — 平台显示设置（platform.js）
- **prompts_editor/** — 提示词编辑器（复用 `addPrompt`，`addModal` 三字段 label/alias/template）
- **storage/** — 存储管理
- **local_cmd/** — 本地命令（core.js / git.js / skill.js / envvar.js）
- **focusScroll/** — iframe 滚动代理

options 已用 `subscribeToPrompts`，共享数据层重构后透明受益。

---

## 8. background 后台服务

`background.js`（MV3 service worker，`type: module`）聚合全部后台任务：

```js
setupTabUpdateListener()          // ai_platform_processor：AI 平台 Tab 注入
setupAIProcessorListener()        // 发送消息处理
setupFuncCommandListener()        // 函数执行
setupFuncExecutorListener()
initVideoPlaneServer()            // 视频片段播放器
initBackupService()               // 备份
setupCloudBackupModule()          // 云备份（登录 + KV）
setupTranslationModule()          // 翻译/OCR/划词
setupHtmlTextReaderListener()     // 页面文本提取
setupSidebarCommandListener()     // Alt+S
setupNativeRelay()                // ★ native host 中继
setupNxceWs()                     // CC 模式业务消息 WS
```

**关键模块**：
- `ai_platform_processor.js` — `injectedTabs` Map 追踪已注入平台 Tab，`processTaskQueueConcurrent` 复用/创建平台 Tab 并发送
- `native_relay/index.js` — **单一 native 连接中继**（见下节）
- `cloud_backup/` — api.js / index.js / messageHandler.js / service.js
- `nxce_ws.js` — CC 模式业务消息 WebSocket 单例

---

## 9. native host 原生通信

### 9.1 架构

```
popup / sidebar / options / background
        │ chrome.runtime.sendMessage({ action: 'nativeMessage', payload })
        ▼
background native_relay (唯一 connectNative 连接)
        │ nativePort.postMessage(payload)
        ▼
brochat_native_host.exe (Go, com.brochat.prompts_editor)
        │ 命令注册表 handle → 响应
        ▼
background native_relay 队列 → sendResponse
```

### 9.2 background 中继（`backgroudtask/native_relay/index.js`）

- **单例连接**：所有页面共享一个 `connectNative`，避免每页开一条
- **请求队列**：`pendingRequests` FIFO，native 响应到达时 `shift()` 并 `sendResponse`
- **自动重连**：非用户手动断开时 3 秒后重连
- **用户手动断开**：`userDisconnected = true`，阻止自动重连（`nativeDisconnect` 命令）
- 业务消息经 `chrome.runtime.onMessage` 中转，`return true` 保持异步响应有效

### 9.3 Go native host（`native_host/main.go`）

命令注册表模式，按功能域注册 handler：

| 域 | 命令 |
|---|---|
| 文件操作 | `readFile` `writeFile` `listDir` `scanSkills` `syncSkillDir` `deleteSkill` ... |
| Git Skill 导入 | `gitCloneAndDiscover` `gitImportSkills` `gitCleanupTemp` |
| 提示词 | `parsePrompts` `savePrompts` `getPromptsDir` `createBackup` |
| 命令执行 | `startProcess` `stopProcess` `listProcesses` `removeProcess` |
| Git 监控 | `gitStatus` `gitPull` `gitPush` `gitBatchStatus` `gitBatch*` `gitAutoCommitAndPush` |
| 环境变量 | `saveEnvSnapshot` `getUserPath` `addUserPath` `setUserEnvVar` ... |
| 业务 | `claudeStartServe` |

**消息循环**：goroutine 里 `protocol.ReadMessage(stdin)` → `registry.Handle` → `protocol.SendResponse(stdout)`。stdin EOF 后不立即退出——轮询 `HasActiveChildren()`，避免 Chrome SW 断开时连坐杀死长寿命子进程。

---

## 10. contentScripts 内容脚本

两处注入（见 manifest）：

1. **全局**（`<all_urls>`，document_idle）：`runjs/translation/*`（翻译/OCR/划词）+ `runjs/sidebar/*`
2. **AI 平台站点**（`contentScripts/nav/entry.js`）：导航高亮系统 + 消息接收

`contentScripts/nav/` 结构：
- `entry.js` — 入口
- `core/index.js` `collector.js` `observers.js` `activeTracker.js` — 核心逻辑
- `platforms/*.js` — 各平台适配
- `constants.js` / `export.js`

> ⚠️ **内容脚本调试要点**（memory/chrome-content-script-cache-debugging.md）：content script 运行在 isolated world，console.log 可能不出现在页面 DevTools；用 `document.documentElement.setAttribute('data-...', ...)` 跨隔离世界标记。

---

## 11. 平台配置中心

`config/platformConfig.js` — **唯一平台权威源**（18 个平台）：

```js
export const PLATFORM_CONFIG = {
  yuanbao:    { name, icon, color, url, defaultVisible, hasNav },
  gemini:     { ... },
  // ... 18 个
};
```

**导出函数**：
- `getPlatformUrls()` → `{ platformId: url }`（ai_platform_processor 用）
- `getPlatformIdByUrl(url)` → URL → platformId 反查（origin + pathname 前缀匹配，忽略 query/hash，支持 hash-router 平台如小米）
- `getPlatformIds()` / `getPlatformConfig(id)`

**添加新平台**：只需在此文件加一个条目，popup 平台选项、发送、nav 高亮全部自动生效。

---

## 12. 提示词系统

### 12.1 存储格式

每个分组一个 `.js` 文件，内容为：
```js
export default [
  { group, label, alias, template },
  ...
];
```

### 12.2 模板文本格式（`promptsCore.js`）

```
<正文（可含 %s / %v / %i 占位符）>
image_info:
[以下是图片识别结果 — image_info = OCR 自动填充]
<图片识别内容>
good_eg:
[以下是推荐的示例 / 期望你采用 — good_eg = good example]
<好例内容>
bad_eg:
[以下是不推荐的、应避免的反例 — bad_eg = bad example]
<反例内容>
```

- 系统注释行在保存时自动注入、加载时自动剥离（用户只见自己的内容）
- 老模板（无标记）向前兼容

### 12.3 applyPromptTemplate 决策树

这是**整个扩展唯一的"提示词映射"决策树**（`promptsCore.js:182`）：

```
① 模板为空 → 直接返回 userMessage
② parseTemplate → { body, good_eg, bad_eg, image_info }
②.5 %i（图片 OCR）：body 含 %i → 原位替换；不含且 imageInfo 非空 → 兜底前置
③   %v（提取文本）：body 含 %v → 原位替换；不含且 ctx 非空 → 兜底前置
④   %s（用户消息）：body 含 %s → 替换；不含且 user 非空 → 兜底前置
④.5 image_info 段非空 → 拼 [相关图片信息] 标题
⑤   good_eg/bad_eg 段非空 → 拼 Header + 系统注释 + 内容
⑥ 返回完整 prompt
```

**边界规则**：
- 完全无占位符：`<user> <body>`（沿用旧行为）
- 有 `%s` 无 `%v` 且有 ctx：ctx 兜底前置
- 占位符与提取文本共存：以模板显式定义为准

### 12.4 新建/编辑入口对照

| 入口 | 位置 | 路径 | 字段 |
|---|---|---|---|
| 新建 | sidebar picker 右侧顶部"✚ 新建" | `addPrompt`（共享层）| label/alias/template |
| 内联编辑 | sidebar promptsPanel | `updatePrompt`（共享层）| label/alias/template |
| 全屏编辑 | sidebar promptEditor | 原生 host `savePrompts` | label/alias/body/good/bad |
| 添加（options）| prompts_editor addModal | `addPrompt`（共享层）| label/alias/template |

---

## 13. 消息发送流程

`shared/sendMessage.js` 提供 4 个无状态原语，消除 popup/sidebar 重复逻辑：

1. **`buildFinalMessage({ templateContent, hasTemplate, userMessage, extractedText, imageInfo })`** — 统一走 `applyPromptTemplate` 决策树
2. **`getSelectedPlatformIds(checkboxes)`** — 提取"可见且勾选"的平台 ID（`closest('.platform-icon-option')` 且 `display !== 'none'`）
3. **`closeAllAITabs(onStatus)`** — 关闭所有 AI Tab
4. **`saveMessageHistory(msg, addToHistoryFn)`** — 统一 try/catch 保存历史

发送主流程（sidebar 视角）：
```
用户输入 → validateMessageInput → 选平台 checkbox → buildFinalMessage
  → chrome.runtime.sendMessage → background ai_platform_processor
  → processTaskQueueConcurrent（复用/创建平台 Tab）
  → contentScripts/<platform>.js 注入消息
  → 平台 Tab 发送
```

**不进 shared 的（caller 特有）**：`processTaskQueue` vs `directSend`（不同 background action 和并发策略）、按钮 loading 状态管理、`getExtractedContentText`（sidebar 特有）。

---

## 14. 跨上下文数据同步机制

### 14.1 三层同步

```
                  同 context                     跨 context
写入方 → store.cache 更新 → subs.emit()  ─┐     chrome.storage.local.set
                                         │              │
同页订阅者  ←──────────────────────────────┘   chrome.storage.onChanged
                                         │              │
异页订阅者  ←───────────────────────────────────────────────────┘
```

1. **进程内**：写 store → `cache = ...` → `subs.emit(cache)` → 同 context 订阅者立即看到
2. **跨 context**：写 storage → `chrome.storage.onChanged` 触发 → 异 context 订阅者读取新 cache
3. **订阅者双重注册**：`subs.subscribe(cb)` + `chrome.storage.onChanged.addListener(handler)`，unsubscribe 合并清理

### 14.2 订阅/退订契约

```js
const unsub = subscribeToPrompts(cb);
// ...
unsub();   // 同时移除进程内订阅 + onChanged 监听
```
> ⚠️ 订阅后必须把 `unsub` 推入 `viewCleanups`，否则跨重载累积监听（内存泄漏 + 多次触发）。

### 14.3 相关 memory

- `cross-context-module-instance-not-singleton.md` — 每个 context 独立 module 实例
- `platform-checkboxes-snapshot-pattern.md` — DOM 快照 vs live query getter
- `missing-import-after-export-symmetry.md` — export/import 对称性审计

---

## 15. 单元测试

`shared/` 下有 `*.test.js`，用 node 直接运行：

```bash
node shared/core/subscribable.test.js
node shared/prompts/promptsStore.test.js
node shared/prompts/promptsCore.test.js
node shared/prompts/promptsEditorApi.test.js
node shared/history/historyStore.test.js
node shared/platforms/platformsStore.test.js
```

**测试原则**：
- 测纯函数逻辑（parseTemplate/composeTemplate/applyPromptTemplate 决策树）
- 测 store 的订阅契约（subscribe → unsubscribe 幂等）
- 不依赖真实 chrome API（mock 或不触发）

---

## 16. 关键设计模式与约定

### 16.1 模式清单

| 模式 | 说明 | 出处 |
|---|---|---|
| **live query getter** | DOM 可能被替换/延迟渲染时用 getter 而非 `querySelectorAll` 快照 | `mainUtils.js` elements |
| **store 四件套** | cache + subs + 读写 + 双重订阅 | `platformsStore.js` |
| **写后双通知** | 写 storage 后 `subs.emit` 必须成对 | `savePromptFile` |
| **export/import 对称** | 暴露新 symbol 时必须 grep caller 确认 import | `fb4da25` |
| **静默失败加日志** | 所有"查找后 return"路径加 `console.warn` | `openInlineEditOnPicker` |
| **onActivate 注册 document 副作用** | document 级监听在 mount 时注册、unmount 时清理 | `viewController.js` |
| **viewCleanups 归零** | 扩展重启重置 JS context，模块级数组自动归零 | 全局 |
| **CSS 命名空间隔离** | popup `prompt-edit-icon` / sidebar `sidebar-prompt-*` 互不干扰 | `promptsPanel.js` |
| **native 通信单一入口** | 所有页面走 `sendNativeMessage` + background 单一中继 | `nativeBridge.js` |

### 16.2 约定

- **所有 chrome.storage 键** 必须在 `storageKeys.js` 声明
- **所有 native 调用** 必须经 `nativeBridge.sendNativeMessage`（popup 侧）或 `native_relay`
- **跨页共享数据** 必须走 shared store，不能直接依赖模块级变量
- **新 UI 的提示词写操作** 建议走 `promptsEditorApi`（路径 A），自动获得跨页同步
- **DOM 查询** 一律 scope 到 rootEl，不用 `document.*` 全局查询（视图隔离）

### 16.3 编码风格

- 每文件 200-400 行理想，`aichatUtils.js` 已超（历史包袱）
- 函数注释用 JSDoc 风格块注释（文件头说明模块职责）
- `[boot]` 前缀日志用于启动链路；`[feature]` 前缀用于特性内调试
- 中文注释，面向中文开发者协作

---

## 17. 相关文档

- `docs/debug-session-2024-08-11-regression-fix.md` — popup/sidebar 交互回归修复调试记录
- `docs/superpowers/plans/` — 历史实施计划
- `docs/superpowers/specs/` — 设计规格
- `memory/cross-context-module-instance-not-singleton.md`
- `memory/platform-checkboxes-snapshot-pattern.md`
- `memory/missing-import-after-export-symmetry.md`
