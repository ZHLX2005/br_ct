---
name: options-style-standards
description: 在 options/ 模块下编写或修改 CSS / HTML / JS 时的开发规范。当用户提到"options 样式"、"options 按钮"、"去浮岛"、"边框强调"、"options 子页面 CSS"、新增 options 子页面、修改 .btn-primary/.btn-secondary/.btn-danger 颜色时触发。覆盖 8 个子页面（platform/api/storage/notes/ocr/countdown/prompts_editor/local_cmd）的样式统一、共享 token 使用、HTML link 顺序、内联 style 反模式。
---

# options/ 模块样式开发规范

## 1. 模块职责边界

| 层级 | 路径 | 职责 | 禁止 |
|------|------|------|------|
| 外壳 | `options.css` + `options.html` + `options.js` | 侧边栏、iframe 容器、点导航、Win+Tab 切换器 | 业务页面样式 |
| 共享 | `options/options.css` | 设计 token、按钮系统、input/select/textarea、section/page-header、状态消息、focus ring | 子页面私有组件 |
| 子页面 | `options/<name>/<name>.css` | 页面特有组件（timer-card、result-item、cmd-card、skill-card 等） | 重复定义按钮、input、section |
| 子页面 HTML | `options/<name>/index.html` 或 `prompts_editor.html` | DOM 结构 + 引用两个 CSS | 内联 `<style>` 块、大量 `style=""` 属性 |
| 子页面 JS | `options/<name>/*.js` | 行为、事件、storage 读写 | 业务样式规则 |

## 2. 共享 token 系统（必须使用，不要写新 hex）

```css
:root {
  /* 颜色（已定义） */
  --paper: #f6efe2;            /* 纸面底色 */
  --paper-deep: #ebdfc7;
  --ink: #2d241c;              /* 主文字 - 全不透明 */
  --muted: #7a6858;            /* 次文字 */
  --line: rgba(93, 67, 43, 0.12);     /* 分隔线 */
  --line-strong: rgba(93, 67, 43, 0.22);
  --accent: #99673f;           /* 棕色强调 */
  --accent-deep: #6b4a31;      /* 深棕 */
  --success: #6a8758;
  --success-deep: #4c6740;     /* 成功文字 */
  --danger: #9a4f40;
  --danger-deep: #7a3025;      /* 危险文字 */

  /* 圆角 */
  --radius-btn: 8px;
  --radius-input: 6px;
  --radius-md: 18px;           /* 卡片 */
  --radius-lg: 24px;
  --radius-xl: 30px;           /* 大容器 */

  /* 字体层级 */
  --font-h1: clamp(22px, 2.4vw, 28px);
  --font-h2: 16px;
  --font-h3: 14px;
  --font-body: 14px;
  --font-small: 12px;

  /* 间距 */
  --section-gap: 22px;

  /* focus ring */
  --focus-ring: 0 0 0 3px rgba(153, 103, 63, 0.12);

  /* 按钮变量 */
  --btn-fg: var(--ink);
  --btn-bg: transparent;
  --btn-bg-hover: rgba(255, 255, 255, 0.72);
  --btn-bg-primary: rgba(255, 251, 245, 0.85);
  --btn-bg-primary-hover: rgba(153, 103, 63, 0.10);
  --btn-bg-danger: rgba(154, 79, 64, 0.06);
  --btn-bg-danger-hover: rgba(154, 79, 64, 0.12);
}
```

## 3. 核心设计原则（不可违反）

### 3.1 边框强调，不是色块

**所有按钮的"强调"通过边框粗细和颜色饱和度表达，绝不用实心棕色块。**

| 按钮 | 边框 | 背景 | 文字 |
|------|------|------|------|
| `.btn-primary` | `2px solid var(--accent)` | `var(--btn-bg-primary)` 淡米色 | `var(--accent-deep)` |
| `.btn-secondary` | `1px solid var(--line-strong)` | transparent | `var(--ink)` |
| `.btn-success` | `1px solid rgba(106,135,88,0.45)` | transparent | `var(--success-deep)` |
| `.btn-warning` | `1px solid rgba(184,138,74,0.45)` | transparent | `#8a6428` |
| `.btn-danger` | `1px solid rgba(154,79,64,0.45)` | `var(--btn-bg-danger)` 极淡红 | `var(--danger-deep)` |

Hover：背景加淡米色 + 边框转 accent。

### 3.2 去浮岛（De-Floating Island）

