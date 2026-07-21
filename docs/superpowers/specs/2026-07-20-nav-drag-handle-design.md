# Nav 拖动手柄设计

## 背景

统一右侧对话快速导航在 `contentScripts/nav/view.js` 中以 `position: fixed; right: 20px; top: 50%; transform: translateY(-50%)` 居中。用户希望可以上下拖动调整垂直位置，但不跨 tab 记忆。

当前 nav DOM 仅包含 row 容器；没有可见手柄，也没有 pointer 事件。所有内容都是 view 内部职责。

## 目标

1. nav 容器在垂直方向可拖动。
2. 拖动有明确手柄，避免与 row click 冲突。
3. 拖动后位置立即跟随鼠标，释放后保留在当前位置。
4. 拖动范围 clamp 到视口内。
5. 不记忆位置；刷新后恢复中心。
6. 保持现有 active、click、scrollIntoView 行为不变。

## 非目标

- 不支持左右拖动或四边自由拖动。
- 不在 chrome.storage 中记忆位置。
- 不改变 active 算法或 click lock。
- 不修改 core lifecycle、entry、manifest 或平台 adapter。
- 不增加长按、双击、双指或触屏专用逻辑（pointer 事件已覆盖鼠标和触屏）。

## 设计

### 布局变化

- 移除 `top: 50%` 与 `transform: translateY(-50%)`。
- 通过 CSS 变量 `--bro-chat-nav-top` 暴露顶部距离，默认 `50%`。
- 当拖动时由 JavaScript 直接改 `nav.style.top = '${y}px'`，并 clamp 到 `[8px, viewportHeight - navHeight - 8px]`。
- `transition` 仍保留 width/background/border，但拖动期间通过临时 `transition: none` 关闭 `top` 过渡。

### 拖动手柄

- 在 nav 容器内顶部增加一个 6px 高的 `<div class="bro-chat-nav__handle">` 元素。
- 手柄 cursor: `ns-resize`，hover 时背景 `rgba(15,17,21,0.08)`。
- 拖动时手柄背景 `rgba(0,60,179,0.18)`，cursor `grabbing`。
- 拖动手柄不影响 row click：手柄是独立元素，事件不冒泡到 row。

### 交互流程

1. `pointerdown` on handle：
   - `setPointerCapture(e.pointerId)` 锁定指针。
   - 记录起始 `clientY` 与 `nav` 当前 `top`。
   - 设置 `nav.style.transition = 'none'`，cursor 改为 `grabbing`。
2. `pointermove`：
   - 累加 `deltaY`。
   - clamp 到 `[8, innerHeight - navHeight - 8]`。
   - 写 `nav.style.top = y + 'px'`。
   - `preventDefault()` 避免文本选择。
3. `pointerup` / `pointercancel`：
   - `releasePointerCapture`。
   - 恢复 `nav.style.transition` 默认（`top` 不在 transition 列表内即可）。
   - 恢复 cursor。

### 组件边界

修改：

- `contentScripts/nav/view.js`：增加 handle 元素、setupDragHandler、`top` 变量管理。
- `tests/nav/view.test.mjs`：增加 handle 存在性、pointer 拖动、clamp、row click 不受影响等断言。

不变：

- `core.js`：继续调用 `createNavView` 公开 API（render / setActive / clear）。
- `entry.js`、平台 adapter、manifest、background 不变。
- `chrome.storage` 不写入。

## 测试

view 测试新增：

- `nav.children[0]` 存在 `bro-chat-nav__handle` 元素。
- `pointerdown` on handle + `pointermove` 触发 `nav.style.top` 更新。
- 拖动到 `clientY < 8` 时 `top` 仍 >= 8。
- 拖动到 `clientY > innerHeight - navHeight - 8` 时 `top` 不超过该值。
- `pointerup` 后再次 `pointerdown` 可继续拖动。
- row click 仍正常（不因 handle 存在而受影响）。

完整 nav 回归 20/20 必须保持。

## 验收

- 拖手柄 cursor 变化，hover 显示手柄背景。
- 拖动期间 nav 实时跟随，释放后保持。
- 拖动到边界被 clamp，不超出视口。
- 拖动不影响 active 跟随、click lock、scrollIntoView。
- 不写入 chrome.storage，不读取 nav 历史。
- 完整 nav 自动化测试通过。
- 本地提交，不 push。
