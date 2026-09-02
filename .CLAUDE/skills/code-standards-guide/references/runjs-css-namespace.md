---
name: runjs-css-namespace
description: 当需要在 runjs/ 或 funcs/ 下新增 / 修改「注入到主页面」的 CSS（content_scripts.css、运行时 <style>、<link rel=stylesheet>）、或发现注入的样式污染了宿主页面（与宿主同名 class 撞车、@keyframes 冲突、选择器无前缀）时触发。核心约束：(1) 注入主页面的 CSS 必须收敛到单一命名空间根下（作用域根 + CSS 嵌套，或统一前缀）；(2) @keyframes 动画名必须命名空间化；(3) CSS 已定义的样式，JS 端不得重复注入 <style>。
reference: code-standards-guide — 注入主页面的 CSS 命名空间隔离规范（归档版）
---

# 注入主页面的 CSS 命名空间隔离规范

## 核心问题

`content_scripts.css`（manifest.json 的 `content_scripts[].css`）、`chrome.scripting.executeScript` 注入的 IIFE 内 `<style>`、以及 `<link rel="stylesheet">` —— 三者都会**写入宿主页面真实的 DOM**（`document.head` / `document.documentElement`）。这意味着：

1. **选择器污染宿主页面**：一个裸类名 `.content-section` / `.footer-section` / `.panel-header` / `.section-title` / `.edit-btn` 会被注入到用户访问的**任何网站**。CMS / 博客 / 文档站大量使用这些通用语义类名，一旦同名，扩展样式会**破坏宿主页面布局**，反之宿主样式也会污染扩展 UI。
2. **`@keyframes` 全局冲突**：动画名在文档中是全局命名空间，`@keyframes slideIn` 与宿主页面同名动画会互相覆盖（后定义者胜）。
3. **重复注入**：JS 每次触发都 `appendChild` 一个 `<style>`，若该样式 CSS 文件已定义，就会堆积多个无 id 守护的 `<style>` 节点。

## 铁律 1：注入主页面的 CSS 必须收敛到单一命名空间根

### 方案 A：作用域根 + 原生 CSS 嵌套（推荐，已落地在 content.css）

让「命名空间根选择器」作为最外层容器，**所有子选择器嵌套在其内部**。根选择器只写一次，子选择器靠 CSS 嵌套自动继承前缀。

```css
/* ❌ 反面：每个规则都要写双根前缀，累赘且易漏 */
#selection-result-panel .panel-header,
.selection-result-panel .panel-header { ... }
#selection-result-panel .content-section,
.selection-result-panel .content-section { ... }

/* ✅ 正面：原生 CSS 嵌套，根只写一次 */
#selection-result-panel,
.selection-result-panel {          /* 根 = 单一命名空间 */
  .panel-header { ... }
  .content-section { ... }

  /* 伪元素 / 复合选择器用 & */
  .content-section {
    &::-webkit-scrollbar { width: 4px; }
    &::-webkit-scrollbar-thumb { background: ...; }
  }

  /* :hover / .active 等状态用 & */
  .edit-btn {
    &:hover { ... }
  }
  #selection-auto-translate.active { ... }

  /* @media 也可以嵌套在根内，深色主题覆盖自然落进作用域 */
  @media (prefers-color-scheme: dark) {
    .footer-section { background: #252525; }
  }

  @media (max-width: 768px) {
    width: 90vw;
  }
}
```

**嵌套语义速查**（CSS Nesting Level 1，Chrome 112+）：

| 写法 | 等价于 |
|------|--------|
| 嵌套 `.panel-header { }` | `#selection-result-panel .panel-header`（后代） |
| 嵌套 `#selection-close-result { }` | `#selection-result-panel #selection-close-result` |
| `&:hover` | `当前规则:hover`（复合） |
| `&::before` / `&::-webkit-scrollbar` | `当前规则::伪元素` |
| 嵌套 `@media` | 条件规则内仍是当前根作用域 |

