# 调试 Session 2024-08-11：popup/sidebar 交互回归修复

**问题描述**

用户报告三个交互失效问题：
1. **popup**: 点击编辑 → 点击输入框 → 下拉列表关闭
2. **sidebar**: 点击编辑图标 → 无响应
3. **popup**: 每次重进都丢失平台选择

**前置背景**

- 5 组 shared 数据层重构（`bfb185f..9e83ab4`）完成后，popup/sidebar 通过 `chrome.storage.local` + `chrome.storage.onChanged` 同步数据
- 用户期望："popup 选了 prompt A，sidebar 应同步；sidebar 改了 prompt，popup 下拉应即时刷新"
- 系统架构：每个 popup/sidebar/options 页面是独立 JS context，语义单例靠 `chrome.storage.onChanged` + `subs.emit()` 达成

---

## Bug A: popup 编辑态下点击输入框关闭下拉

**根因**：外点关闭监听器（`onOutsideClick`）在用户点击 inline edit 内的输入框时，仍然判定为"点击外部"，因为输入框在 `promptOptimizerSelect` 内但点击事件冒泡到 document 时被监听器捕获。虽然 `swallow` 处理阻止了冒泡，但外点监听器在 document 级别，直接检查 `e.target` 是否在 `promptOptimizerSelect` 内，此时检查通过，关闭下拉。

**修复**（commit `e88fab2`）：
```js
// 在 onOutsideClick 中增加防御性检查
const onOutsideClick = (e) => {
  if (e.target?.closest && e.target.closest('#prompt-optimizer-select .select-option.inline-editing')) {
    return; // 存在 active inline-editing 行时，保留下拉打开
  }
  if (!promptOptimizerSelect.contains(e.target)) {
    promptOptimizerSelect.classList.remove('active');
  }
};
```

**用户体验**：用户可以在 inline edit 的输入框和消息输入框之间自由切换焦点，下拉不会意外关闭。

---

## Bug B: sidebar 编辑图标无响应

**根因**：`buildPromptPicker` 函数在构建分组数据时，推入的对象缺少 `group` 字段：

```js
// 错误代码（aichatUtils.js:690）
groups[g].push({ key: itemKey, label: t.label, template: t.template, alias: t.alias });
// 缺少 group: t.group → tpl.group = undefined
```

后续 `openInlineEditOnPicker(tpl.group, tpl.label)` 运行：
```js
const items = cache[group] || []; // cache[undefined] = undefined
const tpl = items.find((p) => p.label === label); // 找不到
if (!tpl) return; // 静默失败，无 console 日志
```

**修复**（commit `e88fab2`）：
1. `buildPromptPicker` 推入时加上 `group: g`
2. `openInlineEditOnPicker` 防御性跨分组扫描（若 primary lookup 失败）
3. 加 `console.warn('[aichat] openInlineEditOnPicker: 找不到提示词')` 失效时不再静默

**关键洞察**：静默失败是最难调试的 bug 之一。所有"查找后 return"的路径都应该有日志。

---

## Bug C: popup 重进丢失平台数据

**根因**：`elements.platformCheckboxes` 在 `initializePopup` 里用 `querySelectorAll` 一次性快照。如果视图挂载时序异常（DOM 还没渲染完、视图被 reset 后重渲染），快照就空了——`restorePlatformStates` 跑空、`savePlatformStates` 写入空 dict。

**时序问题示例**：
```js
// main.js 初始化顺序
initializePlatformOptions(rootEl);  // 渲染 checkbox DOM
await initializePopup(rootEl);     // 快照 NodeList（此时应已有 DOM）
// BUT: 若中间有异步延迟，DOM 可能未就绪，快照空
setupEventListeners();              // 绑定 change 监听
await loadStoredData();             // 从快照恢复状态（失败）
```

**修复**（commit `6bbcf58`）：
```js
// 把 platformCheckboxes 改成 getter（live query）
export const elements = {
  get platformCheckboxes() {
    return (_viewRoot || document).querySelectorAll(
      '.platform-icon-option input[type="checkbox"]'
    );
  },
  // ... 其他字段也是 getter
};
```

**加防御性日志**：
```js
console.log('[boot] restorePlatformStates: applied', applied, '/', cbs.length, 'keys =', Object.keys(platformStates).join(','));
```

---

## Bug D: elements 引用错误（ReferenceError）

**根因**：commit `6baa4d8` 把 `installOptimizer(elements.promptOptimizerSelect)` 写进 `main.js:47`，但只 export 了 `viewCleanups`，忘了 export `elements`。`elements` 是 `mainUtils.js` 内的 `let`，外部无法访问。

**症状**：
```
main.js:56 初始化 main 视图失败: ReferenceError: elements is not defined
    at init (main.js:47:47)
mainUtils.js:247 [boot] initializePopup: done
main.js:57 [boot] main.init: stack = ReferenceError
```

`init` 在 `try/catch` 中，错误被吞，`loadStoredData` 被跳过，导致：
- 平台选择不恢复
- 提示词不恢复
- 输入框内容不恢复

**修复**（commit `fb4da25`）：
- `mainUtils.js`: `elements` 改成 `export const`（getter 对象）
- `mainUtils.js`: `viewRoot` → `_viewRoot`（私有化）
- `main.js`: `import { elements } from './mainUtils.js'`

**对称性原则**：暴露新 `export` 时，必须 grep 现有 caller验证 `import` 对称。

---

## 调试方法论

本次调试采用 **systematic debugging**（Phase 1-4 流程）：

### Phase 1: 根因调查
1. **读错误信息**：用户提供了完整的 console 堆栈
2. **重现**：用户报告的行为可重现
3. **检查最近变更**：git log 显示 5 组 shared 数据层重构
4. **trace data flow**：从 UI 操作 → 事件监听 → 存储 → 恢复，逐层检查