**Section/卡片：透明背景 + 1px 分割线，**不用圆角 + 阴影。**允许保留的"非浮岛"元素**：
- `border-radius` + 1px `var(--line)` 边框（用于"卡片"语义）
- `border-radius` + 1px dashed 边框（用于 drop zone / paste-zone）
- `box-shadow: var(--shadow-soft)`（用于 modal、toast、悬浮 popover）

**禁止**：`background: rgba(255, 255, 255, 0.6) + border-radius: 12px + box-shadow` 三件套同时出现（这是浮岛的反模式）。

### 3.3 文字颜色全不透明

**所有正文/标题用 `var(--ink)` 全不透明。** 禁止 `rgba(45, 36, 28, 0.6)`、`rgba(45, 36, 28, 0.84)` 等半透明灰色 — 在暖色纸面上会"飘"得看不清楚。

只有以下场景允许半透明：
- `background: rgba(255, 255, 255, 0.5)` 之类的容器淡填充
- `border: 1px solid var(--line)` 之类的弱分隔
- `color: var(--muted)` 用于辅助说明（`--muted` 本身就是中性灰）

## 4. HTML link / script 顺序（强制）

**所有子页面 HTML 必须在 head 中按以下顺序引用：**

```html
<link rel="stylesheet" href="../options.css" />   <!-- 1. 共享层 -->
<link rel="stylesheet" href="./<page>.css" />     <!-- 2. 子页面层（仅覆盖/扩展） -->
...
<script type="module" src="../focusScroll/init.js"></script>  <!-- 3. 共享脚本 -->
<script src="./<page>.js"></script>                            <!-- 4. 页面脚本 -->
```

**检测命令**：
```bash
# 检查每个子页面是否先引用 options.css
for f in options/*/index.html options/*/*.html; do
  if grep -q '<link rel="stylesheet" href="\./' "$f"; then
    head -10 "$f" | grep -n "stylesheet" || echo "❌ $f 子页面 CSS 在 options.css 之前"
  fi
done
```

## 5. 反模式（绝对禁止）

### 5.1 禁止的按钮风格

#### bad_example 1：实心棕色块

```css
.btn-primary {
  background: var(--accent);          /* ❌ 实心棕色块 */
  color: #fffaf4;
  box-shadow: none;
}
```

#### good_eg 1：边框强调

```css
.btn-primary {
  color: var(--accent-deep);
  background: var(--btn-bg-primary);
  border-width: 2px;                  /* 粗细区分主次 */
  border-color: var(--accent);
}
```

#### bad_example 2：浮岛卡片

```css
.prompt-section {
  background: rgba(255, 255, 255, 0.6);
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);  /* ❌ 三件套 = 浮岛 */
  padding: 24px;
}
```

#### good_eg 2：去浮岛

```css
.prompt-section {
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  padding: 12px 0 18px;
  border-bottom: 1px solid var(--line);  /* ✅ 唯一一条横线 */
}
```

### 5.2 禁止的内联样式

#### bad_example 3：HTML 中大量 `style=""`

```html
<!-- options/local_cmd/index.html:58 处 ❌ -->
<button class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px;">分组</button>
<input type="text" id="envvarNewPath" style="flex:1;padding:6px 10px;border:1px solid var(--line-strong);border-radius:8px;font-size:14px;">
<div id="envvar-userPathList" style="border:1px solid var(--line);border-radius:var(--radius-md);background:rgba(255,252,247,0.72);max-height:400px;overflow-y:auto;">
```

#### good_eg 3：抽到子页面 CSS

```css
/* options/local_cmd/local_cmd.css */
.skill-panel-toolbar-btn {
  padding: 4px 10px;
  font-size: var(--font-small);
  min-height: 26px;
}

.envvar-list-container {
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: rgba(255, 252, 247, 0.5);
  max-height: 400px;
  overflow-y: auto;
}
```

```html
<button class="btn btn-secondary skill-panel-toolbar-btn">分组</button>
<input type="text" id="envvarNewPath" class="envvar-input">
<div id="envvar-userPathList" class="envvar-list-container">
```

**例外**（允许保留 `style=""`）：
- `<input type="file" style="display: none">` — 隐藏原生文件选择器
- `<div class="color-btn" data-color="#99673f" style="background: #99673f">` — 数据驱动的颜色块
- `<button class="btn" data-action="x" style="display: none">` — JS 控制的显隐
- `<span style="display:flex;gap:8px">` 等纯布局快捷（≤2 个属性时可用）

