# Nav 紧凑微调样式设计

## 背景

`contentScripts/nav/view.js` 现状：

- `.bro-chat-nav__row` padding `4px 8px 4px 14px`；
- 容器 `gap: 4px`；
- `.bro-chat-nav__line` 高度 `4px`，active 时宽 `20px`；
- 单行垂直节奏约 `4+18+4 = 26px` + 4px gap = 30px。

用户希望：

1. 缩小 item 与 item 之间的上下间隔。
2. 把 nav-line 做得更细一点。

## 目标

1. 单行节奏压到约 20px，使 10 条消息更紧凑。
2. line 明显变细但仍能识别。
3. 保持现有 active 蓝色和宽度变化动画。

## 非目标

- 不修改 line 宽度 12px / active 20px。
- 不改变行间动画（0.2s opacity/transform/max-width）、拖动、core lifecycle、entry、manifest、平台 adapter。

## 设计

### CSS 改动

- `.${ROW_CLASS}`：`padding: 4px 8px 4px 14px` → `padding: 1px 8px 1px 14px`。
- `#${NAV_ID}`：`gap: 4px` → `gap: 2px`。
- `.${LINE_CLASS}`：`height: 4px` → `2px`；`border-radius: 2px` → `1px`。
- `.${LINE_CLASS}.is-active` 保持 `width: 20px`；active 不改高度（继续 2px，更细，但更醒目靠宽度变化）。
- 其他属性（颜色、动画、display、flex-shrink、transition、active 蓝色）全部不变。

### 行间节奏估算

- 单行：1+18+1 = 20px（行 1+line 1+行 1）。
- 行间距：1+1 = 2px。
- 10 行总高度 ≈ 10×20 + 9×2 + 5×2（容器上下 padding 5px）= 238px。

### 组件边界

只修改 `contentScripts/nav/view.js` 和 `tests/nav/view.test.mjs`。

## 测试

view 测试新增 CSS 字符串断言：

- `.bro-chat-nav__row` 含 `padding: 1px 8px 1px 14px`。
- 容器 `gap: 2px`。
- `.bro-chat-nav__line` 含 `height: 2px`、`border-radius: 1px`，且仍 `width: 12px`。
- `.bro-chat-nav__line.is-active` 仍 `width: 20px`。

完整 nav 回归 23/23 必须保持。

## 验收

- 行节奏更紧凑，单行约 20px。
- line 明显变细，active 仍靠宽度变长保持识别。
- 所有 nav 测试通过。
- 本地提交，不 push。
