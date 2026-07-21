# Nav 紧凑高度样式设计

## 背景

统一导航视图目前在 `contentScripts/nav/view.js` 中定义：

- item 的 `opacity`、`transform` 和 `max-width` 统一使用 `0.8s` transition，hover 后文字出现偏慢；
- nav 容器 `gap: 10px`，row 上下 padding 为 `6px`，容器上下 padding 为 `16px`，多条消息时视觉偏稀疏；
- 容器没有最大高度，消息很多时可能超出视口，也没有明确的可视高度边界。

本次仅调整共享 view 样式，所有平台自动复用，不修改 core lifecycle、entry、manifest 或平台 adapter。

## 目标

1. hover 后文字快速出现，减少等待感；
2. 缩小导航行和容器间距，提高单位高度内的可见条目数量；
3. 将 nav 最大高度限制为视口高度的 70%，消息过多时由 nav 内部滚动；
4. 保持现有布局方向、active 状态、点击区域和统一组件边界。

## 非目标

- 不改变 active 算法或 click lock；
- 不改变文字字号、line 尺寸和容器宽度；
- 不新增可见的 scrollbar 皮肤；
- 不修改平台 selector；
- 不改变 manifest-resident Path A 注入架构。

## 样式调整

### 动画速度

item 当前：

```css
transition: opacity 0.8s ease, transform 0.8s ease, max-width 0.8s ease;
```

调整为：

```css
transition: opacity 0.2s ease,
            transform 0.2s ease,
            max-width 0.28s ease;
```

理由：透明度和位移应快速反馈 hover；宽度展开稍慢一点，避免文本突然挤压 line。

### 紧凑密度

| 属性 | 当前 | 调整后 |
|---|---:|---:|
| nav `gap` | `10px` | `4px` |
| nav 上下 padding | `16px` | `10px` |
| row 上下 padding | `6px` | `4px` |
| row 左右 padding | `8px / 14px` | 保持不变 |
| item font / line-height | `13px / 18px` | 保持不变 |
| line idle / active | `12px / 20px` | 保持不变 |

单行垂直节奏约从 `18 + 12 + 10 = 40px` 降到 `18 + 8 + 4 = 30px`，约紧凑 25%。

### 最大高度和内部滚动

在 nav 容器增加：

```css
max-height: 70vh;
overflow-x: hidden;
overflow-y: auto;
scrollbar-width: none;
```

并隐藏 WebKit scrollbar：

```css
#bro-chat-right-edges-nav::-webkit-scrollbar {
  display: none;
}
```

容器仍通过 `top: 50%` 和 `translateY(-50%)` 垂直居中。消息较少时高度由内容决定；消息较多时最多占视口 70%，内部滚动。

原来的 `overflow: hidden` 需要拆成 `overflow-x` 和 `overflow-y`，否则内部滚动不会生效。

## 组件边界

只修改：

- `contentScripts/nav/view.js`
- `tests/nav/view.test.mjs`

`view.js` 仍然是唯一 CSS/DOM 来源。平台 adapter 不新增样式字段。

## 测试

扩展 view 测试，断言 CSS 包含：

- `gap: 4px`；
- `padding: 10px 0`；
- row `padding: 4px 8px 4px 14px`；
- `max-height: 70vh`；
- `overflow-y: auto`；
- scrollbar 隐藏规则；
- item `opacity 0.2s`、`transform 0.2s`、`max-width 0.28s`。

同时运行完整 nav 测试，确保 core、adapter、manifest 和 URL routing 不受影响。

## 验收标准

- hover 文字在约 200ms 内可见；
- nav 条目垂直节奏约 30px；
- nav 高度不超过 `70vh`；
- 超出高度时可以内部滚动，但不显示滚动条；
- active line、点击、DOM 结构和所有平台 adapter 行为不变；
- 完整 nav 自动化测试通过；
- 不 push。
