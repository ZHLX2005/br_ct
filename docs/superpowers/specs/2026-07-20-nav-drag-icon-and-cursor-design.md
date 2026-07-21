# Nav 拖动手柄三横线 icon + 整列可拖设计

## 背景

`contentScripts/nav/view.js` 已实现顶部拖动手柄：

- 一个 16×6px 的 `bro-chat-nav__handle` 元素，hover 显示浅灰背景，drag 时变蓝；
- Pointer Events 监听 `pointerdown/move/up/cancel`；
- 抓取偏移公式 + 8px clamp；
- `transform: translateY(-50%)` 在拖动时临时关闭以保证视觉对齐。

用户希望：

1. 手柄位置呈现清晰的三横线 icon。
2. 整列可拖：nav 任意位置（除 row 外）按下都能拖动。
3. cursor 在 nav 任意位置显示 pointer。
4. row 上的点击行为仍触发（不被拖动压制）。

## 目标

1. 手柄中央显示 3 根短线 icon。
2. 整列可拖：手柄和 nav 空白均可拖；row 区域 click 行为保持。
3. cursor: pointer 覆盖整个 nav 容器；拖动时切换为 grabbing。
4. 保持现有 22/22 nav 自动化测试。

## 非目标

- 不改变 row click 的逻辑、active 算法、click lock、scrollIntoView。
- 不修改 core.js、entry.js、manifest、平台 adapter。
- 不引入新的浏览器 API；继续使用 Pointer Events。
- 不记忆拖动位置（仍为刷新后居中）。

## 设计

### 三横线 icon

- 在 `bro-chat-nav__handle` 内部插入 3 个 `<span class="bro-chat-nav__handle-bar">`。
- 父 handle 使用 flex 居中：
  - `display: flex; flex-direction: column; gap: 2px; align-items: center; justify-content: center`。
- 每根 bar：
  - `width: 10px; height: 1.5px; border-radius: 1px;`
  - 默认背景 `rgba(15,17,21,0.45)`（与 idle line 同色系，深度低于 active 蓝）。
  - hover/drag 状态切到 `rgba(0, 60, 179, 0.7)`。
- 原 handle 的 6px 高度仍足够容纳 3 根 1.5px + 4px gap（1.5×3 + 2×2 = 8.5px，约为视觉上 1.5px bar 紧凑布局；保留 6px 容器意味着需要把 bar 高度收为 1.5px、gap 1px，3×1.5+2×1=6.5 ≈ 6px；最终 bar 1.5px 高、gap 1px）。
- 不再需要 `background: transparent` 与 `transition: background` 作为纯背景容器；改用 border-radius 容纳三根 bar。
- handle 容器原 margin 4px 保持；row 与 handle 之间间距不变。

### 整列可拖

- 把现有 4 个 Pointer 监听器从 `handle` 改为 `nav`：
  - `nav.addEventListener('pointerdown', ...)` 等。
  - `nav.setPointerCapture(event.pointerId)`。
- 在 `pointerdown` 中判断事件目标：
  - `const targetRow = event.target.closest('.${ROW_CLASS}');`
  - 如果 `targetRow`，直接 `return`（不进入 drag 模式，row click 行为不变）。
  - 否则，进入现有 drag 流程。
- `dragState` 仍然由闭包持有；row 上的 pointerdown 不会写入 `dragState`，因此后续 pointermove 也不会触发 nav.style.top 变更。
- 拖动期间：`.is-dragging` 加在 `nav` 上（CSS 同时给 nav.is-dragging 提供背景变化，避免失去与手柄的视觉关联）。

### cursor 策略

- 基础 nav：`cursor: pointer;`。
- 拖动时 nav.is-dragging：`cursor: grabbing;`。
- row 区域不覆盖 cursor（保持默认 `auto`，与行点击自然一致）；row 的可点击行为来自 row.click 监听，不依赖 cursor。
- 取消 `bro-chat-nav__handle` 的 `cursor: ns-resize`（整列都 pointer 后，手柄不再需要专用 cursor）。

### 组件边界

修改：

- `contentScripts/nav/view.js`：增加 3 根 bar、迁移 Pointer 监听、调整 cursor CSS。
- `tests/nav/view.test.mjs`：新增手柄 bar 数量、整列拖动 + row 跳过、cursor 等断言。

不变：

- `core.js`、entry、manifest、平台 adapter。
- 22/22 nav 测试基线。

## 测试

view 测试新增：

- `bro-chat-nav__handle` 含 3 个 `bro-chat-nav__handle-bar` 子元素。
- pointerdown on row（closest 命中）不进入 drag：`nav.style.top` 不变、`dragState` 仍 null（用 handle.pointerEvent('pointerdown') 模拟后再发 pointermove，nav.style.top 应保持不变）。
- pointerdown on handle 进入 drag：`nav.is-dragging` 类被添加，`nav.style.transform === 'none'`、`nav.style.transition` 包含 `none`。
- 拖动 row 跳过验证：发一个 pointerdown 事件 `event.target = rowFakeElement`，handler 仍 return，不进入 drag。
- cursor 相关：CSS 包含 `cursor: pointer`（基础 nav）和 `cursor: grabbing`（`.is-dragging`）。

完整 nav 回归 22/22 必须保持。

## 验收

- 手柄可见三横线 icon，hover 颜色变深，drag 颜色变蓝。
- cursor 在 nav 任意位置都是 pointer；拖动时 grabbing。
- row 上的 click 行为不变（不被拖动取代）。
- handle 与 nav 空白处按下并拖动可移动 nav；释放保留位置。
- 完整 nav 自动化测试通过。
- 本地提交，不 push。
