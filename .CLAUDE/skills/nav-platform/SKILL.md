---
name: nav-platform
description: 当需要为 Bro Chat 扩展的某个 AI 平台（chatgpt / deepseek / yuanbao / claude / doubao / glm / grok / kimi / tongyi / googlestudio / notionai / zai / coderqwen / coze / xiaomi）接入"右侧对话快速导航"（contentScripts/nav/&lt;platform&gt;.js）时触发。也用于调试 nav 不显示、id 与 class 错配、CSS 抖动、active 高亮错乱等问题。
---

# nav-platform — AI 平台右侧对话导航接入

## 核心职责

为每个 AI 聊天平台创建 `contentScripts/nav/<platform>.js`，实现：
1. **右侧固定列**：列出该对话中所有"用户消息"作为行
2. **每行两段**：左侧 `.nav-item` 文字（fade in 显示），右侧 `.nav-line` 短线（始终可见）
3. **点击行** → 平滑滚到对应 message（smooth `scrollIntoView({ block: 'center' })`）
4. **active 跟随**：视口里可见度最高的那条 message，nav 上对应 line 加 `is-active`（变蓝色 20px）
5. **hover 锁定**：用户点击时锁 active 800ms，防止 IntersectionObserver 立即抢回高亮
6. **idle 透明**：nav 容器默认无背景无边框；hover 时浮出白底圆角
7. **尺寸自适应**：nav 容器宽度 = 内容最大宽度（用 `width: max-content` + `max-width: 360px`）

## 文件结构

```
contentScripts/
├── platform.template.js    ← 平台 content script 通用模板（不一定复用，nav 自己写）
├── chatgpt.js             ← 每个平台一个 sendMessage 注入器
├── deepseek.js
├── yuanbao.js             ← sendMessage + 注入器
└── nav/                   ← 新增：本 skill 管理的目录
    ├── yuanbao.js         ← 平台 nav（每个平台一个）
    ├── deepseek.js        ← （待添加）
    ├── ...
    └── preview.html       ← 视觉预览（独立、与 nav 模板一致）
```

```
backgroudtask/
└── platformScriptFiles.js  ← 平台 → 注入脚本列表（含 `<platform>.js` + `nav/<platform>.js`）
```

```
config/
└── platformConfig.js       ← 平台元信息（name / icon / color / url）
```

## 接入新平台的 5 步

### Step 1 — 平台是否已注册

检查 `config/platformConfig.js` PLATFORM_CONFIG：

```js
{ yourplatform: { name: 'X', icon: 'X', color: '#...', url: 'https://...', defaultVisible: true } }
```

如果未注册，添加 entry（必填 name / icon / url / defaultVisible）。

### Step 2 — 注册 nav 脚本注入

打开 `backgroudtask/platformScriptFiles.js`，在 `if (platform === "<platform>")` 分支返回：

```js
return ["contentScripts/<platform>.js", "contentScripts/nav/<platform>.js"];
```

**为什么需要 nav script？** yuanbao 测试结论：`content_scripts.executeScript` 注入顺序是按数组顺序，`<platform>.js` 先注入完成（建立 sendMessage listener），`nav/<platform>.js` 后注入（建立 UI overlay）。

### Step 3 — 选择器探查（CDP /web-access 必跑）

在 CDP 中打开目标平台 tab，跑 eval 探测：

```js
document.querySelectorAll('.user-message-selector').length
document.querySelector('.user-message-selector .text-selector')?.innerText
document.getElementById('send-btn')?.getBoundingClientRect()
```

**必查三个值**：
- **用户消息项**：`.xxx`（每条用户消息的容器）
- **消息文本节点**：`.yyy`（人类文本子元素，决定 nav-item 显示什么文本）
- **消息列表容器**：`.zzz`（MutationObserver 要 observe 的父容器）

如果是 CDP 主动询问，告诉用户「仅读取 DOM，不点击/不输入，避免账号封禁风险」再继续。

### Step 4 — 写 contentScripts/nav/<platform>.js

参考 [`yuanbao.js`](../../bro_chat/contentScripts/nav/yuanbao.js) 的 IIFE 模板：

