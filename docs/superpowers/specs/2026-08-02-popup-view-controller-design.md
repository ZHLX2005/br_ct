# Popup 三页导航中间件（视图挂载控制器）设计文档

**日期**: 2026-08-02
**作者**: Claude (brainstorming → 待 writing-plans)

---

## 目标

用一个**中间件（视图挂载控制器）**接管 `popup` 三个页面（主页 / 函数库 / 划词翻译）的切换：nav 点击不再触发整页导航，而是由控制器在单一 shell 文档内 **挂载 / 卸载** 各视图的 body DOM 实例。

成功标准：

1. **消除切换刷新**——切换不再重解析 CSS/JS 模块图、不重建 platformRenderer DOM、不重读 storage。
2. **状态保留**——切换走再回来，输入框内容 / 平台勾选 / 滚动位等不丢（直接修掉"切换后状态丢失"类 bug）。
3. **直开调试可用**——独立页 URL 仍可直接打开（满足 `chrome-extension://.../popup/translation/translation.html` 调试需求）。
4. **CSS 隔离**——三页 CSS 共存于 shell 时不互相污染。

## 背景与现状

### 三页结构

| 视图     | HTML                                            | 页级 CSS                                 | 页级 JS                                        | init 现状                                                                                          |
| -------- | ----------------------------------------------- | ---------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 主页     | `popup/main/main.html`（= `default_popup`） | `main.css` + `prompts/promptsUI.css` | `main.js` (ES module) → `mainUtils.js` 等 | init 函数**已 export**（`initializePopup` / `setupEventListeners` / `loadStoredData`） |
| 函数库   | `popup/func_execute/functioncall.html`        | `functioncall.css`                     | `functioncall.js`（经典脚本）                | init 锁在`DOMContentLoaded` 匿名回调，**未 export**                                        |
| 划词翻译 | `popup/translation/translation.html`          | `translation.css`                      | `translation.js`（经典脚本）                 | 同上，**未 export**                                                                          |

共享：`popup/components/theme.css`（变量 + `html,body` 基础 + header/nav，三页都引）。

### 当前切换逻辑（要被取代的）

- 前 3 个 nav 项是裸 `<a href="...html">`，**零 JS 拦截** → 浏览器原生整页导航 → 完整重载。
- 「设置」项是 `<span>` + JS → `chrome.runtime.openOptionsPage()`（新标签打开，popup 关闭）。
- nav 切换每次成本：3 个 CSS + ES module 图重解析、`initializePlatformOptions()` 重建全部平台图标 DOM、2-3 次 `chrome.storage` 往返、全量重绑监听。

### 关键约束（已在 brainstorming 确认）

1. **无 iframe**——同文档 DOM mount/unmount。
2. **body 来源**：shell 首次挂载某视图时 `fetch` 其独立 HTML → `DOMParser` 抽 `<body>` 子节点 → 存为 DOM 对象。**单一真源、无标记重复、独立文件保留可直开**。
3. **CSS 隔离**：控制器**切 `<link>`**（切到某视图时只留其页级 CSS，移除其他；`theme.css` 恒留）。不做命名空间化。
4. **卸载语义**：detach（移出 DOM）但**保留 DOM 实例引用**——不是 destroy。状态/监听因此保留。

## 架构

### 总览

```
main.html (shell)
├─ <head>
│   ├─ theme.css            （恒留：变量/html,body/header/nav）
│   ├─ shell.css            （恒留：nav 容器 + #view-mount）
│   └─ <script type=module src="shell.js">
│         ├─ import viewController from "./viewSystem/viewController.js"
│         └─ import 各视图的 { init, teardown }  ← shell 直接 import，不从 fetch 来
└─ <body>
    ├─ .header > nav（主页/函数库/划词翻译/设置）
    └─ <div id="view-mount"></div>   ← 控制器在此 attach/detach 视图 DOM
```