> 类型选择器（`h1`、`p`、`code`）嵌套时是**后代**语义：`#selection-result-text { h1 { } }` = `#selection-result-text h1`。

**为什么根用 `#id, .class` 双写一次可以**：面板创建时 JS 同时设了 `panel.id` 和 `panel.className`（见 `runjs/translation/content.js` 的 `createResultPanel`），双锚保证两种创建方式都命中。但**只在根上双写一次**，子选择器绝不再双写 —— 这是与旧版的本质区别。

### 方案 B：统一前缀（适用无法用根容器收敛的场景）

如果样式要应用到**独立于面板根之外**的多个元素（例如 toast、tooltip 直接挂 `document.body` 下），无法靠一个根收敛，就用统一业务前缀：

```css
.bro-trans-toast { ... }
.bro-trans-toast-close { ... }
```

### 方案选择

| 场景 | 方案 |
|------|------|
| 样式全在「一个面板 / 一个容器」内部 | **方案 A**（根 + 嵌套） |
| 样式分散在多个独立浮层（toast/tooltip/通知） | **方案 B**（统一前缀） |

## 铁律 2：@keyframes 动画名必须命名空间化

`@keyframes` 名是全局命名空间，必须加业务前缀防止与宿主页面撞车：

```css
/* ❌ 与宿主页面同名，可能互相覆盖 */
@keyframes slideIn { ... }
@keyframes slideOut { ... }

/* ✅ 命名空间化 */
@keyframes bro-slide-in { ... }
@keyframes bro-slide-out { ... }
```

同步更新 JS 中的动画引用（`animation: bro-slide-in 0.3s ease-out`）。

## 铁律 3：CSS 已定义的样式，JS 端不得重复注入 <style>

如果样式（含 `@keyframes`）已经写在 content_scripts.css 里（随页面加载注入），JS 端**不要**再动态 `document.head.appendChild(<style>)` 重复注入 —— 那只会堆积重复 `<style>` 节点。

```javascript
// ❌ content.js 每次收藏都注入一份 @keyframes（CSS 已定义）
const style = document.createElement('style');
style.textContent = `@keyframes slideIn { ... }`;
document.head.appendChild(style);

// ✅ 直接用 CSS 里已定义的动画名，不再注入
notification.style.animation = 'bro-slide-in 0.3s ease-out';
```

**例外**：如果样式只出现在运行时（模块按需注入，CSS 文件不常驻），才需要 JS 注入 `<style>` —— 但要加 **id 守护**（`if (!document.getElementById(STYLE_ID))`）防重复。

## 审计清单

新增 / 修改注入主页面的 CSS 时确认：

- [ ] 每个类选择器都收敛在命名空间根下（方案 A）或带业务前缀（方案 B），**无裸类名泄漏到全局**
- [ ] 顶层只有根选择器（`.selection-result-panel` / `.selection-trans-panel` 之类），子选择器全部嵌套
- [ ] `@keyframes` 名带业务前缀（`bro-`）
- [ ] CSS 文件已定义的样式，JS 端没有重复 `<style>` 注入
- [ ] JS 运行时注入的 `<style>` 有 id 守护
- [ ] 深色主题 / 响应式 `@media` 也嵌套在根内，作用域一致

## 验证方法：headless Chrome 断言 computed style

CSS 嵌套与隔离必须用真实浏览器验证（CSS 嵌套解析失败时会静默丢规则）。gstack browse 在 Windows 上 spawn 分离进程可能失败，可用系统 Chrome 直接验证：

