# Shared 数据层 + 三处独立提示词 UI 设计文档

**日期**: 2026-08-10
**作者**: Claude (brainstorming → 待 writing-plans)

---

## 目标

将 popup / sidebar / options 三处共用的数据（提示词、平台选择、历史记录）抽离到 `shared/` 目录的**数据层**。三处 UI 独立实现、不复用 DOM/CSS，但通过数据层共享同一份磁盘数据，并通过订阅机制实现「一处修改，三处立即生效」。

成功标准：

1. **数据层单一真源**——三个 UI 看到的提示词始终来自同一份 disk 文件（受编译期硬编码兜底）。
2. **保存即时生效**——options 编辑器修改提示词后，popup/sidebar 当前会话中下次打开下拉框立即反映。
3. **新增提示词即时刷新**——保存新增的提示词在 popup/sidebar 下拉框中立即出现。
4. **UI 解耦**——popup / sidebar / options 三处 UI 文件互不引用，各自独立维护。

---

## 背景与现状

### 当前 prompt 数据流

```
[ disk: popup/main/prompts/groups/*.js ]
            ↓ (编译期 import)
[ popup/main/prompts/prompts.js → PROMPT_TEMPLATES ]
            ↓ (import)
[ popup/main/prompts/promptsUI.js → populateOptimizer ]
            ↓ (import)
[ popup/main/mainUtils.js ] [ sidebar/main/aichat/aichatUtils.js ]
```

**问题**：
1. PROMPT_TEMPLATES 是**编译期静态导入**——disk 文件改了不重启扩展永远不生效
2. options 编辑器通过 native host 写 disk 后，popup/sidebar 完全感知不到
3. 三处 UI 都各自维护 prompt 相关代码（promptsUI 在 popup/aichat 都 import，编辑能力只在 options）

### 当前共享数据散落

| 数据 | popup 位置 | sidebar 位置 | options 位置 |
|------|-----------|-------------|-------------|
| 提示词 | `popup/main/prompts/*` | 引用 popup 提示词 | `options/prompts_editor/*` |
| 平台可见性 | `popup/main/modules/platformVisibility.js` | 引用 popup 模块 | `options/platform/index.html` |
| 历史记录 | `popup/main/modules/storage.js#addToHistory` | 引用 popup 模块 | `options/storage/storage.js` |

---

## 架构

```
┌─────────────────────────────────────────────────────────┐
│ UI 层（三处独立，互不引用）                              │
│                                                          │
│  ┌──────────────────┐ ┌─────────────────┐ ┌──────────┐  │
│  │ popup 提示词 UI  │ │ sidebar 提示词 UI│ │ options │  │
│  │ (inline 选择器 + │ │ (panel 选择器 + │ │ 提示词    │  │
│  │  就地编辑)       │ │  就地编辑)       │ │ 编辑器    │  │
│  └──────────────────┘ └─────────────────┘ └──────────┘  │
│         │                  │                  │          │
│         └──────────────────┼──────────────────┘          │
│                            ↓ 调用                        │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ shared/ 数据层（新增）                              │ │
│  │                                                     │ │
│  │  prompts/                                           │ │
│  │   ├─ promptsStore.js        loadAllPrompts()       │ │
│  │   │                            savePromptFile()    │ │
│  │   │                            subscribeToPrompts()│ │
│  │   ├─ promptsEditorApi.js     add/update/delete     │ │
│  │   └─ promptsCore.js          (迁移原 promptsCore)  │ │
│  │                                                     │ │
│  │  platforms/                                         │ │
│  │   └─ platformsStore.js       visibility CRUD       │ │
│  │                                                     │ │
│  │  history/                                           │ │
│  │   └─ historyStore.js         load/add/subscribe    │ │
│  │                                                     │ │
│  │  core/                                              │ │
│  │   ├─ storageKeys.js          STORAGE_KEYS 集中定义 │ │
│  │   └─ nativeBridge.js         chrome.runtime 中转    │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│ disk + chrome.storage.local                             │
│   - popup/main/prompts/groups/*.js (prompt 文件)         │
│   - chrome.storage.local[promptsVersion] (变更版本号)    │
└─────────────────────────────────────────────────────────┘
```

---

## shared 数据层 API

### `shared/prompts/promptsStore.js`