页级 CSS（`main.css` / `promptsUI.css` / `functioncall.css` / `translation.css`）**不在 head 静态写死**，由控制器在运行时按当前视图 add/remove `<link>`。

### 核心组件：`viewController`（中间件）

`popup/viewSystem/viewController.js`，导出一个单例，接口：

```js
register(views)          // 注册视图表（启动时调一次）
mount(viewId)            // 切到目标视图（幂等：相同 viewId no-op）
getCurrent()             // 当前视图 id
```

### 视图注册表（对象形式）

```js
const views = {
  main:        { id, htmlUrl: "main/mainView.html",          cssHrefs: [mainCss, promptsUICss], init, teardown, dom: null, ready: false },
  func:        { id, htmlUrl: "func_execute/functioncall.html", cssHrefs: [funcCss],              init, teardown, dom: null, ready: false },
  translation: { id, htmlUrl: "translation/translation.html",   cssHrefs: [translationCss],       init, teardown, dom: null, ready: false },
};
// htmlUrl:  该视图 body DOM 的 fetch 源（相对 shell 的路径）。
// dom:    该视图的 body DOM 实例（<div class="view view-xxx">）。null 表示尚未取回。
// ready:  init 是否已跑过（true 则后续 mount 不再跑 init）。
```

> main 的 body 源已定（决策 1）：拆出 `popup/main/mainView.html`，三视图统一走 fetch，无特例。

### mount(viewId) 序列（单次同步 tick，避免中间帧闪烁）

1. `getCurrent() === viewId` → return。
2. **取 body（仅首次）**：若 `views[viewId].dom === null` →
   - `fetch(viewHtmlUrl)` → `DOMParser.parseFromString(html, 'text/html')` →
   - 取 `parsed.body` 的 `children`，包进 `<div class="view view-{id}">`，存入 `dom`。
3. **teardown 旧视图**：`teardown(views[current].dom)`（同步清理 document 级监听 / 临时态；无特殊清理的视图为 no-op）。
4. **attach 新视图**：`mountPoint.appendChild(views[viewId].dom)`。
5. **切 link**：移除当前视图的页级 `<link>`，添加目标视图的页级 `<link>`（`theme.css` 不动；保证 theme 在最前）。
6. **detach 旧视图**：`mountPoint.removeChild(views[current].dom)`（引用仍在注册表）。
7. **init 新视图（仅首次）**：若 `!ready` → `await init(dom)`，置 `ready = true`。
8. 更新 nav `.active` / `aria-current="page"`；`current = viewId`。

> 步骤 3-6（teardown / attach / 切 link / detach）在同一同步块内完成，浏览器只在块结束后绘一次 → 无中间帧 → 无 FOUC / 无高度塌陷闪烁。步骤 7 的 init（含 storage 异步读）在视图已可见后跑，仅首次挂载有此开销。
>
> 启动首挂时 `current === null`：步骤 3（teardown）、5（移除旧 link）、6（detach 旧）需 `if (current)` 守卫跳过。

### 卸载语义（关键）

`removeChild` 把视图节点移出文档，但 `views[id].dom` 引用仍在 → **GC 不回收**。同一实例下次 `appendChild` 回来时：

- 元素及其后代的事件监听**完好**（监听绑在元素上，不随挂载状态消失）。
- `<input>` / `<textarea>` 的 value、`scrollTop`、checkbox 状态**完好**。
- → init 只需在首次跑一次；后续 mount/unmount 是纯 `appendChild`/`removeChild`，亚毫秒。

这一性质同时满足"真挂载/卸载"语义与"状态保留"，**超越**了软卸载（display toggle）与硬卸载（destroy 重建）的二分。

### 各视图 init/teardown 契约

每个视图导出：

```js
export async function init(rootEl) { /* 绑监听到 rootEl 内元素；读 storage 恢复状态 */ }
export function teardown(rootEl)    { /* 清理：退出临时态、移除 document 级监听 */ }
```