```bash
# 1. 构造测试页：宿主同名元素（面板外）+ 扩展面板结构 + 引用目标 CSS
cat > /tmp/css-check.html << 'EOF'
<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  /* 宿主页面样式：无 !important，仅设与扩展不同的值 */
  .panel-header { background: #ffd700; }
  .section-title { color: #ff0000; font-size: 20px; }
</style>
<link rel="stylesheet" href="../runjs/translation/content.css">
</head><body>
  <div class="panel-header" id="h">宿主</div>
  <div id="selection-result-panel" class="selection-result-panel" style="display:flex;">
    <div class="panel-header">扩展</div>
    <div class="section-title">扩展标题</div>
  </div>
  <pre id="r"></pre>
  <script>
    const r = [];
    const g = (s,p) => { const el = document.querySelector(s); return el ? getComputedStyle(el)[p] : 'MISSING'; };
    r.push('宿主 .panel-header bg   = ' + g('#h', 'backgroundColor'));       // 应保留 #ffd700
    r.push('面板 .panel-header bg   = ' + g('#selection-result-panel .panel-header', 'backgroundColor'));  // 应用扩展样式
    r.push('面板 .section-title 色  = ' + g('#selection-result-panel .section-title', 'color'));           // #999
    document.getElementById('r').textContent = r.join('\n');
  </script>
</body></html>
EOF

# 2. headless Chrome dump DOM，断言输出
"C:/Program Files/Google/Chrome/Application/chrome.exe" \
  --headless=new --disable-gpu --no-first-run --virtual-time-budget=2000 \
  --dump-dom "file:///D:/DevProjects/my/bro_chat/temp/css-check.html" 2>/dev/null \
  | grep -A 6 '<pre id="r">'
```

**注意**：宿主样式不要用 `!important`（那会合法覆盖扩展样式，测试失真）。要验证的核心是**无 `!important` 时**扩展的 `#selection-result-panel .panel-header`（特异性 1,1,0）能压过宿主的 `.panel-header`（0,1,0），且**不影响面板外元素**。

**验证 dark 模式 / @media 嵌套**：加 `--force-dark-mode` 参数，断言面板内元素应为深色值（如 `#252525` → `rgb(37,37,37)`）。

## 错误案例警示

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| 裸类名 `.content-section` 直接写进 content.css | 注入任意网站，与宿主同名 class 撞车，宿主布局被 `flex:1` + 纸张纹理破坏 | 收敛到 `#selection-result-panel` 根下 |
| 双根前缀重复写 | 25 个规则 × 2 个根，维护困难、易漏 | 原生 CSS 嵌套，根只写一次 |
| `@keyframes slideIn` 不命名空间化 | 与宿主页面同名动画互相覆盖 | `@keyframes bro-slide-in` |
| JS 重复注入 CSS 已定义的 `<style>` | 每次触发堆积重复 `<style>` 节点 | 直接用 CSS 定义的动画名 |
| 运行时 `<style>` 无 id 守护 | 重复触发多次注入 | `if (!document.getElementById(id))` |

## 应用范围

- `runjs/translation/content.css` — **已落地**（2026-08 重构，作用域根 + 嵌套；原有 `bro-slide-in/out` 动画随划词收藏功能于 2026-09 移除，新增动画仍须带 `bro-` 前缀）
- `runjs/translation/selection-ask.css` — 待审计（`.selection-trans-panel` 根已具备，子选择器需确认）
- `runjs/translation/content-ocr.css` — 待审计（`ocr-*` 前缀较好，可统一风格）
- `contentScripts/nav/view.js` 的 `NAV_CSS` — 已用 `${NAV_ID}` / `${TOOLBAR_CLASS}` 前缀隔离 ✅
- `funcs/x/typingMonitor/typingMonitor.js` — ⚠️ `<style>` 无 id 守护，需修
- `shared/imageOcr.js` 的 `<link>` 注入 — ⚠️ 依赖 `web_accessible_resources` 声明，需确认 `shared/*.css` 在清单内

## 相关 Skill

- [[runjs-module-standards]] — runjs/ 注入脚本的整体规范（注入策略 / 模块边界 / 依赖矩阵），CSS 命名空间是其「怎么写样式」维度的补充
- [[add-func-script]] — funcs/ 脚本规范（executeScript 注入的 IIFE 同样适用本命名空间规则）
