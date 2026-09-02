---
name: keyboard-shortcut-architecture
description: bro_chat 扩展快捷键系统的完整架构参考。当需要理解、新增、修改或调试快捷键功能时触发，涵盖：内置快捷键（Chrome Commands）、content script 用户自定义快捷键、及时响应机制、超过/拦截原生浏览器快捷键的方法、设置页→内容脚本同步链路、整体分层架构设计。触发词：快捷键、shortcut，内置快捷键、Chrome Commands、拦截浏览器快捷键、超过原生快捷键、preventDefault、keydown、OCR 快捷键、划词快捷键、translation 快捷键、快捷键不生效、快捷键录制、sidebar 切换快捷键。
---

# bro_chat 快捷键系统架构（参考/规范）

本 skill 是 bro_chat 扩展快捷键实现的**只读架构参考 + 新增快捷键规范**。代码已存在于 `popup/translation/`、`runjs/translation/`、`runjs/sidebar/` 与 `sidebar/main/aichat/`，本 skill 不重复粘贴全部源码，只抽取**可复用的架构结论、决策依据、坑点**，供后续新增/调试快捷键时遵循。

---

## 一、整体分层架构（核心结论）

bro_chat 有**两层完全独立**的快捷键体系，职责不重叠，**绝不能混用**：

```
┌─────────────────────────────────────────────────────────────┐
│ 第 1 层：Chrome Commands（系统级、全局、声明式）              │
│   定义位置：manifest.json → commands                          │
│   处理位置：background.js（service worker）                   │
│   特点：全局生效（即使页面无焦点）、用户无法在扩展内改键、     │
│         只支持 Ctrl/Alt+字母数字，与浏览器/其他扩展冲突时      │
│         由 Chrome 弹窗提醒                                    │
│   本项目样例：Alt+C / Alt+D / Alt+F / Alt+B                  │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ 第 2 层：Content Script 快捷键（页面级、用户可改、运行时）     │
│   定义位置：runjs/translation/*.js 或 runjs/sidebar/*.js     │
│   数据源：chrome.storage.local                                │
│   特点：只在注入了 content script 的页面生效、用户可在设置页   │
│         自定义任意「修饰键+主键」组合、可以拦截/超过原生快捷键 │
│   本项目样例：OCR 截图、Sidebar Tab 切换                      │
└─────────────────────────────────────────────────────────────┘
```

**选型决策**：
- 需要全局/系统级触发（无页面焦点也要响应）→ 第 1 层 Chrome Commands
- 需要用户自定义、需要操作当前页面 DOM/选区 → 第 2 层 content script
- bro_chat 的「划词翻译」「OCR」「Sidebar Tab 切换」都属于第 2 层

---

## 二、第 2 层：Content Script 快捷键四大要素

任何 content script 自定义快捷键都由四个部分组成。**新增快捷键时必须照此结构落地，缺一不可**：

### 要素 1：存储模型（单一数据源）
快捷键以对象形式存 `chrome.storage.local`，键名规范 `translation.<功能>.shortcut`：

```js
// 存储值结构（固定四修饰键 + 主键）
{
  ctrlKey:  true,
  altKey:   false,
  shiftKey: true,
  metaKey:  false,
  key:      'X'            // e.key 的值，区分大小写
}
```

> ⚠️ **命名规范**：存储键统一用 `translation.<功能>.shortcut` 带点风格（如 `translation.ocr.shortcut`）。

### 要素 2：匹配逻辑（content script 端）
监听 `document` 级 `keydown`，逐字段精确比对四个修饰键 + 主键：

```js
// 参考实现：sidebar-tab-switch.js isShortcutMatch
function isShortcutMatch(e, config) {
  if (!config) return false;
  return (
    e.ctrlKey === config.ctrlKey &&
    e.altKey === config.altKey &&
    e.shiftKey === config.shiftKey &&
    e.metaKey === config.metaKey &&
    e.key === config.key  // 精确匹配，区分大小写
  );
}

document.addEventListener('keydown', (e) => {
  if (!currentShortcut) return;        // 未设置则不处理
  if (isShortcutMatch(e, currentShortcut)) {
    e.preventDefault();                // ← 超过原生浏览器快捷键的关键 ①
    e.stopPropagation();               // ← 超过原生浏览器快捷键的关键 ②
    doMyAction();
  }
}, true);  // ← 使用捕获阶段确保先于页面脚本处理
});
```