- `rootEl` = 该视图的 `.view` 容器（挂在 mount point 上的那个）。**所有 DOM 查询必须 scope 到 `rootEl`**（`rootEl.querySelector(...)`），不得用裸 `document.querySelector`，否则会查到别的视图/shell 元素。
- **init 幂等**：仅首次 mount 调一次。
- **teardown 时机**：detach 当前视图前调（用于清理 translation 的快捷键录制态等）。

#### 各视图具体改动

| 视图     | init 重构                                                                                                                                                                                                          | teardown 要点                                                                                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 主页     | `mainUtils.js` 已 export，把 `main.js` 的 `DOMContentLoaded` 链改成 `export async function init(rootEl)` 复用现有 `initializePopup`/`loadStoredData`/`setupEventListeners`，查询 scope 到 `rootEl` | 无特殊（无 document 级监听 / 定时器常驻）                                                                                                                                                                                    |
| 函数库   | `functioncall.js:20` 的 `DOMContentLoaded` 匿名体 → 包成 `export function init(rootEl)`                                                                                                                     | 无特殊                                                                                                                                                                                                                       |
| 划词翻译 | `translation.js:66` 同上重构                                                                                                                                                                                     | **必须**：若 `isRecordingOcrShortcut`/`isRecordingFavoritesShortcut` 为 true，调用对应 finish 清理 document 级 `keydown`/`keyup`（`translation.js:287-288,410-411`），否则 detach 后残留监听拦截别的视图键盘 |

> 独立文件直开时，仍由各自 `DOMContentLoaded` 调 `init(document.body)`，行为不变。

## CSS 隔离策略（切 link）

- 任一时刻，文档里只有**当前视图**的页级 CSS + 恒留的 `theme.css`。
- 因此 `translation.css` 与 `functioncall.css` 都定义 `.main-content` **不再冲突**（同时只有一个在文档里，且只有当前视图的 `.main-content` 元素在 DOM 里）。
- `theme.css` 恒留：它提供所有视图共用的变量、`html,body` 基础、header/nav 样式。**它必须在 `<head>` 最前**，页级 link 控制器插在其后。
- 不做命名空间化（已在 brainstorming 否决：冲突面仅 `.main-content` + 一个 `body padding`，不值得引入运行时切 link 之外再叠命名空间；且切 link 已天然隔离）。

### body 元素规则的迁移（必做小改动）

视图内容不再是 `<body>` 直属，而是嵌在 `#view-mount > .view` 里。原挂在 `body` 上的规则要迁移：

- `main.css:8` `body { padding: 16px }` → `.view-main { padding: 16px }`（或给 `#view-mount` 设统一 padding，按视图需要覆盖）。
- `main.css` 末尾 `html::-webkit-scrollbar, body::-webkit-scrollbar { width:0 }`（隐藏 popup 滚动条）→ 保留为 shell 级（作用于 shell html/body，popup 整体不需滚动条），可挪到 `shell.css`。
- `translation.css` / `functioncall.css` **无标签级全局选择器**（已核查），无需迁移。

## 直开与 hash 路由

- 独立文件（`functioncall.html` / `translation.html`）**保留**，作为 body DOM 的 fetch 源 + 直开调试入口（自带 `<link>` + `<script>`，独立可用）。
- shell 启动读 `location.hash`：`#translation` → 初次 mount translation；无 hash → mount main。
- nav 点击 = `location.hash = '#translation'`（或直接 `viewController.mount`），由 `hashchange` 驱动 → 浏览器前进/后退可用、URL 可分享定位视图。
- 调试用直开 URL：`.../popup/translation/translation.html` 仍开原生页；`.../popup/main/main.html#translation` 开 shell 并定位翻译视图。

## 边界与错误处理

