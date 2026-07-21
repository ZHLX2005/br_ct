# Nav 统一视图组件设计

## 背景

`contentScripts/nav/core.js` 已经把各平台重复的导航 lifecycle 收敛到共享实现，`contentScripts/nav/platforms/*.js` 主要提供平台 DOM 选择器。但是，`core.js` 仍同时承担平台消息控制器与视图渲染器两类职责：

- 注入完整 CSS template；
- 创建 nav、row、item、line DOM；
- 查询平台消息、提取文本；
- 管理滚动、active 状态和 Observer lifecycle。

同时，`contentScripts/nav/preview.html` 保存另一份相似但独立维护的视觉和 DOM 模板。它不参与运行时加载，修改 preview 不会影响真实 nav，修改 core 也不会同步 preview，存在双份模板漂移风险。

本次重构把运行时 nav 的视觉和 DOM 抽离成唯一共享组件，并删除离线 preview。平台 adapter 最终只负责数据驱动。

## 目标

1. 以单一运行时组件作为 nav CSS 和 DOM 的唯一来源。
2. 将共享视图与平台消息 lifecycle 分离。
3. 将平台 adapter 压缩为选择器和可选文本提取 hook。
4. 保持现有导航视觉、点击滚动、active 跟随和 SPA 重绑行为。
5. 删除不再需要的 `preview.html`，彻底消除双份模板。
6. 修复空文本消息可能造成的 nav row index 与原始 DOM index 不一致问题。

## 非目标

本次不实现：

- 新的 nav 视觉方案；
- dark mode；
- 平台级主题色；
- 可配置的可见度阈值、动画时间或尺寸；
- 新平台接入或现有平台选择器校准；
- 新增完整前端测试框架。

本次同时纳入当前工作区已经完成的 nav 注入链路调整：nav 由 manifest 的 `content_scripts` 常驻注入 `contentScripts/nav/entry.js`，不依赖 background service worker 是否活跃。background 的 `platformScriptFiles.js` 只负责 sendMessage 注入器；`entry.js` 自己读取 nav 开关并动态加载共享模块。

## 架构

```text
manifest.json
    │ document_idle 常驻注入
    ▼
contentScripts/nav/entry.js
    │ URL -> platformId；读取 hasNav + platformNavSettings
    │ dynamic import adapter + core
    ▼
contentScripts/nav/platforms/<platform>.js
    │ { itemSel, listSel, textSel, extractText? }
    ▼
contentScripts/nav/core.js -----------------> contentScripts/nav/view.js
    │ 平台消息查询与文本提取                    │ 唯一 CSS template
    │ Mutation/IntersectionObserver            │ 唯一 nav DOM template
    │ active 计算、clickLock、scroll           │ render / clear / setActive
    +------------------------------------------+

background.js -> backgroudtask/ai_platform_processor.js
                 -> contentScripts/<platform>.js
                 （仅 sendMessage 注入器，不负责 nav）
```

### Manifest 常驻注入链路

`manifest.json` 的 nav `content_scripts` 段按平台域名在 `document_idle` 常驻注入 `contentScripts/nav/entry.js`。这样 nav 不依赖 background service worker 的启动时机。`entry.js` 自己读取 `PLATFORM_CONFIG.hasNav` 和 `chrome.storage.local.platformNavSettings`，关闭的平台在入口处直接退出。

`backgroudtask/platformScriptFiles.js` 只返回 `contentScripts/<platform>.js`，供 sendMessage 链路使用；它不再返回 nav entry，也不再维护 nav settings cache。`core.js`、`view.js` 和平台 adapter 由 `entry.js` 通过 dynamic import 加载，仍然不作为 classic scripts 直接注册。

### `entry.js`

继续负责：

- URL 到 `platformId` 的路由；
- `hasNav` 与用户 nav 开关判断；
- 动态加载平台 adapter 和 core；
- 调用 `createNav(platformCfg)`。

本次不改变其外部行为。

### `platforms/*.js`

每个平台 adapter 只导出：

```js
export default {
  itemSel: '...',
  listSel: '...',
  textSel: '...' || null,
  extractText: optionalFunction,
};
```

删除：

- `navId`：页面上只挂载一个统一 nav，不需要平台专属 DOM ID 或 CSS prefix；
- `activeColor`：所有平台使用统一蓝色 active line。