```js
// 加载：启动时一次性拉所有 prompt 文件，merge 进内存缓存
// 失败时回退到编译期硬编码（兜底）
export async function loadAllPrompts(): Promise<{
  code_gen: PromptItem[],
  analyze_plan: PromptItem[],
  custom_design: PromptItem[],
  read: PromptItem[],
  search: PromptItem[],
  other: PromptItem[],
}>

// 保存：覆盖写整个 group 文件（与现有 native host 接口对齐）
export async function savePromptFile(group: string, list: PromptItem[]): Promise<void>

// 订阅：监听 promptsVersion 变化，触发回调（用于刷新 UI）
export function subscribeToPrompts(cb: (snapshot) => void): () => void

// 当前内存快照（同步访问，避免 UI 重复异步等待）
export function getCurrentPrompts(): { [group]: PromptItem[] }
```

### `shared/prompts/promptsEditorApi.js`

```js
// 高层封装：基于 promptsStore 做细粒度操作
export async function addPrompt({ group, label, alias, template }): Promise<void>
export async function updatePrompt({ group, oldLabel, newLabel, newAlias, newTemplate }): Promise<void>
export async function deletePrompt({ group, label }): Promise<void>
```

### `shared/platforms/platformsStore.js`

```js
export async function loadPlatformVisibility(): Promise<Record<string, boolean>>
export async function savePlatformVisibility(settings: Record<string, boolean>): Promise<void>
export function subscribeToPlatforms(cb): () => void
```

### `shared/history/historyStore.js`

```js
export async function loadHistory(): Promise<string[]>
export async function addToHistory(message: string): Promise<string[]>
export function subscribeToHistory(cb): () => void
```

### `shared/core/storageKeys.js`

```js
export const STORAGE_KEYS = {
  HISTORY: "messageHistory",
  OPTIMIZER: "selectedOptimizer",
  PLATFORM_VISIBILITY: "platformVisibilitySettings",
  PLATFORM_NAV: "platformNavSettings",
  LAST_MESSAGE: "lastMessage",
  PLATFORM_STATES: "platformStates",
  LAST_PROMPT_TEMPLATE: "lastPromptTemplate",
  PROMPTS_VERSION: "promptsVersion",  // 新增：变更触发
};
```

### `shared/core/nativeBridge.js`

封装 chrome.runtime.sendMessage 调 background native_relay 的薄包装：

```js
export function sendNativeMessage(payload): Promise<{ status, data, message }>
```

---

## UI 层（三处独立）

### 1. popup 提示词 UI

文件：`popup/main/prompts/promptsUI.js`（保留现有位置，但改为只调 shared API）

UI 形态：
- 下拉框中**每个提示词项旁边有一个 SVG 编辑 icon**（非 emoji）
- 点击 icon → 该项就地变为 input + 确认/取消按钮
- 点击确认 → 调 `promptsEditorApi.updatePrompt(...)` → 触发 subscribe → 重渲染
- 失败 → 还原 + 红色 toast

调用关系：
```js
// popup 启动
import { loadAllPrompts, subscribeToPrompts } from "../../shared/prompts/promptsStore.js";
await loadAllPrompts();  // 覆盖编译期硬编码
subscribeToPrompts(refreshPromptDropdown);
```

### 2. sidebar 提示词 UI

文件：`sidebar/main/aichat/promptsPanel.js`（新增，独立模块）

UI 形态：
- 与 popup 选择器独立实现，**不复用 popup 的 HTML/CSS**
- 同样的就地编辑交互
- 同样的 subscribe 订阅

### 3. options 提示词编辑器

文件：`options/prompts_editor/prompts_editor.js`（重写）

UI 形态：
- 完整列表 + 编辑表单（保留现有功能）
- 调用 `promptsEditorApi` 完成 CRUD
- 文件列表、新增弹窗、删除等全部走 shared API

---

## 关键设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| API 粒度 | `loadAllPrompts` + `savePromptFile` + `subscribe` | 与现有 native host 接口一对一映射，避免细粒度状态管理 |
| 编译期兜底 | 保留硬编码作为初始值，disk 失败时降级 | 离线/native host 未启时仍能用 |
| 同步机制 | 写后 bump `promptsVersion` + `chrome.storage.onChanged` 监听 | 解耦，模式现成（与 selection-ask 一致） |
| UI 复用 | 三处独立，不复用 HTML/CSS | 用户明确要求解耦 |
| 编辑 icon | SVG，非 emoji | 用户明确要求 |
| 保存时机 | 确认按钮（不是 blur/debounce） | 用户明确要求 |
| 失败回滚 | 保存失败保留原值 + 红色 toast | 编辑场景下不允许"看上去成功实际没存" |

---

## 错误处理