```js
const NAV_ID = '<platform>-right-edges-nav';
const ITEM_SEL = '.xxx';   // 用户消息项选择器
const LIST_SEL = '.yyy';   // 消息列表父容器
const TEXT_SEL = '.zzz';   // 消息文本子元素

(function () {
  if (document.getElementById(NAV_ID)) return;

  // 1. 注入 CSS（复制 preview.html 视觉，class 用 `.{NAV_ID}` 而非 `#{id}`）
  const STYLE_ID = NAV_ID + '-style';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `... CSS ...`;  // 见下方 CSS 模板
    document.head.appendChild(style);
  }

  // 2. 创建 nav 容器
  const nav = document.createElement('div');
  nav.id = NAV_ID;
  nav.className = NAV_ID;     // ★ 关键：必须设 className，否则 CSS 不匹配
  document.body.appendChild(nav);

  // 3. 数据结构（保留 message → row 映射）
  const messageRows = []; // [{ el, row, line }]
  let clickLockUntil = 0;

  function setActiveLine(activeIndex) {
    messageRows.forEach((rec, i) => {
      rec.line.classList.toggle('is-active', i === activeIndex);
    });
  }

  function build() {
    nav.innerHTML = '';
    messageRows.length = 0;

    document.querySelectorAll(ITEM_SEL).forEach((el, idx) => {
      const text = el.querySelector(TEXT_SEL)?.innerText?.trim();
      if (!text) return;

      const row = document.createElement('div');
      row.className = `${NAV_ID}-row`;

      const item = document.createElement('span');
      item.className = `${NAV_ID}-item`;
      item.textContent = text;

      const line = document.createElement('span');
      line.className = `${NAV_ID}-line`;

      messageRows.push({ el, row, line });

      row.addEventListener('click', () => {
        setActiveLine(idx);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        clickLockUntil = Date.now() + 800;  // 800ms 内不抢高亮
      });

      row.appendChild(item);
      row.appendChild(line);
      nav.appendChild(row);
    });

    if (messageRows.length > 0) {
      // 默认 active 标记最后一条（最新用户消息）
      setActiveLine(messageRows.length - 1);
      observeMessagesInViewport();
      window.addEventListener('scroll', () => {
        clickLockUntil = 0;  // 手动滚动解除锁
        evaluateActiveByViewport();
      }, { passive: true });
    }
  }

  // IntersectionObserver：视口里可见度最高的那条 message 自动 active
  function observeMessagesInViewport() {
    if (!('IntersectionObserver' in window)) return;
    const obs = new IntersectionObserver(
      () => evaluateActiveByViewport(),
      { root: null, rootMargin: '-30% 0px -30% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] }
    );
    messageRows.forEach(rec => obs.observe(rec.el));
  }

  function evaluateActiveByViewport() {
    if (Date.now() < clickLockUntil) return;  // 用户点击期间不抢
    if (messageRows.length === 0) return;

    let bestIndex = -1, bestRatio = 0;
    messageRows.forEach((rec, i) => {
      const rect = rec.el.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const visible = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
      const ratio = visible / Math.max(rect.height, 1);
      if (ratio > bestRatio) { bestRatio = ratio; bestIndex = i; }
    });

    if (bestIndex < 0 || bestRatio < 0.3) return;
    setActiveLine(bestIndex);
  }

  // 启动：观察消息列表（DOM 变化时重建）
  const list = document.querySelector(LIST_SEL);
  if (list) {
    new MutationObserver(build).observe(list, { childList: true, subtree: true });
    build();
  } else {
    // 列表还没出现：重试 30 次 × 300ms = 9s
    let retries = 0;
    const retry = setInterval(() => {
      const l = document.querySelector(LIST_SEL);
      if (l) {
        clearInterval(retry);
        new MutationObserver(build).observe(l, { childList: true, subtree: true });
        build();
      } else if (++retries > 30) clearInterval(retry);
    }, 300);
  }
})();
```

### Step 5 — CSS 模板（嵌入 style.textContent）

```css
:root {
  --<prefix>-text: #0f1115;
  --<prefix>-text-idle: rgba(15,17,21,0.55);
  --<prefix>-bg: #ffffff;
  --<prefix>-bubble-bg: #edf3fe;
  --<prefix>-border: rgba(15,17,21,0.06);
  --<prefix>-line-color: rgba(15,17,21,0.35);
  --<prefix>-line-active: rgba(0, 60, 179, 0.82);
}

/* container */
.{NAV_ID} {
  position: fixed; right: 20px; top: 50%; transform: translateY(-50%);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 0;
  box-shadow: 0 1px 2px transparent, 0 1px 3px transparent;
  padding: 16px 0;
  width: 28px;
  transition: width 0.3s ease, background 0.3s ease,
              border-color 0.3s ease, box-shadow 0.3s ease;
  overflow: hidden;
  display: flex; flex-direction: column; align-items: flex-end;
  gap: 10px;
  z-index: 2147483647;
}
.{NAV_ID}:hover {
  width: max-content; max-width: 360px;
  background: var(--<prefix>-bg);
  border-color: var(--<prefix>-border);
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(15,17,21,0.06), 0 1px 3px rgba(15,17,21,0.1);
}