adapter 不创建 DOM、不注入 CSS、不管理 Observer，也不知道 view 接口。

### `view.js`

新增共享视图组件，独占以下职责：

- 注入唯一 nav CSS；
- 创建唯一 nav 容器；
- 创建 row/item/line DOM；
- 根据文本数组重建 rows；
- 根据 index 切换 active line；
- 清空 rows；
- 将 row 点击转换为紧凑 index 回调。

建议导出一个视图工厂：

```js
createNavView({ onSelect }) -> {
  render(labels),
  setActive(index),
  clear(),
}
```

组件使用固定且扩展专属的命名空间，例如：

```text
#bro-chat-right-edges-nav
#bro-chat-right-edges-nav-style
.bro-chat-nav__row
.bro-chat-nav__item
.bro-chat-nav__line
```

CSS 变量若保留，应定义在 nav 容器本身，而不是 `:root`，避免污染宿主页面或被宿主页面同名变量覆盖。所有平台使用同一 active 蓝色。

视图组件不查询宿主平台消息 DOM，也不执行 `scrollIntoView`。

### `core.js`

`core.js` 变为控制器，继续负责：

- 校验 adapter 配置；
- 查询 `itemSel`；
- 通过 `extractText`、`textSel` 或 `innerText` 提取消息摘要；
- 保存 `records = [{ el, text }]`；
- MutationObserver 和 shell observer lifecycle；
- IntersectionObserver 与可见度计算；
- 800ms click lock；
- `scrollIntoView({ behavior: 'smooth', block: 'center' })`；
- 驱动 view 的 `render`、`setActive` 和 `clear`。

`core.js` 不再包含 CSS template，也不再直接创建 nav row/item/line。

## 数据流

### 初始挂载和 DOM 重建

1. `entry.js` 根据 URL 加载平台 adapter 和 core。
2. core 校验 `itemSel` 与 `listSel`。
3. core 创建共享 view。
4. core 查询平台用户消息 DOM。
5. core 提取并过滤空文本，生成紧凑 `records`。
6. core 调用 `view.render(records.map(record => record.text))`。
7. view 为每个 label 创建统一 row/item/line。
8. core 默认将最后一个有效 record 设为 active，并开始观察这些 record 对应的消息元素。

先生成紧凑 `records` 再渲染，可以保证 view 点击回传的 index 始终与 `records[index]` 对应。不能继续使用原始 `querySelectorAll` 的 index，因为空文本消息被跳过后会造成索引错位。

### 用户点击

1. view 将 row 点击回传为紧凑 index。
2. core 查找 `records[index]`。
3. 若 record 仍存在，core 立即调用 `view.setActive(index)`。
4. core 对 `record.el` 执行 smooth scroll。
5. core 设置 800ms click lock，防止 IntersectionObserver 立刻覆盖用户选择。

### Active 跟随

1. IntersectionObserver 或 window scroll 触发可见度评估。
2. core 在 `records` 中计算可见比例最高的消息。
3. 最高比例达到 30% 时，core 调用 `view.setActive(bestIndex)`。
4. 若没有消息达到阈值，保留当前 active。

## 视觉兼容要求

重构不改变现有运行时视觉：

- `position: fixed`；
- `right: 20px`；
- 垂直居中；
- idle 宽度 `28px`；
- hover 使用 `width: max-content`，最大宽度 `360px`；
- line idle 为 `12px × 4px`；
- active line 宽度 `20px`；
- item 从 `max-width: 0`、`opacity: 0` 过渡到可见；
- 白色 hover 背景、12px 圆角和现有弱阴影；
- `z-index: 2147483647`；
- 所有平台使用统一 active 蓝色。

## Lifecycle 与资源管理

保留现有已修复的 lifecycle 语义：

- build 前 disconnect 旧 IntersectionObserver；
- window scroll listener 只注册一次；
- MutationObserver mutation 通过 60ms debounce 合并；
- SPA 替换 list 节点时 disconnect 旧 list observer 并重新绑定；
- list 暂时消失时清空 `records` 和 view；
- document body shell observer 用于捕获整个 chat 子树替换；
- 启动时 list 未出现，最多轮询 30 次，每次 300ms。