### Phase 2: 模式分析
- 找到 sidebar 已有的 `getPlatformCheckboxes()` getter 模式（commit `244daf6`）
- 对比 popup 发现缺少同样的 getter，引入相同修复

### Phase 3: 假设与测试
- **Bug A 假设**：`swallow` 应阻止冒泡 → 验证：实际阻止了，但外点监听器在 document 级别，绕过了冒泡
- **Bug B 假设**：`getCurrentPrompts()` 缺少 `group` → 验证：数据源有 `group`，但 `buildPromptPicker` 没传递
- **Bug C 假设**：DOM 时序问题 → 验证：改为 getter 后加日志

### Phase 4: 修复实现
- 每个修复都加 `[boot]` 日志或 `console.warn`，确保失效时不再静默
- 修复后用 git commit 追踪

---

## 关键模式总结

### 1. NodeList snapshot vs live query

**问题模式**：`querySelectorAll` 返回静态 NodeList。DOM 重渲染后，快照陈旧或空。

**解决方案**：
```js
// BAD: 静态快照
let elements = {
  platformCheckboxes: rootEl.querySelectorAll('...'),
};

// GOOD: live query getter
export const elements = {
  get platformCheckboxes() {
    return (viewRoot || document).querySelectorAll('...');
  },
};
```

**何时使用**：任何 DOM 在视图生命周期内可能被替换或延迟渲染的场景。

**相关文件**：
- `sidebar/aichatUtils.js:60-64`（已有 getter）
- `popup/mainUtils.js:207-213`（本次修复）

### 2. Export/import 对称性检查

**问题模式**：新增 export 后，caller 直接引用但忘记 import。ES module 在浏览器加载时才跑，没有编译期检查。

**检查清单**：
1. grep `export const <symbolName>` 找到暴露点
2. grep `<symbolName>` 跨所有 popup/sidebar/options/ 找到引用
3. 每个 reference 文件顶部检查 `import { <symbolName> }`
4. 新增 export 时，commit message 应枚举 export 增量与 caller 增量

**相关 commit**：
- `6baa4d8` 引入的不对称（export `viewCleanups` 但未 export `elements`）
- `fb4da25` 修复（export `elements` + import）

### 3. 静默失败加日志

**问题模式**：`if (!tpl) return` 在查找失败时静默返回，UI 无任何反馈。

**解决方案**：
```js
if (!tpl) {
  console.warn('[feature] 找不到 XXX:', { group, label });
  return;
}
```

**本次应用**：
- `openInlineEditOnPicker` 加 `[aichat]` 前缀日志
- `restorePlatformStates` 加 `[boot]` 日志输出命中数

---

## 跨页面数据同步机制

### 架构
```
popup context            sidebar context            options context
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ promptsStore.js   │   │ promptsStore.js   │   │ promptsStore.js   │
│   cache (A)       │   │   cache (A)       │   │   cache (A)       │
│   subs (A)        │   │   subs (A)        │   │   subs (A)        │
└─────────────────┘   └─────────────────┘   └─────────────────┘
         │                        │                        │
         └────────────────────┴────────────────────────┘
                  chrome.storage.local[PROMPTS_VERSION]
```

### 同步流程
1. **进程内**：`savePromptFile` → `cache = {...}; subs.emit(cache)` → 同 context 订阅者立即看到
2. **跨 context**：`writeVersion(current + 1)` → `chrome.storage.onChanged` 触发 → 异 context 订阅者读取新 cache

**关键 commit**：`a022946 feat(prompts): subscribeToPrompts symmetric with platformsStore`

---

## 修复记录

| Commit | 描述 | 相关文件 |
|--------|------|----------|
| `e88fab2` | fix(popup,sidebar): inline-edit click + sidebar edit icon regressions | `promptsUI.js`, `aichatUtils.js` |
| `6bbcf58` | fix(popup): elements.platformCheckboxes 改 getter live query + restore 日志 | `mainUtils.js` |
| `fb4da25` | fix(popup): export elements and import in main.js; remove ReferenceError | `mainUtils.js`, `main.js` |
| `244daf6` | fix(sidebar): live getPlatformCheckboxes + viewCleanups + lazy visibility | `aichatUtils.js`（早期） |

---

## 经验教训

1. **所有"查找失败后 return"都要加日志** —— 静默失败是调试的黑盒
2. **DOM 快照风险**：query selectorAll 在视图挂载时序不确定时，用 getter
3. **Export/import 必须对称**：grep 验证，避免 ReferenceError
4. **跨页面数据同步靠 chrome.storage**：每个 context 是独立 module，不要假设全局单例
5. **[boot] 日志是调试利器**：用户贴 console 才能看到 init 过程中的时序问题

---

## 后续验证步骤

1. **Reload 扩展**，确认：
   - `[boot] initializePopup: done`
   - `[boot] restorePlatformStates: applied X / Y`（X == Y，不为 0）
2. **popup 交互测试**：
   - 点击编辑 → 点击 inline edit 输入框 → 下拉应保持打开
   - 关闭 popup → 重开 → 平台选择应恢复
   - 选中提示词 → 关闭 → 重开 → 选中应恢复
3. **sidebar 交互测试**：
   - 点击 prompt bar → 点击编辑图标 → 应打开 promptEditor 页面
   - 编辑保存 → popup 下拉应立即刷新

---

## 相关文档

- `memory/platform-checkboxes-snapshot-pattern.md` — NodeList snapshot vs live query 模式
- `memory/missing-import-after-export-symmetry.md` — export/import 对称性检查
- `memory/cross-context-module-instance-not-singleton.md` — 跨页面数据同步架构
