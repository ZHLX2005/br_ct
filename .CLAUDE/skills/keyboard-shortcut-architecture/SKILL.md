---
name: keyboard-shortcut-architecture
description: bro_chat 扩展快捷键系统的完整架构参考。当需要理解、新增、修改或调试快捷键功能时触发，涵盖：内置快捷键（Chrome Commands）、content script 用户自定义快捷键、及时响应机制、超过/拦截原生浏览器快捷键的方法、设置页→内容脚本同步链路、整体分层架构设计。触发词：快捷键、shortcut、内置快捷键、Chrome Commands、拦截浏览器快捷键、超过原生快捷键、preventDefault、keydown、OCR 快捷键、收藏快捷键、划词快捷键、translation 快捷键、快捷键不生效、快捷键录制。
---

# bro_chat 快捷键系统架构（参考/规范）

本 skill 是 bro_chat 扩展快捷键实现的**只读架构参考 + 新增快捷键规范**。代码已存在于 `popup/translation/` 与 `runjs/translation/`，本 skill 不重复粘贴全部源码，只抽取**可复用的架构结论、决策依据、坑点**，供后续新增/调试快捷键时遵循。

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
│   定义位置：runjs/translation/*.js（content script）          │
│   数据源：chrome.storage.local                                │
│   特点：只在注入了 content script 的页面生效、用户可在设置页   │
│         自定义任意「修饰键+主键」组合、可以拦截/超过原生快捷键 │
│   本项目样例：OCR 截图快捷键、收藏快捷键                      │
└─────────────────────────────────────────────────────────────┘
```

**选型决策**：
- 需要全局/系统级触发（无页面焦点也要响应）→ 第 1 层 Chrome Commands
- 需要用户自定义、需要操作当前页面 DOM/选区 → 第 2 层 content script
- bro_chat 的「划词翻译」「OCR」「收藏」都属于第 2 层，因为它们**必须读取页面选区/调用页面 API**。

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

> ⚠️ **坑：现有代码存储键命名不统一**。OCR 用 `translation.ocr.shortcut`（带点），收藏用 `translation.favoritesShortcut`（驼峰无点）。新增功能请统一用 `translation.<功能>.shortcut` 带点风格。

### 要素 2：匹配逻辑（content script 端）
监听 `document` 级 `keydown`，逐字段精确比对四个修饰键 + 主键：

```js
// 参考实现：content-ocr.js isShortcutMatch / content.js checkFavoritesShortcut
function isShortcutMatch(e, shortcut) {
  if (!shortcut) return false;
  return (
    e.ctrlKey  === shortcut.ctrlKey  &&
    e.altKey   === shortcut.altKey   &&
    e.shiftKey === shortcut.shiftKey &&
    e.metaKey  === shortcut.metaKey  &&
    e.key      === shortcut.key
  );
}

document.addEventListener('keydown', (e) => {
  if (!currentShortcut) return;        // 未设置则不处理
  if (isShortcutMatch(e, currentShortcut)) {
    e.preventDefault();                // ← 超过原生浏览器快捷键的关键 ①
    e.stopPropagation();               // ← 超过原生浏览器快捷键的关键 ②
    // 触发你的功能...
  }
});
```

**为什么用 `===` 而不是 `&&`**：必须四个修饰键布尔值都**完全相等**。用户设了 `Ctrl+Shift+X`，那按下 `Ctrl+Shift+Alt+X`（多按了 Alt）就**不该**匹配——否则会误触发。

> 💡 **大小写**：`e.key` 区分大小写（Shift+X 的 e.key 是 'X'，x 是 'x'）。收藏快捷键里用了 `.toLowerCase()` 归一化（更宽松），OCR 用严格匹配。**推荐统一用 `toLowerCase()`** 以避免 Shift 影响。

### 要素 3：超过原生浏览器快捷键（核心难点）

这是整个 skill 最重要的部分。Chrome 扩展要"拦截/超过浏览器自带的快捷键"（如 Ctrl+S、Ctrl+Shift+T），**唯一可靠手段**就是 content script 里两连击：

```js
e.preventDefault();     // 阻止浏览器默认行为（如 Ctrl+S 不再弹保存）
e.stopPropagation();    // 阻止事件继续冒泡，页面其他监听器收不到
```

**为什么有效**：
- content script 在 `document` 级注册监听器，能拿到页面上几乎所有的键盘事件。
- `preventDefault()` 是取消浏览器默认动作的**唯一**标准 API。
- `stopPropagation()` 防止页面自带脚本也响应（避免双重触发）。

**为什么 `run_at: "document_idle"` 仍能拦到**：虽然脚本在 `document_idle` 才注入，但只要在用户**按键之前**完成 `addEventListener`，之后的所有按键都能被捕获。浏览器默认动作发生在事件流结束后，`preventDefault` 始终能拦住它。

> ⚠️ **坑：收藏快捷键的 keydown 处理器没有调 `preventDefault/stopPropagation`**（content.js line 1298）。这是有意为之——因为收藏快捷键常配成单 `Ctrl`，不能阻止 Ctrl 的浏览器行为。但这意味着：**如果你的新快捷键配成与浏览器冲突的组合（如 Ctrl+S），不调 preventDefault 就拦不住**。需要"真正拦截"的功能（如 OCR）必须加这两行。

### 要素 4：及时响应（三重同步保障）

快捷键改完要**立刻生效，不用刷新页面**，靠三重机制：

```
设置页改键 (popup/translation/translation.js)
   │
   ├─① chrome.storage.local.set({...shortcut})          ← 持久化（刷新后仍有效）
   │
   ├─② chrome.tabs.query({}, tabs => tabs.forEach(       ← 广播给所有已打开标签页
   │      sendMessage(tab.id, {action:'xxx.updateShortcut', shortcut})
   │   ))
   │
   └─③ content script 内 chrome.storage.onChanged 监听  ← 兜底：漏接消息也能同步
        + 页面加载时 loadShortcut() 从 storage 读初始值  ← 新开标签页立即生效
```

**新增快捷键时必须同时实现这四个触点**：
1. content script 加载时调 `loadXxxShortcut()` 从 storage 读初值
2. content script 监听 `chrome.runtime.onMessage` 的 `updateShortcut` action
3. content script 监听 `chrome.storage.onChanged`（兜底）
4. 设置页保存时调 `chrome.tabs.query` 广播 + `storage.set`

---

## 三、现有快捷键清单（速查）

| 快捷键         | 层级 | 存储键                       | 设置 UI                         | content 监听器            | 拦截原生 |
| -------------- | ---- | ---------------------------- | ------------------------------- | ------------------------- | -------- |
| Alt+C/D/F/B    | 第1层 | manifest commands            | chrome://extensions/shortcuts   | background.js             | 系统级   |
| OCR 截图       | 第2层 | `translation.ocr.shortcut`   | translation.html ocrShortcutInput | content-ocr.js keydown    | ✅ 是    |
| 收藏划词       | 第2层 | `translation.favoritesShortcut` | translation.html favoritesShortcutInput | content.js keydown+selectionchange | ❌ 否 |
| ESC（关面板）  | 第2层 | 无（硬编码）                 | 无                              | content.js/ocr/selection-ask 各自 keydown | 仅 stopPropagation |

**OCR 快捷键**（content-ocr.js）是「真正拦截原生快捷键」的标杆实现：匹配后 `preventDefault`+`stopPropagation`，再 `startSelection()` 进入框选模式。

**收藏快捷键**（content.js）是「修饰键按下 + 鼠标划词」的特殊模式：
- `keydown` 记录修饰键按下状态（`favoritesShortcutPressed = true`）
- `selectionchange` 监听选区变化，在「修饰键还按着 + 选中了文字」时触发收藏
- `keyup` 释放状态
- 这是为了支持「按住 Ctrl 划一段文字就收藏」，而非「按一个组合键就收藏」

---

## 四、设置页录制机制（translation.js）

用户在设置页点击输入框进入「录制态」，按下组合键即录制：

```
startXxxShortcutRecording()      点击输入框
   → 添加 .recording 类（CSS 脉冲动画提示）
   → document.addEventListener('keydown', recordXxxShortcut)
   → document.addEventListener('keyup', finishXxxShortcutRecording)

recordXxxShortcut(e)             按键时
   → e.preventDefault + stopPropagation（录制期间也拦截，防止触发浏览器功能）
   → 收集修饰键 [Ctrl/Alt/Shift/Meta] + e.key
   → 若无修饰键，提示「请至少按下一个修饰键」（强制必须有修饰键，避免单字母误触）

finishXxxShortcutRecording(e)    抬键时
   → parseShortcutString → 存对象
   → saveXxxShortcut → storage.set + 广播所有标签页
   → formatShortcutDisplay（Control→Ctrl, Meta→Cmd）
```

**关键约束：录制强制要求至少一个修饰键**。单字母键（如只按 `X`）不被接受——因为单键会污染正常打字。新增录制器务必保留此约束。

---

## 五、新增一个 content script 快捷键的完整步骤

1. **manifest.json**：把新 content script 加入 `content_scripts.js` 数组（与 content.js 同 matches `<all_urls>`，`run_at: document_idle`）。
2. **content script 端**：
   ```js
   let myShortcut = null;
   function loadMyShortcut() {
     chrome.storage.local.get(['translation.myshortcut'], r => {
       myShortcut = r['translation.myshortcut'] || null;
     });
   }
   function isMatch(e, s) {
     if (!s) return false;
     return e.ctrlKey===s.ctrlKey && e.altKey===s.altKey &&
            e.shiftKey===s.shiftKey && e.metaKey===s.metaKey &&
            e.key.toLowerCase() === s.key.toLowerCase();
   }
   document.addEventListener('keydown', e => {
     if (!myShortcut) return;
     if (isMatch(e, myShortcut)) {
       e.preventDefault(); e.stopPropagation();   // 拦截原生
       doMyAction();
     }
   });
   chrome.runtime.onMessage.addListener((req) => {
     if (req.action === 'translation.myshortcut.update') myShortcut = req.shortcut;
     if (req.action === 'translation.myshortcut.clear') myShortcut = null;
   });
   chrome.storage.onChanged.addListener((c, area) => {
     if (area === 'local' && c['translation.myshortcut']) myShortcut = c['translation.myshortcut'].newValue;
   });
   loadMyShortcut();
   ```
3. **设置页**：复制 translation.js 里 `startFavoritesShortcutRecording` 整套（start/record/finish/save/load/clear + parse/format 工具函数），改 action 名和存储键。
4. **设置页 HTML**：复制 `favoritesShortcutInput` 那块（input + clear btn + hint）。
5. **验证四触点**：改键→立即生效（广播）、刷新→仍生效（storage）、新开页→生效（load）、漏接消息→生效（onChanged）。

---

## 六、错误案例与坑（高频）

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| content script 监听器漏调 `e.preventDefault()` | 配置与浏览器冲突的组合（Ctrl+S 等）时拦不住，浏览器默认动作仍执行 | 需要真正拦截的功能必须 `preventDefault`+`stopPropagation` 双连 |
| 用 `e.ctrlKey && e.key==='x'`（部分匹配） | 用户多按 Alt/Shift 也误触发 | 四个修饰键 `===` 全等比较 |
| 存储键大小写/风格混用 | 新功能读不到老数据，调试困惑 | 统一 `translation.<功能>.shortcut` |
| 录制器接受单字母键（无修饰键） | 用户正常打字时误触发功能 | 录制强制 `modifiers.length > 0` |
| 只做 `storage.set` 不广播/不监听 onChanged | 改键后必须刷新页面才生效 | 四触点全做 |
| 把页面级快捷键写进 manifest commands | 以为是「全局快捷键」但拿不到页面选区/DOM | 操作页面内容的快捷键必须用第 2 层 content script |
| content script 不在 `matches:<all_urls>` | 在某些页面快捷键不生效 | translation 类快捷键必须 all_urls 注入 |
| 多个 content script 各注册 keydown 监听 ESC | 看似重复，实为各自关各自面板，可接受；但若逻辑重叠会双重触发 | 保持各监听器职责单一，只管自己的面板 |

### 默认值陷阱
`content.js checkFavoritesShortcut` 在 `favoritesShortcut` 为 `null` 时，**默认把"单独按 Ctrl"识别为触发**（line 1274）。这是个容易让用户困惑的怪异默认——为什么我什么都没设置，按 Ctrl 就收藏了。新增快捷键**不要照搬**这种"未设置时有隐式默认"的设计，未设置应明确 `return false` 不响应。

---

## 七、调试速查

- **快捷键不生效**：① 确认 content script 在该页面注入（F12 看 Sources）② 确认 `currentShortcut/myShortcut` 非 null（console 打印）③ 确认 `isMatch` 返回 true ④ 确认 preventDefault 未被后续监听器覆盖。
- **拦截不住浏览器原生快捷键**：检查匹配分支里是否调了 `preventDefault()`（收藏快捷键就没调，故拦不住）。
- **改键后要刷新才生效**：漏了广播（tabs.sendMessage）或 onChanged 监听。
- **打字时误触发**：录制器没强制修饰键，或匹配用了部分比对。

---

## 八、相关 skill / 代码定位

- 设置页源码：`popup/translation/translation.js`（录制/存储）、`translation.html`（UI）、`translation.css`（.recording 脉冲动画）
- OCR 快捷键（拦截标杆）：`runjs/translation/content-ocr.js`（`isShortcutMatch` ~L1623、keydown ~L1636、`loadShortcut` ~L1603）
- 收藏快捷键（修饰键+划词模式）：`runjs/translation/content.js`（`checkFavoritesShortcut` ~L1273、keydown ~L1298、selectionchange ~L1320）
- 注入配置：`manifest.json` `content_scripts`（~L67）、`commands`（~L49）
- 相关 skill：[[add-platform]]、[[page-requirements]]；funcs/ 脚本接入规范见 [[code-standards-guide/add-func-script]]；content_scripts 与 settings 响应式同步见全局 skill [[content-script-reactive-config]]（本项目 `.claude/skills/` 未单独收录，使用时通过全局路径加载）

---

## 九、参考文档（按需加载）

| ref | 何时读取 | 路径 |
|-----|---------|------|
| [[sidebar-shortcut]] | 新增/调试边栏切换快捷键；排查 Chrome Side Panel API 行为差异（伪关闭 vs 真关闭、tabId 生命周期、状态持久化） | references/sidebar-shortcut.md |