| 错误 | 处理 |
|------|------|
| native host 离线（`promptsStore` 抛 NativeUnavailable） | UI 层 catch 后回退到编译期硬编码，红色 toast「native host 未连接」 |
| disk 写失败 | `savePromptFile` 抛错，UI 层 catch 后保持原值，红色 toast「保存失败」 |
| 并发冲突 | 保存前 `loadAllPrompts` 重读对比 `promptsVersion`，不一致则提示「文件已被修改，请重新加载」 |
| subscribe 订阅失败 | 降级为轮询 3s，或干脆不订阅（仅本次会话不刷新，下次打开重新加载） |

---

## 测试策略

### 单元测试（vitest/jest）

- `promptsStore`：
  - `loadAllPrompts` 成功路径（mock native bridge 返回文件列表）
  - `loadAllPrompts` 失败降级（mock native bridge 抛错 → 返回硬编码）
  - `savePromptFile` 写入正确
  - `subscribeToPrompts` 触发回调
- `promptsEditorApi`：
  - add/update/delete 调 save 后 bump 版本
  - 重复 label 检测
- `platformsStore` / `historyStore`：类似

### 集成测试（手动）

1. options 编辑器修改一条提示词 → 打开 popup 下拉框 → 看到修改
2. options 编辑器新增一条提示词 → popup/sidebar 下拉框出现新条目
3. options 编辑器删除一条 → popup/sidebar 下拉框消失
4. 关掉 native host → 编辑器红色提示，popup/sidebar 仍可用硬编码兜底

### 回归测试

- 现有 `promptsCore.applyPromptTemplate` 单元测试继续通过（仅迁移位置，逻辑不变）
- 现有 `sendMessage.buildFinalMessage` 测试继续通过
- popup/sidebar 现有功能（发送、平台选择、历史记录）无回归

---

## 文件变更清单

### 新增

```
shared/
├── core/
│   ├── storageKeys.js
│   └── nativeBridge.js
├── prompts/
│   ├── promptsStore.js
│   └── promptsEditorApi.js
├── platforms/
│   └── platformsStore.js
└── history/
    └── historyStore.js

sidebar/main/aichat/promptsPanel.js      # sidebar 独立 UI
```

### 迁移（逻辑不变，位置调整）

```
popup/main/prompts/promptsCore.js → shared/prompts/promptsCore.js
```

### 重写（保留 UI，改为调 shared API）

```
popup/main/prompts/promptsUI.js          # 调用 shared API
options/prompts_editor/prompts_editor.js # 完整编辑器，调用 shared API
```

### 收敛（将 popup 私有模块下沉到 shared）

```
popup/main/modules/storage.js        → 部分函数下沉到 shared/history/historyStore.js
                                        + shared/core/storageKeys.js
popup/main/modules/platformVisibility.js → 下沉到 shared/platforms/platformsStore.js
```

### 调用方更新

```
popup/main/mainUtils.js               # import shared/* 替换原 import
sidebar/main/aichat/aichatUtils.js    # import shared/* 替换原 import
options/storage/storage.js            # import shared/* 替换原 import
options/platform/index.html           # 调用 shared/platformsStore
```

---

## 实施分阶段

| 阶段 | 内容 | 验证 |
|------|------|------|
| Phase 1 | 新增 `shared/core/` + `promptsStore` + 编译期兜底 | `loadAllPrompts` 在 popup 启动时调用，console 输出覆盖生效 |
| Phase 2 | `promptsEditorApi` + options 编辑器接入 | options 编辑器保存 → console 验证 version bump |
| Phase 3 | `subscribeToPrompts` + popup UI 接入 | options 改 → popup 当前会话下拉框刷新 |
| Phase 4 | sidebar 独立 UI + subscribe | sidebar 下拉框也立即反映 |
| Phase 5 | `platformsStore` + `historyStore` 迁移 | 三处 UI 平台选择/历史走 shared |
| Phase 6 | 删除 popup/modules/storage.js 和 platformVisibility.js | 编译通过，运行时无回归 |

---

## 待确认/开放问题

1. **PROMPTS_VERSION 的初始值**：disk 拉失败时是否 bump version？建议 bump 到 `0`，disk 拉成功 bump 到 `Date.now()`。
2. **storage 写入频率**：每次 save 都 bump version 是高频写，但 UI 订阅只是 listen，不写，所以可接受。
3. **跨 group 移动**：当前设计不允许把提示词从 code_gen 移到 analyze_plan。editor 是否需要这功能？建议暂不支持（YAGNI）。
4. **删除 group 文件**：当前只支持删单个提示词，不支持删整个 group 文件。建议暂不支持。