**检测命令**：
```bash
# 找出含 >5 处 style=" 的子页面
for f in options/*/index.html options/*/*.html; do
  count=$(grep -c 'style="' "$f")
  [ "$count" -gt 5 ] && echo "❌ $f 有 $count 处内联 style"
done
```

### 5.3 禁止的 CSS 重复定义

#### bad_example 4：子页面 CSS 重新定义按钮基础

```css
/* options/prompts_editor/prompts_editor.css */
.btn {
  padding: 8px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 13px;
  background: white;          /* ❌ 跟 options.css 冲突 */
  color: #6b635a;
}

.btn-primary {
  background: var(--accent);  /* ❌ 实心棕色块 */
  color: white;
}
```

#### good_eg 4：仅在必要时局部覆盖

```css
/* options/prompts_editor/prompts_editor.css */
/* 不写 .btn 基础；只写 .btn-primary 覆盖 padding 以匹配本页面 .btn 局部定义 */

.btn-primary {
  /* 页面特定 .btn-primary 覆盖：调整 padding 以匹配本地 .btn (7px 14px) */
  color: var(--accent-deep);
  border-color: var(--accent);
  border-width: 2px;
  padding: 6px 13px;
  background: var(--btn-bg-primary);
}
```

### 5.4 禁止的半透明文字

#### bad_example 5

```css
.setting-title {
  color: rgba(45, 36, 28, 0.84);  /* ❌ 半透明 ink */
  font-size: 15px;
}
```

#### good_eg 5

```css
.setting-title {
  color: var(--ink);              /* ✅ 全不透明 */
  font-size: var(--font-h3);
}
```

### 5.5 禁止的重复 token

#### bad_example 6：子页面 CSS 重新定义 :root

```css
/* options/notes/notes.css */
:root {
  --paper: #f6efe2;       /* ❌ 跟 options.css 重复 */
  --ink: #2d241c;
  --muted: #796857;       /* ❌ 色值略有差异，跟全局不一致 */
  --accent: #99673f;
  ...
}

body {                    /* ❌ 跟 options.css 重复 */
  font-family: Georgia, serif;
  background: radial-gradient(...);
}
```

#### good_eg 6：直接引用共享 token

```css
/* options/notes/notes.css */
.notes-page { ... }  /* 不重新 :root、不重复 body */
```

## 6. 模块依赖矩阵

### 6.1 CSS 依赖

| 子页面 | 引用 | 用途 |
|--------|------|------|
| `options.css` | （无） | 共享层 |
| `countdown/countdown.css` | `options.css` | timer-card 颜色、grid 布局、modal |
| `notes/notes.css` | `options.css` | 笔记卡片、composer/preview 分栏 |
| `ocr/main.css` | `options.css` | prompt-item、result-item、paste-zone |
| `local_cmd/local_cmd.css` | `options.css` | cmd-card、git-card、skill-card、tab-nav |
| `prompts_editor/prompts_editor.css` | `options.css` | editor-panel、file-list-panel、prompt-item |
| `storage/storage.css` | `options.css` | backup-status、json-tree、setting-row、toggle-switch |

### 6.2 JS 模块拆分（local_cmd 范例）

`local_cmd/` 拆 7 个文件，按**职责**切分：

| 文件 | 职责 | 行数 |
|------|------|------|
| `core.js` | 共享工具：通信、storage、Toast、确认 | 131 |
| `command.js` | 命令模板 + 子进程管理 | 177 |
| `git.js` | Git 监控目录 | 314 |
| `skill.js` | Skill 管理（中心仓库 + 项目） | 877 ⚠️ |
| `git_import.js` | 从 Git 仓库导入 Skill | 249 |
| `envvar.js` | 环境变量管理 | 547 ⚠️ |
| `local_cmd.js` | 入口：init + 事件分发 | 179 |

**约束**：
- `core.js` 是唯一允许被其他文件调用工具函数的位置
- 业务文件（command/git/skill 等）**禁止互相 import**（无 ES Module），通过 `local_cmd.js` 集中调度
- 单文件 > 500 行需要拆分（skill.js、envvar.js 已标记）

## 7. 字号层级（强制）

| 标签 | token | 用例 |
|------|-------|------|
| 页面 h1 | `--font-h1` (22-28px) | `<header class="ocr-header"><h1>...</h1>` |
| Section h2 | `--font-h2` (16px) | `<h2 class="section-title">` |
| 卡片标题 | `--font-h2` (16px) | `.cmd-card-name`、`.git-card-dir` |
| 正文 | `--font-h3` (14px) | `.setting-title`、`.form-label` |
| 辅助文字 | `--font-small` (12px) | `.form-hint`、`.setting-description` |
| 提示徽标 | 11px | `.status-badge`、`.section-kicker` |

