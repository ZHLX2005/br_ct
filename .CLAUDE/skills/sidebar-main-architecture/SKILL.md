---
name: sidebar-main-architecture
description: bro_chat 扩展 sidebar/main 目录的完整架构参考。当需要理解、修改或调试 AI Chat / Claude Code 模式时触发，包含模块关系、数据流、状态管理、UI 层级设计
---

# bro_chat sidebar/main 架构

## 触发场景

当用户提到以下内容时触发：

- "sidebar 的整体架构"
- "修改 aichat 的 XXX"
- "cc 模式和 aichat 的关系"
- "在 sidebar 中添加新功能"
- "sidebar 的数据流 / 状态管理"
- "sidebar 的 UI 层级 / DOM 结构"
- "修改 sidebar 的样式 / CSS"

## 目录结构

```
sidebar/main/
├── main.html            ← 骨架 HTML（header + app-view + 隐藏的 prompt selector）
├── main.js              ← 入口：模式切换（AICHAT ↔ CLAUDE_CODE）
├── sidebar.css          ← 共享样式：骨架、变量、切换按钮、滚动条
├── markdownRender.js    ← 安全的 markdown 渲染（无 raw HTML）
│
├── aichat/              ← AI Chat 模式（蓝色主题）
│   ├── aichat.js        ← mount/unmount 入口，加载 CSS+HTML+初始化
│   ├── aichat.html      ← 模板：toolbar、workspace、platform panel、input bar
│   ├── aichat.css       ← 专用样式：bubble、platform pills、send button
│   └── aichatUtils.js   ← 核心逻辑 ~1991 行（本模块的心智核心）
│
└── cc/                  ← Claude Code 模式（橙色主题）
    ├── cc.js            ← 完全自包含的模块 mount/unmount/WS/tab/send
    ├── cc.html          ← 模板：多 tab 栏、路径栏、input、skill 弹窗
    └── cc.css           ← 专用样式：tabs、serve status、path bar、bubble
```

**外部依赖（sidebar/main 外的重要模块）：**

```
popup/main/modules/
├── storage.js           ← STORAGE_KEYS, saveMessageContent, savePlatformStates, loadStoredData, addToHistory
├── platformVisibility.js ← loadPlatformVisibilitySettings, setupPlatformVisibilityMessageListener, getVisiblePlatformCheckboxes
├── uiHelpers.js         ← copyToClipboard, showTempMessage, populateHistory, togglePlatformCheckbox, validateMessageInput, validatePlatformSelection

popup/main/prompts/
├── promptsUI.js         ← populateOptimizer, initAliasShortcut
├── prompts.js           ← PROMPT_TEMPLATES（/alias 快捷输入映射表）

config/platformConfig.js ← PLATFORM_CONFIG（各 AI 平台：名称、图标、颜色）

backgroudtask/
├── nxce_ws.js           ← WebSocket 后台单例（cc 模式专用）
├── func_executor.js     ← 通用函数注入执行（快捷键绑定）

runjs/translation/lib/marked.min.js ← markdown 渲染引擎（通过 <script> 加载到全局）
```

## 总体架构（双模式设计）

```
main.html
└── .app-shell[data-mode="aichat" | "claude-code"]
    ├── .app-header       ← 标题 + 模式切换按钮（始终存在）
    └── #app-view         ← mount/unmount 目标容器
        ├── [AICHAT]  aichat.js mount()
        │   ├── 加载 aichat.css
        │   ├── 注入 aichat.html（toolbar, workspace, panel, input）
        │   └── 初始化 Utils（DOM 缓存、事件、storage、回复监听）
        └── [CLAUDE_CODE] cc.js mount()
            ├── 加载 cc.css
            ├── 注入 cc.html（tabs bar, path bar, input, skill popup）
            └── 初始化 WS 通信、tab 管理器、send、autocomplete
```

**切换逻辑（main.js）：**

```js
// 1. 更新 .app-shell.dataset.mode（触发 CSS 选择器切换主题色）
// 2. 完全卸载旧视图（unmountAichat / unmountCc → container.innerHTML = '' + 断开 WS）
// 3. 挂载新视图（mountAichat / mountCc → fetch HTML + 初始化）
```