`view.render()` 只替换 row 内容，不重复创建 style 或容器。重复执行入口时，通过固定 nav ID 防重入。

## 错误处理

- 缺少 `itemSel` 或 `listSel`：输出一次警告并停止，不创建半成品 nav。
- `extractText` 未返回文本：继续尝试 `textSel`，再 fallback 到 `el.innerText`。
- 空文本：不进入 `records`，不生成 nav row。
- 点击 index 越界或 record 不存在：静默忽略，避免 SPA mutation 期间抛错。
- `IntersectionObserver` 不可用：保留点击滚动和 window scroll fallback，不创建 observer。
- dynamic import 失败：沿用 `entry.js` 当前 warning 和单平台隔离行为。

## 文件变更

```text
backgroudtask/
├── ai_platform_processor.js      保持 sendMessage tab 注入链路
└── platformScriptFiles.js        只返回 sendMessage 注入器

manifest.json                    保留/确认 nav 常驻 content_scripts + WAR

contentScripts/nav/
├── core.js                      修改：只保留控制器和 lifecycle
├── entry.js                     保留 URL 路由、开关读取和 dynamic import
├── view.js                      新增：唯一 CSS + DOM 组件
├── preview.html                 删除
└── platforms/*.js              修改：删除 navId 和 activeColor
```

Manifest 的 WAR 必须覆盖 `entry.js` 动态加载的 `config/platformConfig.js`、`contentScripts/nav/core.js`、`contentScripts/nav/view.js` 和 `contentScripts/nav/platforms/*.js`。实现阶段必须在真实扩展环境验证解析后的 extension URLs。

同时更新仓库中的 nav-platform skill 文档，移除“复制 preview.html CSS”与旧 adapter schema，改为引用统一 view 组件。此文档位于仓库内 `.CLAUDE/skills/nav-platform/SKILL.md`，属于当前架构说明的一部分，不能继续指导维护者复制旧模板。

## 验证策略

仓库当前没有 `package.json` 或 nav 自动测试框架，因此本次不引入独立测试工具链。验证分为静态检查和浏览器 smoke check。

### 静态检查

- `preview.html` 已删除；
- 所有 `platforms/*.js` 不再包含 `navId` 和 `activeColor`；
- `core.js` 不再包含 CSS template；
- `core.js` 不再直接创建 row/item/line；
- `view.js` 是 CSS 和 nav DOM 的唯一来源；
- adapter 必填字段仍完整；
- manifest nav `content_scripts` 段包含所有支持平台域名和唯一 `entry.js`；
- `platformScriptFiles.js` 只返回 sendMessage 注入器，不维护 nav cache；
- `entry.js` 的 adapter/core/view dynamic import 链在扩展环境可用；
- 仓库 skill 文档不再要求复制 preview CSS。

### 浏览器 smoke check

至少验证：

1. 一个普通列表平台，例如 Yuanbao；
2. 一个 virtual-list 或特殊文本 hook 平台，例如 DeepSeek、Doubao 或 Xiaomi。

每个平台检查：

- nav 容器存在且页面中只有一个；
- computed style 保持 fixed、right 20px、idle width 28px；
- row 数量等于有效用户消息数量；
- line 计算尺寸为 idle 12px 或 active 20px；
- 点击首条、中间条和末条均滚动到正确消息；
- 空文本不会造成后续点击索引错位；
- active 随视口变化；
- SPA 切换对话后 rows 正确重建；
- 多次 mutation 不产生重复 nav 或重复 rows；
- hover 视觉与重构前一致。

如果没有可用的已登录会话，必须明确报告浏览器验证未执行，不得将静态检查表述为运行时验证通过。

## 验收标准

- 运行时只有一份 CSS 和 DOM 模板，位于共享 view 组件；
- `preview.html` 不再存在；
- 平台 adapter 只包含平台数据与可选文本提取 hook；
- manifest nav `content_scripts` 段包含所有支持平台域名和唯一 `entry.js`；
- `platformScriptFiles.js` 只返回 sendMessage 注入器，不维护 nav cache；
- 现有 nav 视觉和行为无回归；
- 空文本过滤后点击映射仍准确；
- SPA 切换和 virtual-list mutation 的资源管理保持正确；
- nav-platform skill 文档与新架构一致。