/* row */
.{NAV_ID}-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px 6px 14px;
  color: var(--<prefix>-text-idle);
  transition: color 0.2s ease;
}
.{NAV_ID}-row:hover { color: var(--<prefix>-text); }

/* line */
.{NAV_ID}-line {
  display: block; width: 12px; height: 4px;
  background: var(--<prefix>-line-color);
  border-radius: 2px; flex-shrink: 0;
  transition: width 0.3s ease, background 0.2s ease;
}
.{NAV_ID}-line.is-active {
  width: 20px;
  background: var(--<prefix>-line-active);
}
.{NAV_ID}-row:hover .{NAV_ID}-line { background: rgba(15,17,21,0.7); }
.{NAV_ID}-row:hover .{NAV_ID}-line.is-active { background: rgba(0, 50, 160, 0.95); }

/* item */
.{NAV_ID}-item {
  font-size: 13px; line-height: 18px;
  color: var(--<prefix>-text);
  white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
  max-width: 0; opacity: 0;
  transform: translateX(4px);
  transition: opacity 0.8s ease, transform 0.8s ease, max-width 0.8s ease;
}
.{NAV_ID}:hover .{NAV_ID}-item {
  max-width: 320px; opacity: 1; transform: translateX(0);
}
```

## 验证流程（CDP /web-access）

### 1. 注入脚本
```bash
node ~/.claude/skills/web-access/scripts/check-deps.mjs   # 启动 proxy
SCRIPT=$(cat "D:/DevProjects/my/bro_chat/contentScripts/nav/<platform>.js")
curl -X POST "http://localhost:3456/eval?target=<id>" --data-binary "$SCRIPT"
```

### 2. 状态检查
```js
const nav = document.getElementById('<platform>-right-edges-nav');
const cs = getComputedStyle(nav);
JSON.stringify({
  hasNav: !!nav,
  className: nav.className,                 // 必填！否则 CSS 不匹配
  childCount: nav.children.length,
  position: cs.position,                     // 期望 'fixed'
  right: cs.right,                           // 期望 '20px'
  width: cs.width,                           // idle=28px, hover 自动 width
  zIndex: cs.zIndex                          // 期望 2147483647
})
```

### 3. Active 切换测试
```js
const rows = document.querySelectorAll('.<NAV_ID>-row');
rows[0].click();                              // 点击第一行
const lines = Array.from(document.querySelectorAll('.<NAV_ID>-line'));
JSON.stringify({
  activeIdx: lines.findIndex(l => l.classList.contains('is-active')),  // 应为 0
  widths: lines.map(l => getComputedStyle(l).width)  // [20px, 12px, 12px, ...]
})
```

## 错误案例（高频坑点）

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| `<div id="x">` 但 CSS 用 `.x {}` 选择器 | nav 不显示，computed style 是默认 static（width 撑成父容器全宽 1707px） | 创建元素时同时设 `id="x"` 和 `className="x"`，或用 `#x` CSS 选择器（id 选择器） |
| 把 `<span>.nav-line { width:12px; height:4px }` 但元素是 `<span>` 默认 inline | width/height 不生效，line 渲染 0×0 | 给 span 加 `display: block`，或用 `<div>` |
| `border: 0 → border: 1px solid var(...)` hover 切换 | 0.5px anti-alias 中间帧显示深色边再变浅，"先深后浅" 抖动 | `border: 1px solid transparent → border-color: var(...)` 切颜色不变宽度 |
| `display: none → inline` 切换 | 不能 transition；item 瞬间跳出现/消失 | `max-width: 0 → 320` + `opacity: 0 → 1`，border-collapse、display 保留 inline |
| `position: absolute` 给多 nav-line 锁在同一 right:4px | 所有 line 重叠堆一点只显示 1 个 | 不用 absolute；用 flex row-reverse 让 line 自然右对齐，或 `.nav` 父容器 `align-items: flex-end` |
| `justify-content: flex-start → flex-end` 切 hover | line 位置会从左"跑到"右（飞行动画） | 用 `align-items` 静态对齐，配合 line 在 DOM 顺序的最后位置 |
| 点击后 700ms 设新 active | 用户感知不到点击效果就被 IntersectionObserver 抢走 | `clickLockUntil = Date.now() + 800`，evaluateActiveByViewport 检查锁 |
| inline `<style>` 文本过长 | Chrome Content Security Policy 限制，单 style textContent 太大可能截断 | 把 CSS 拆 `<style>` 多个 or 在 manifest `web_accessible_resources` 暴露独立 CSS 文件 |
| script 注入时 `display: none → inline` 写在 hover rule 里但 `display: none` 是默认 | 即使 hover fail，CSS 也无效；CSS 只在元素当前 display 上 transition | 用 opacity + visibility + transform 替代 |
| 假设 `<button>` selector 包含 `<a>` 元素 | yuanbao 实际 send-btn 是 `<a id="yuanbao-send-btn">`，不是 button | 在 selector 中同时尝试 button/a；用 `.send-btn` 类名兜底 |
| IntersectionObserver `rootMargin: '-30% 0px -30% 0px'` 太小（中部只 40%） | 一条 message 不足以 30% 视口覆盖，active 卡在中间 | 调小 `-X% 0px -X% 0px`，X=20% |
| CDP 截图截到一半 hover 又结束 | 看截图实际不是 hover 终态 | 不要相信截图；用 DOM 数值（computed style、getBoundingClientRect）验证 |
| 给 yuanbao.js 加 `InputEvent` 优化时改了 `triggerInputEvents` | 改变了原有 sendMessage 行为，可能导致原有 send 失效 | 优化 sendMessage 时用独立函数，不要改原有 helper |
| 用 `position: fixed` 但 `right: 20px` + 父元素 `transform: translateY(-50%)` 干扰 | fixed 元素被 transform 父元素影响时，fixed 定位锚点改变 | fixed 元素不应该在 transform 父元素里；如必须，把 fixed 元素挂到 body |
| `transition: width 0.5s cubic-bezier(0.22, 1, 0.36, 1)` 太弹 | 容器展开有"弹一下"的回弹感 | 改 `width 0.4s ease` 简单线性 |
| `<style>` 没有去重，重复加载多次 | 后加载的覆盖前面；CSS specificity 错乱 | 注入前 `if (!document.getElementById(STYLE_ID))` |