**关键是 mount/unmount 接口一致：**
- `mount(container)` — 加载 CSS → fetch HTML → container.innerHTML = html → 初始化
- `unmount(container)` — 断开连接 + container.innerHTML = ''

## AI Chat 模式（aichat/）

### aichat.js — 入口

```js
mount(container):
  1. 加载 aichat.css（仅一次）
  2. fetch aichat.html → container.innerHTML
  3. 首次运行: initializePlatformOptions()
  4. initializePopup()        ← 缓存 DOM + 初始化子系统
  5. initResponse()           ← 注册 chrome.runtime.onMessage 监听
  6. loadStoredData()         ← 从 chrome.storage 恢复状态
  7. setupEventListeners()    ← 绑定所有用户交互事件
```

### aichat.html — UI 层级（从顶到底）

```
toolbar
├── platform-selector-btn     ← AI 平台展开/收起
│   └── platform-count       ← 已选平台数 badge
└── toolbar-actions
    ├── toolbar-selection     ← 划词模式切换
    ├── toolbar-extract       ← 提取页面文本
    ├── toolbar-clear-chat    ← 清空聊天
    └── toolbar-close-ai      ← 关闭所有 AI 标签页

platform-panel                ← 平台选择面板（展开时显示，含 panel 头部「全选/取消全选」）
  ├── platform-panel-header
  │   ├── platform-panel-title "选择 AI 平台"
  │   └── panel-select-all   ← 全选/取消全选（与面板同生命周期）
  └── platform-options-row

workspace-tabs                ← 浏览器标签页快捷方式（"+" 添加）
  └── workspace-tab × N

tab-context-menu              ← 右键菜单（关闭标签页 / 移除工作区）

platform-pills                ← 已选平台的快捷跳转按钮

platform-panel                ← 平台选择面板（checkbox 网格，由 platform-options-row 填充）
  └── platform-options-row

prompt-bar                    ← 当前选中的提示词模板指示器 + 清除按钮

main-pages
  └── page-main
      ├── response-content    ← 聊天回复区（Notion 风格气泡）
      └── response-status     ← 状态指示器（等待/生成/完成/错误）

input-area
├── extract-result            ← 提取/划词结果预览面板（position:absolute，浮在输入框上方）
├── chat-input-bar
│   ├── chat-input            ← textarea 输入框
│   └── chat-input-foot
│       ├── foot-history-btn  ← 历史消息下拉
│       ├── mode-toggle       ← 直发/复制模式切换
│       └── send-btn          ← 发送按钮
└── history-dropdown          ← 历史消息列表
```

### aichatUtils.js — 核心逻辑

**状态变量：**

| 变量 | 类型 | 用途 |
|------|------|------|
| `elements` | `{}` | 缓存 DOM 引用，避免反复 querySelector |
| `saveTimeout` | number | 防抖保存的 timer |
| `lastSavedContent` | string | 对比防抖 |
| `isSaving` | boolean | 防止并发保存 |
| `_extractedTextCache` | string | 划词/提取文本缓存 |
| `isPlatformPanelOpen` | boolean | 平台面板展开状态 |
| `workspaceTabs` | array | 工作区标签列表 |
| `contextMenuTarget` | number | 右键菜单目标索引 |
| `isDirectMode` | boolean | 发送模式 true=直发 false=复制 |
| `platformTabCache` | object | AI 平台 → 真实标签页映射 |
| `savedPlatformStates` | object | 平台 checkbox 状态 |
| `isHistoryOpen` | boolean | 历史下拉状态 |
| `isSelectionMode` | boolean | 划词模式 |
| `platformStates` | Map | 每个 platform 的对话状态（messages, conversationStates） |
| `activePlatformId` | string | 当前显示的 AI 平台 |

**关键函数流：**