**禁止**页面里 h2 用 `--font-h1`（会让弹窗/卡片标题视觉上"压过"页面主标题）。

## 8. 实施检查清单

修改或新增 options 子页面样式时，对照检查：

- [ ] HTML 在 head 中**先**引用 `../options.css`，**后**引用自己的 `<name>.css`
- [ ] HTML 中**没有** `<style>...</style>` 块（已抽到 CSS）
- [ ] HTML 中 `style=""` 属性 ≤ 5 处（且都在白名单：hidden、color-swatch、JS 显隐、纯布局）
- [ ] CSS 不重复定义 `:root`、不重复定义 `.btn` 基础
- [ ] `.btn-primary` 用 2px 边框，不用实心棕色块
- [ ] Section/卡片背景透明，border-bottom 1px 横线
- [ ] 文字颜色全不透明（`var(--ink)` / `var(--muted)`）
- [ ] 子页面 h2 用 `--font-h2` (16px)
- [ ] input/select/textarea 用 `1px solid var(--line-strong)`，focus 用 `--focus-ring`
- [ ] 不破坏现有 class 名（`.btn-primary`、`.btn-secondary`、`.btn-danger` 等仍存在）
- [ ] JS 文件按职责切分，单文件 ≤ 500 行

## 9. 快速验证命令

```bash
# 1. 检查 link 顺序
for f in options/*/index.html options/*/*.html; do
  if grep -q '<link rel="stylesheet" href="\./' "$f" 2>/dev/null; then
    head -15 "$f" | grep -E 'stylesheet' | head -2
  fi
done

# 2. 检查内联 <style> 块
grep -lE "<style>" options/*/index.html options/*/*.html 2>/dev/null

# 3. 检查残余棕色块按钮
grep -nE "background:\s*var\(--accent\)\s*;" options/*.css options/*/*.css 2>/dev/null
# （允许：toggle-slider.checked、dot.active、queue-status-dot.processing 等状态指示器）

# 4. 检查半透明文字
grep -nE "color:\s*rgba\(45" options/*.css options/*/*.css 2>/dev/null

# 5. 检查 :root 重复定义
grep -lE "^:root\s*\{" options/*/*.css 2>/dev/null
# （应该 0 个匹配；所有 token 来自 options.css）

# 6. 检查 .btn-primary 是否边框
grep -A2 "^\.btn-primary\s*\{" options/options.css | head -5
```

## 10. 错误案例警示

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| `<button class="btn btn-primary" style="background: var(--accent)">` | 退回到旧版"实心棕色块"，违反边框强调原则 | 用 `class="btn btn-primary"`（继承 options.css 的 2px 边框定义） |
| 子页面 CSS 写 `:root { --accent: ... }` | 跟全局色值略有偏差，整个页面颜色不一致 | 直接 `var(--accent)` |
| 弹窗标题用 `font-size: 24px` | 视觉权重压过页面 h1 | 用 `var(--font-h2)` (16px) |
| input 用 `border: 2px solid #e9ecef` | 跟全局 input 风格不一致 | `border: 1px solid var(--line-strong)` |
| section 用 `background: rgba(255,255,255,0.7); border-radius: 12px; box-shadow: 0 2px 8px` | 三件套 = 浮岛，破坏去浮岛原则 | 透明背景 + 1px border-bottom 横线 |
| `options.html` 的 nav-item 用 `background: var(--accent); color: white` | 激活态变成实心棕色块 | 继承 `.nav-item.active` 的 `rgba(255,255,255,0.85)` 浅色块 + 边框强调 |
| 引入新页面后忘了加 `../options.css` 引用 | 该页面所有按钮变成浏览器默认样式 | 检查 `<link rel="stylesheet" href="../options.css" />` 是否在第一行 |

## 11. 触发本 skill 的场景

修改以下内容时**必须**先读这个 skill：

- 新增 options 子页面（要先创建 `<name>/<name>.css` 并引用 options.css）
- 修改 `.btn-primary` / `.btn-secondary` / `.btn-danger` 颜色
- 添加新的状态徽标（`status-badge`、`.api-status`、`.result-status`）
- 改字号层级（h1/h2/h3 调整）
- 把某个组件从"浮岛"改成"去浮岛"（或反之）
- 抽取内联 `<style>` 块到独立 CSS
- 修复 CSS 类名冲突（如 `.form-group` 在 modal 里和全局不一致）
