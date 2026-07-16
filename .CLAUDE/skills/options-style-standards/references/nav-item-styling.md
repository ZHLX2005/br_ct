---
name: nav-item-styling
description: Options 侧边栏 .nav-item / .nav-icon 的边框强调与 hover/active 配色规范。继承 options-style-standards 的"边框强调不用色块 + 文字全不透明"原则。覆盖 options/options.css 中侧边导航的具体样式规则、状态对照表、历史踩坑、迭代历史。
---

# Options 侧边栏 nav-item / nav-icon 样式规范

> 本 ref 是 [[options-style-standards]] 的特化场景 — 原则（边框强调、不透明文字、反浮岛）沿用主文档，本 ref 只讲 .nav-item / .nav-icon 在侧边栏的具体实现细节。

## 触发条件

- 修改 `.nav-item` 或 `.nav-icon` 样式
- 新增 options 侧边栏 nav 项
- 调整 nav 的 hover/active/focus 状态
- 用户提到 "边框"、"色块"、"方块强调"、"tab样式"、"nav-item"

## 核心规则

### 1. 图标方块用边框，不用背景填充

`.nav-icon`（字母缩写方块）靠 `border` 做视觉强调，**图标自身不能加不透明背景色块**。

```css
.nav-icon {
  border: 1px solid var(--line);        /* default: 弱边框 */
  background: transparent;
  color: var(--ink);                    /* 全不透明，禁止半透明 */
  font-size: 11px;
  font-weight: 800;
}

/* Hover: 边框略加深 + 极淡填充 */
.nav-item:hover .nav-icon {
  border-color: var(--line-strong);
  background: rgba(255, 255, 255, 0.5);
}

/* Active: accent 边框 = 选中指示 */
.nav-item.active .nav-icon {
  border-color: var(--accent);
}
```

### 2. Nav Item 状态

```css
/* Default: 无背景，文字全不透明 */
.nav-item {
  border: none;
  background: transparent;
  color: var(--ink);                    /* #2d241c，全不透明 */
}

/* Hover: 白色色块浮起 */
.nav-item:hover {
  background: rgba(255, 255, 255, 0.7);
}

/* Active: 更强的白色色块 + 图标 accent 边框 */
.nav-item.active {
  background: rgba(255, 255, 255, 0.85);
}
```

### 3. 文字颜色规则

**文字必须用 `var(--ink)` (`#2d241c`) 全不透明。** 禁止 `rgba(45, 36, 28, 0.6)` 等半透明 — 在暖纸面上会看不清。

## 状态对照表

| 状态 | .nav-item 背景 | .nav-item 文字 | .nav-icon 边框 | .nav-icon 背景 |
|------|---------------|---------------|---------------|---------------|
| Default | transparent | `var(--ink)` | `var(--line)` | transparent |
| Hover | `rgba(255,255,255,0.7)` | `var(--ink)` | `var(--line-strong)` | `rgba(255,255,255,0.5)` |
| Active | `rgba(255,255,255,0.85)` | `var(--ink)` | `var(--accent)` | transparent |

## 常见错误

| 错误 | 现象 | 修复 |
|------|------|------|
| 把边框加在 `.nav-item` 而不是 `.nav-icon` | 整行 outline，视觉错位 | 只给 `.nav-icon` 加边框强调 |
| 文字 `rgba(45,36,28,0.6~0.8)` | 暖纸面上看不清楚 | 用 `var(--ink)` 全不透明 |
| `.nav-icon` 默认状态有背景色块 | 像一颗彩色按钮 | 默认透明，仅 hover 加淡填充 |
| `.nav-item.active` 无背景 | 选中态分辨不出 | 必须有 `rgba(255,255,255,0.85)` |
| 删除 active 背景 | 用户看不出哪个 tab 选中 | active 永远要有 `rgba(255,255,255,0.85)` |

## 迭代历史（踩坑记录）

1. 第一版：边框加在 `.nav-item` 行 → ❌ 用户要的是图标方块边框
2. 然后：删掉所有背景 → ❌ 用户又要回 hover/active 色块
3. 然后：文字色 0.68 → 太浅 → 0.8 → 还浅 → 0.92 → 还浅 → `var(--ink)` ✅
4. 然后：active 无背景 → ❌ 补回 `rgba(255,255,255,0.85)`
5. 最终：图标边框强调 + nav-item hover/active 色块 + 文字全 ink 色

## 优先级

| 优先级 | 规则 | 原因 |
|--------|------|------|
| P0 | 文字色 = `var(--ink)` 全不透明 | 暖面上半透明文字不可读 |
| P1 | 边框只在 `.nav-icon`，不在 `.nav-item` | 视觉强调落在图标方块 |
| P2 | active 必须有背景色块 | 用户需要明确选中态指示 |