```
initializePopup()
  ├── 缓存 DOM（elements 对象）
  ├── initAliasShortcut()     ← 输入 /alias 自动补全
  ├── populateOptimizer()     ← 填充隐藏的 prompt 模板选择器
  ├── loadPlatformVisibilitySettings()
  ├── initWorkspaceTabs()     ← 从 sessionStorage 恢复
  ├── updatePlatformCount()
  ├── loadSendMode()
  ├── syncPromptIndicator()
  └── refreshPlatformTabStatus()

setupEventListeners()
  ├── 平台面板展开/收起
  ├── 输入框 input → autoResize + updateSendButton + 防抖保存
  ├── 输入框 blur → 立即保存
  ├── Enter → startSending()
  ├── Ctrl+S → 手动保存
  ├── beforeunload → 保存
  ├── 平台 checkbox change → savePlatformStates + update
  ├── 全选/取消全选
  ├── 发送按钮 → startSending()
  ├── 关闭 AI 标签页
  ├── 清空聊天
  ├── 提取页面文本
  ├── 划词模式切换
  ├── 提示词栏清除
  ├── 提示词栏点击 → 弹出提示词选择面板（分组左栏 + 模板右栏）
  ├── 历史按钮
  ├── 模式切换（直发/复制）
  ├── 工作区标签 +/-
  ├── 右键菜单
  └── 每 15s → refreshPlatformTabStatus() + updatePlatformCount()

startSending()
  ├── isDirectMode → startDirectSend()（直发：不等待回复，跳转到 AI 页面）
  └── 复制模式（捕获回复）：
      1. 验证输入 + 收集所选平台
      2. applyPromptTemplate → finalMessage（%s/%v 占位符替换）
      3. appendUserMessage（本地写回显）
      4. 长文本（>400字符）→ copyToClipboard
      5. chrome.runtime.sendMessage({ action: "processTaskQueue" })
      6. 等待 background 处理完成
      7. 清空输入框 + clearExtractedContent()

initializeResponseDisplay()
  ├── 缓存 response-content / response-status DOM
  ├── 监听 scroll → shouldAutoScroll
  ├── chrome.runtime.onMessage
  │   ├── /^(\w+)Response$/  → handlePlatformResponse() 流式更新
  │   ├── /^(\w+)CopyCapture$/ → handlePlatformCapture() 复制捕获
  │   └── sidebarSelectionResult → handleSidebarSelection()
  └── 检查 pendingSelection（跨页面关闭时的划词结果中转）
```

**对话状态管理：**

```
platformStates: Map<platformId, {
  activeConvId: string,
  conversationStates: Map<convId, {
    messages: [{ role, messageId, content, html, timestamp, collapsed, isComplete }],
    messageIndex: Map<messageKey, index>
  }>
}>
```

- 每个平台独立管理自己的对话列表
- `appendUserMessage()` + `upsertAssistantMessage()` 双函数增改
- `messageIndex` 保证幂等（同 messageId 更新内容，不再重复追加）
- `moveDefaultConversationTo()` 把默认会话转移到有 ID 的会话
- `collapse/expand` 每个消息可折叠

**渲染系统：**

```
renderCurrentPlatform()
  → renderPlatformMessages(convState)
    → 遍历 convState.messages
      → 每条消息构建 Notion 风格气泡
        → 用户气泡：蓝色右对齐（.notion-chat-bubble--user）
        → AI 气泡：白色左对齐 + 平台彩色头像
        → 每个气泡有 header（name + time + actions[复制, 折叠]）

renderMessageBody(message)
  → user 消息：renderMarkdownText()
  → AI 消息：优先 render HTML（isBareHtmlContainer 判断是否为纯文本），否则 renderMarkdownText()
```

**提示词模板占位符：**

```
%s — 用户输入的原始消息
%v — 提取的网页上下文

applyPromptTemplate():
  有 %s/%v → 替换占位符
  无占位符但有提取内容 → ctx + "\n\n" + user + " " + template
  完全无 → user + " " + template
```

**平台 pill 点击逻辑（`renderPlatformPills`）：**

```js
pill.click → {
  1. 切换 activePlatformId + renderCurrentPlatform()（侧边栏预览）
  2. switchToPlatformTab(platformId)（切换到真实浏览器标签页）
     → 查 platformTabCache → 查 background getPlatformTabStatus
     → 找到 tab 则 switchToTab，未找到则 openPlatformTab
}
```

## Claude Code 模式（cc/）

详见独立 skill `cc-mode`。

## 双模式样式系统