**为什么用 `===` 而不是 `&&`**：必须四个修饰键布尔值都**完全相等**。

> 💡 **大小写**：`e.key` 区分大小写。对于需要兼容大小写的键（如 `` ` `` 和 `~`），使用严格匹配 `===` 而非 `.toLowerCase()`。

### 要素 3：超过原生浏览器快捷键（核心难点）

Chrome 扩展要"拦截/超过浏览器自带的快捷键"，**唯一可靠手段**：

```js
e.preventDefault();     // 阻止浏览器默认行为
e.stopPropagation();    // 阻止事件继续冒泡
```

> ⚠️ **重要**：监听器必须使用**捕获阶段**（`{ capture: true }`），才能先于页面脚本处理。

### 要素 4：及时响应（四触点同步）

快捷键改完要**立刻生效，不用刷新页面**：

```
设置页改键
   │
   ├─① chrome.storage.local.set({...})          ← 持久化
   │
   ├─② chrome.tabs.query({}, tabs => tabs.forEach(  ← 广播
   │      sendMessage(tab.id, {action:'updateShortcut', shortcut})
   │   ))
   │
   └─③ content script 内 chrome.storage.onChanged 监听  ← 兜底
        + 页面加载时 loadShortcut() 从 storage 读初始值
```

---

## 三、Content Script 快捷键分类

### 类型 A：触发后执行页面操作
如 OCR、划词翻译 — 在 content script 中直接执行操作。

### 类型 B：触发后通知 sidebar 执行
如 **Sidebar Tab 切换** — content script 只负责监听快捷键和发送消息，**实际逻辑在 sidebar 端执行**。

```
┌─────────────────┐         ┌─────────────────┐
│  Content Script │  消息   │    Sidebar       │
│  (快捷键监听)   │ ──────→│  (执行切换逻辑)  │
└─────────────────┘         └─────────────────┘
```

**类型 B 的实现要点**：
1. Content script：`chrome.runtime.sendMessage({ action: 'sidebarTabSwitch' })`
2. Sidebar 端：监听 `chrome.runtime.onMessage`，收到消息后执行
3. 状态持久化在 sidebar 端（如 Tab 轮询索引）

---

## 四、设置页录制机制

### 标准模式（必须包含修饰键）

```
startXxxRecording() → 添加 .recording 类
   → document.addEventListener('keydown', recordXxx)
   → document.addEventListener('keyup', finishXxx)

recordXxx(e) → 收集修饰键 + 主键
   → 若无修饰键，提示「请至少按下一个修饰键」

finishXxx(e) → parseShortcutString → saveXxx → 广播
```

### 扩展模式（支持单键 + 开关）

如 Sidebar Tab 切换需要支持：
1. **默认值**：`key: '`'`，无需用户配置即可使用
2. **开关控制**：`translation.xxx.enabled` 布尔值
3. **特殊键支持**：允许单键（无需修饰键），但禁止 `Control/Alt/Shift/Meta/CapsLock/Tab/Escape/Enter/Backspace/Delete`

```js
// 录制函数示例
const forbiddenKeys = ['Control', 'Alt', 'Shift', 'Meta', 'CapsLock', 'Tab', 'Escape', 'Enter', 'Backspace', 'Delete'];
if (forbiddenKeys.includes(e.key)) {
  showError(`不支持 ${e.key} 键`);
  return;
}
```

---

## 五、Sidebar Tab 切换快捷键（新增）

### 文件结构
```
runjs/sidebar/
├── sidebar-selection-content.js  (划词选区)
└── sidebar-tab-switch.js        (Tab 切换快捷键)