## 相关命令

| 命令 | 作用 |
|------|------|
| `node ~/.claude/skills/web-access/scripts/check-deps.mjs` | 启动 CDP proxy |
| `curl -s http://localhost:3456/targets` | 列出所有 tab |
| `curl -X POST "http://localhost:3456/eval?target=<id>" -d 'js_code'` | 在指定 tab 跑 JS |
| `curl "http://localhost:3456/screenshot?target=<id>&file=<path>"` | 截图（hover 状态难截，建议用 DOM 数值） |
| `cd "D:/DevProjects/my/bro_chat" && git status --short` | 检查未提交变更 |
| `git add ... && git commit -m "..."` | 提交（约定：commit 不 push） |

## 接入清单（每个平台）

```
[ ] 1. config/platformConfig.js 是否有 <platform> entry
[ ] 2. backgroudtask/platformScriptFiles.js 是否有 <platform> 分支（含 nav/<platform>.js）
[ ] 3. CDP 探查：用户消息项、文本节点、消息列表容器
[ ] 4. contentScripts/nav/<platform>.js：IIFE + className + CSS 注入 + MutationObserver + IntersectionObserver + clickLock
[ ] 5. CDP 验证：computedStyle position:fixed right:20px + childCount > 0 + 点击切换 is-active
[ ] 6. git add + git commit "feat(nav): add <platform> right-edges nav"（不 push）
```

## 调试清单

- [ ] nav 容器在 DOM 中存在（`!!document.getElementById(...)`）
- [ ] nav 元素 **同时有 `id` 和 `className`**（CSS 用 .className 选择器）
- [ ] `<style id="<STYLE_ID>">` 存在且包含完整 CSS
- [ ] computed style: `position: fixed; right: 20px; z-index: 2147483647`
- [ ] `width` 严格等于 28px（idle 状态）
- [ ] `<span class="nav-line">` 元素的 `display` 计算值是 `block`（不是 `inline`）
- [ ] `width` 计算值是 12px（未激活）或 20px（已激活）
- [ ] `is-active` 类切换时 width 跟随 transition
- [ ] 点击 row 触发 smooth scroll（视口变化）
- [ ] 800ms 后 active 转移给视口里可见度最高的那条 message
- [ ] 用户手动 scroll 解除 clickLock

## 跨平台选择器参考（已验证）

| 平台 | user-message-item | text-node | list container | send button |
|------|-------------------|-----------|----------------|-------------|
| 元宝 | `.agent-chat__list__item--human` | `.hyc-content-text` | `.agent-chat__list` | `#yuanbao-send-btn`（`<a>`） |
| DeepSeek | 用户消息列表项 | 文本子节点 | 滚动区 | send button |
| ChatGPT | 消息列表项 | 文本节点 | 滚动容器 | send button |
| Claude | 消息列表项 | 文本节点 | 滚动容器 | send button |

新增平台时，先 CDP 跑 `document.querySelectorAll('.human-message-class').length` + `el.querySelector('.text-class')?.innerText` 验证。