| 层级 | 文件 | 作用域 |
|------|------|--------|
| 全局变量 + 骨架 | `sidebar.css` | 两模式共享：`:root` 变量、`.app-shell`、`.app-view`、`.response-content`、`.input-area`、滚动条、`.cc-toggle` |
| AI Chat 专属 | `aichat/aichat.css` | `.toolbar`、`.workspace-tabs`、`.platform-panel`、`.notion-chat` 气泡、`.chat-input-bar`、发送按钮、提取面板、历史下拉 |
| Claude Code 专属 | `cc/cc.css` | `.cc-tabs` 多 tab 栏、`.cc-path-bar`、`.cc-serve-status`、`.cc-skill-popup` |
| 模式切换 | `sidebar.css:117-138` | `.app-shell[data-mode="aichat"]` 和 `.app-shell[data-mode="claude-code"]` 的切换按钮图标/文字翻转 |

**CSS 核心设计原则：**
- 共用组件定义在 `sidebar.css`（`.response-content`、`.input-area` 等 DOM 容器）
- 专属样式在各子模块的独立 CSS 中，通过 js mount() 动态加载
- 模式切换通过 `data-mode` 属性 + CSS 选择器实现，无需 JS 切换样式

## 通信架构

### AI Chat 模式消息流

```
sidebar (content_script)
  │
  ├── chrome.runtime.sendMessage({ action: "processTaskQueue", ... })
  │   → background: 处理队列，逐平台打开标签页 + 注入脚本 + 发送消息
  │   → background → sidebar: { action: "platformIdResponse", data }
  │   → sidebar: handlePlatformResponse() 流式更新 UI
  │
  ├── chrome.runtime.sendMessage({ action: "directSend", ... })
  │   → background: 直接跳转到 AI 标签页，发送消息
  │
  ├── chrome.runtime.sendMessage({ action: "extractPageText" })
  │   → background: 注入 content script 提取页面文本
  │
  ├── chrome.runtime.sendMessage({ action: "getPlatformTabStatus" })
  │   → background: 返回各平台标签页状态（每 15s 轮询）
  │
  ├── chrome.runtime.sendMessage({ action: "switchToTab" | "openPlatformTab" })
  │   → background: 浏览器标签页切换/创建
  │
  └── chrome.runtime.onMessage（监听回复和划词结果）
      ├── /^(\w+)Response$/ — 流式回复
      ├── /^(\w+)CopyCapture$/ — 复制捕获
      └── sidebarSelectionResult — 划词结果
```

### Claude Code 模式通信流

```
sidebar (content_script)
  → chrome.runtime.sendMessage({ action: "nxce_ws", cmd: "query" })
    → background/nxce_ws.js（WebSocket 单例）
      → WebSocket ws://127.0.0.1:43720
        → npx nx-ce serve

进程管理（直调 native_host）：
  → chrome.runtime.sendMessage({ action: "nativeMessage", payload: { command: "claudeStartServe" } })
    → chrome.runtime.connectNative("com.brochat.prompts_editor")
      → native_host 启动 nx-ce 进程
```

## 存储体系

| 存储 | 用途 | 使用方 |
|------|------|--------|
| `chrome.storage.session` | 发送模式、工作区标签、pending 划词 | aichatUtils |
| `chrome.storage.local` | 划词模式 enabled 标志 | aichatUtils |
| `chrome.storage.sync` | 平台状态、消息历史、提示词选择 | storage.js（popup 复用） |
| `chrome.storage.sync` | lastPromptTemplate | aichatUtils（prompt picker） |
| `chrome.storage.sync` | 平台可见性设置 | platformVisibility.js |
| 内存 Map | platformStates（对话状态） | aichatUtils |

**防抖保存机制：**
- 输入内容 > 1000 字符延迟 300ms，否则 500ms
- 有未完成的保存请求时，新保存请求排队等待（`isSaving` 锁 + 50ms 轮询）
- blur 时立即保存
- beforeunload 时同步保存

## 关键设计决策

### 1. 双模式 mount/unmount 模式

**为什么不用 display:none 切换？**
- 完全卸载旧视图避免事件残留和状态冲突
- mount() 每次注入全新 DOM，无重复事件绑定风险
- 两模式共享 `<div id="app-view">` 容器，互不感知对方 DOM

### 2. aichatUtils.js 单文件 ~1991行