sidebar/main/aichat/
├── aichat.html                  (设置弹窗 UI)
├── aichat.css                   (样式)
└── aichatUtils.js               (切换逻辑 + 设置保存)
```

### 存储键
- 快捷键：`translation.sidebarTabSwitch.shortcut`
- 开关：`translation.sidebarTabSwitch.enabled`

### 切换逻辑（轮询）
```
工作区A → 工作区B → ... → 工作区N → AI平台 → 工作区A → ...
```
- 轮询索引 `currentTabIndex` 持久化到 `sidebar_tab_cycle_state`
- 只有用户**主动删除**工作区才更新索引数组

### 状态持久化
```js
const TAB_CYCLE_STATE_KEY = "sidebar_tab_cycle_state";
let currentTabIndex = -1;  // -1 表示平台

async function saveTabCycleState() {
  await chrome.storage.local.set({
    [TAB_CYCLE_STATE_KEY]: { currentIndex: currentTabIndex }
  });
}
```

---

## 六、现有快捷键清单（速查）

| 快捷键         | 层级 | 存储键                              | 设置 UI                          | content 监听器            | 拦截原生 |
| -------------- | ---- | ----------------------------------- | -------------------------------- | ------------------------- | -------- |
| Alt+C/D/F/B    | 第1层 | manifest commands                  | chrome://extensions/shortcuts     | background.js             | 系统级   |
| OCR 截图       | 第2层 | `translation.ocr.shortcut`         | translation.html                 | content-ocr.js           | ✅ 是    |
| **Sidebar Tab** | 第2层 | `translation.sidebarTabSwitch.*`   | sidebar/aichat 设置弹窗          | sidebar-tab-switch.js   | ✅ 是    |

---

## 七、新增快捷键的完整步骤

### 类型 A（触发后执行页面操作）

1. **manifest.json**：新 content script 加入 `content_scripts.js`
2. **content script**：四要素完整实现
3. **设置页**：复制 `startOcrShortcutRecording` 套路

### 类型 B（触发后通知 sidebar）

1. **runjs/sidebar/xxx.js**：监听快捷键 + `sendMessage`
2. **manifest.json**：注册新 content script
3. **sidebar/main/aichat/aichatUtils.js**：
   - 添加 `chrome.runtime.onMessage` 监听
   - 实现执行逻辑
   - 如需状态持久化，添加 storage 读写
4. **sidebar/main/aichat/aichat.html**：添加设置 UI
5. **sidebar/main/aichat/aichat.css**：添加样式

---

## 八、错误案例与坑（高频）

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| 监听器不用捕获阶段 | 页面脚本先执行，无法拦截 | 使用 `addEventListener(..., true)` |
| 用 `&&` 而非 `===` 比对修饰键 | 多按 Alt/Shift 误触发 | 四个修饰键 `===` 全等比较 |
| 存储键命名不统一 | 调试困惑 | `translation.<功能>.shortcut` |
| 不处理默认值 | 未设置时行为不确定 | 明确默认值（如 `key: '`'`） |
| 忽略开关状态 | 快捷键始终激活 | 添加 `translation.xxx.enabled` |
| 状态不持久化 | 刷新后状态丢失 | 使用 `chrome.storage.local` |
| 轮询索引不更新 | 切换逻辑错乱 | 删除 tab 时重新计算索引 |

---

## 九、调试速查

- **快捷键不生效**：① content script 是否注入 ② 快捷键配置非 null ③ `isMatch` 返回 true ④ 使用捕获阶段
- **拦截不住浏览器原生快捷键**：检查是否用了捕获阶段 + `preventDefault`
- **改键后要刷新才生效**：漏了广播或 onChanged 监听
- **Sidebar 不响应**：`chrome.runtime.sendMessage` 是否正确，sidebar 是否在监听

---

## 十、相关 Skill / 代码定位

| 文件 | 用途 |
|------|------|
| `runjs/sidebar/sidebar-tab-switch.js` | Tab 切换快捷键（类型 B 标杆） |
| `sidebar/main/aichat/aichatUtils.js` | Sidebar 端逻辑（消息监听 + 轮询） |
| `popup/translation/translation.js` | 快捷键录制（类型 A 标杆） |
| `runjs/translation/content-ocr.js` | 快捷键拦截标杆 |

- 相关 skill：[[code-standards-guide]]（runjs/ 目录规范）