| 场景                     | 处理                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `fetch` 视图 HTML 失败 | 控制器 catch → mount 点显示错误占位 + 控制台日志；不切`current`，nav 回退到原 active。可重试。                         |
| `init` 抛错            | catch → 不置`ready`，下次 mount 重试；视图已 attach 但功能降级（不影响其他视图）。                                     |
| translation 录制中切走   | teardown 先 finish 录制、移除 document 级 keydown/keyup，再 detach。                                                      |
| popup 高度自适应         | mount 点只含当前视图 → body 高度 = nav + 当前视图，Chrome popup 按内容自适应。mount 序列同步完成无中间帧 → 无高度塌陷。 |
| 跨视图 storage 写入冲突  | 各视图仍用现有 storage key（`LAST_MESSAGE` / `translation.settings` 等，互不重叠），无新增冲突。                      |
| `<a target>` / 外链    | nav 内不再有`<a href=同域html>`（改成 hash/按钮）；设置项保持 `<span>`+`openOptionsPage`。                          |

## 待迁移 / 新增文件清单

**新增**：

- `popup/viewSystem/viewController.js`（中间件单例）
- `popup/shell.css`（nav 容器 + `#view-mount` + 迁移自 main.css 的 scrollbar 隐藏）
- `popup/shell.js`（注册视图表 + 绑 nav + hash 路由 + 启动 mount）

**改造**：

- `popup/main/main.html` → 改为 shell 结构（head 只留 theme/shell css + shell.js；body 留 nav + `#view-mount`）。原 main body 内容移入独立可被 fetch 的源（见下）。
- `popup/main/main.js` + `mainUtils.js` → init 包成 `export async function init(rootEl)`，查询 scope 到 rootEl；`body padding` 规则迁移。
- `popup/func_execute/functioncall.js` → init 重构 export + rootEl scope。
- `popup/translation/translation.js` → init/teardown 重构（含录制态清理）+ rootEl scope。
- `popup/main/main.css` → 移除 `body` 规则迁移到 `.view-main`/`shell.css`。

**main 视图的 body 源（决策 1）**：把主页 body 内容拆到独立文件 `popup/main/mainView.html`（仅含 body 内容），shell 与其余两页一致走 fetch，三视图对称、初始化路径统一。

## 测试

- **单元（viewController）**：
  - mount 同 id 幂等（no-op）。
  - 首次 mount 取 body + 跑 init + 置 ready；二次 mount 不重跑 init。
  - 切换后旧视图 dom 从 mount 点移除但引用保留；输入值/勾选状态在切回后保留。
  - CSS link 切换：当前视图页级 link 在、其他不在；theme.css 恒在且在最前。
- **集成（三视图）**：
  - 主页：输入文字 → 切函数库 → 切回，输入还在；平台勾选保留。
  - 划词翻译：进入快捷键录制 → 不 finish 直接切走 → 回来无残留键盘拦截；录制态已重置。
  - 直开 `translation.html` 仍独立可用；`main.html#translation` 定位翻译视图。
- **回归**：popup 高度不塌陷、无 FOUC；设置项仍能打开 options。

## 不在范围

- `options/` 的 iframe 方案（已稳定，不动）。
- `sidebar/main/`（独立宿主，本设计仅覆盖 popup）。
- nav「设置」项的交互（保持 `openOptionsPage`，不纳入视图控制器）。
- 把三页 CSS 命名空间化（已选切 link，不做）。

## 已定决策

1. **main 视图的 body 源**：拆出独立 `popup/main/mainView.html`，三视图统一走 fetch。理由：对称、初始化路径统一、main 不做特例。
2. **nav 标签**：保留 `<a href="#hash">`（如 `<a href="#translation">`），由 `hashchange` 驱动 mount。理由：语义贴近"页内定位"、hash 路由白送（前进/后退、URL 定位）、`aria-current="page"` 标记当前项。
3. **生命周期事件钩子**：不做。控制器接口仅 `register` / `mount` / `getCurrent`，不暴露 `on(...)`。理由：YAGNI，当前无视图需要 mount 钩子做懒加载/埋点；需要时再加。