**不拆分的原因（推测）：**
- 所有功能紧密耦合（platform panel ↔ send logic ↔ response display ↔ workspace tabs）
- 模块间通过模块级变量（`elements`, `platformStates`, `workspaceTabs`）共享状态
- 拆分后需要依赖注入或事件总线，复杂度反而上升
- 但拆分是推荐的长期方向（工具函数提取、对话状态管理、平台面板各成模块）

### 3. DOM 缓存模式（elements 对象）

```js
elements = {
  messageInput: document.getElementById("chat-input"),
  sendButton: document.getElementById("chat-btn-send"),
  // ...
};
```

- 初始化时一次性缓存所有 DOM 引用
- 后续所有操作走 `elements.xxx`，避免反复 `querySelector`
- 坑点：mount() 必须每次重新缓存（因为 DOM 是重新注入的）

### 4. Notion 风格对话气泡

- `.notion-chat` flex column 容器包裹所有消息
- 每条消息是 flex row（avatar + bubble）或（bubble 右对齐）
- 每个气泡有 header（name + time + actions[复制,折叠]）+ content
- 支持 markdown 渲染（外挂 marked.min.js）、HTML 富文本、折叠、复制

### 5. 提示词模板双栏选择器

左侧分组列（从 PROMPT_TEMPLATES.group 提取），右侧模板列，点击即设。
promptPicker 浮层挂载到 document.body，点击外部自动关闭。

## 坑点警示

### 架构坑

| 坑点 | 根因 | 预防 |
|------|------|------|
| 两模式共用 `#response-content` DOM ID | 共享容器设计 | 切换到 cc.js 时 aichat 部分已 unmount，但 background 消息仍然可能发过来 |
| `refreshPlatformTabStatus()` 在 cc 模式下继续轮询 | 15s setInterval 在 aichat mount 时启动，切换模式不清理 | cc 模式下收到 `getPlatformTabStatus` 消息会导致 func_executor 日志乱入 |
| aichat 和 cc 有各自的 input/发送逻辑但共用 `#chat-btn-send` DOM | 同名 DOM 不同功能 | cc.js 的 `handleCcSend()` 独立控制，不调用 `mainUtils.startSending()` |

### 发送逻辑坑

| 坑点 | 说明 | 修复 |
|------|------|------|
| 长文本复制后等待 1s 才发送 | `await new Promise(r => setTimeout(r, 1000))` | 考虑用 clipboard API 的 then 代替 hard wait |
| 直发模式下不清空提取内容 | `startDirectSend()` 缺少 `clearExtractedContent()` | 已在新版 aichatUtils 中修复 |
| `applyPromptTemplate` 提取内容 URL 前缀 | `getExtractedContentText()` 返回 `[来自: url]\n文本` | 注意 URL 不可信 |
| enter 键发送与中文输入法冲突 | `keydown` + `!e.shiftKey` | 不带 `isComposing` 检查，中文输入法按 enter 会误触发送 |

### 状态管理坑

| 坑点 | 说明 |
|------|------|
| `elements` 对象在 unmount 后仍持有旧 DOM 引用 | mount 时重新赋值，旧引用会被 GC |
| `platformStates` Map 跨 mount 不重置 | `startSending()` 发送前会 appendUserMessage，unmount 不清理 |
| 切换 tab（aichatUtils 的工作区标签）时 `tab._path` 变化触发 closeSession | cwd 变更时自动清空 _skills 和 UI，但不重建 session |

## 开发清单

修改 sidebar 时按此顺序检查：

- [ ] 改哪个模式？aichat 还是 cc？
- [ ] 新建功能需要在两个模式同步吗？
- [ ] 新增 DOM 元素，需要加到 `elements` 缓存吗？
- [ ] 新增 chrome.runtime message，两边都注册监听了吗？
- [ ] mount/unmount 要清理事件监听和定时器吗？
- [ ] CSS 选择器用了正确的 `[data-mode="..."]` 吗？
- [ ] 提取自 popup 的函数有变化需要同步更新吗？

## 相关 skill

- [cc-mode](cc-mode) — cc 模式的 mount/unmount/WS/tab/send 细节
- [background-module-reorg](./background-module-reorg) — background 后台模块重构
- [add-func-script](./add-func-script) — background 函数注入脚本
