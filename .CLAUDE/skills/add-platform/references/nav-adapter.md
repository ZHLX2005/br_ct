---
name: nav-adapter
description: Nav adapter 接入规范。每个 AI 平台一个 adapter（contentScripts/nav/platforms/<id>.js），只提供 selector 配置，由 core/index.js 统一驱动 observer/scroll/active。
---

# Nav Adapter 接入规范

> 每个平台一个文件：`contentScripts/nav/platforms/{platformId}.js`，文件名**必须等于** `PLATFORM_CONFIG` 的 key。
>
> adapter 是**纯配置对象**，被 `core/index.js` 解构后驱动。所有副作用、observer、scroll、active 计算都不在 adapter 内。

## 完整接入流程

### 1. 声明 nav 支持（config/platformConfig.js）

```js
yourplatform: {
  name: 'YourPlatform',
  icon: 'Y',
  shortIcon: 'Y',
  color: '#ff0000',
  url: 'https://www.example.com/chat/',
  defaultVisible: true,
  hasNav: true,    // ← 新平台默认就是 true，可省略
},
```

`hasNav: false` 的语义：
- `entry.js` 跳过 mount
- `options/platform/platform.js` 不渲染"导航"复选框

### 2. 注册 manifest match（manifest.json）

`manifest.json` 第二段 `content_scripts` 的 `matches` 加入域名：

```json
{
  "matches": [
    "*://yuanbao.tencent.com/*",
    "*://www.example.com/*"   ← 新增
  ],
  "js": ["contentScripts/nav/entry.js"],
  "run_at": "document_idle",
  "all_frames": false
}
```

**域名精确陷阱**（基于 manifest.json 现有 matches）：

| 平台 | 真实用户访问域 | manifest 写法 |
|---|---|---|
| NotionAI | `app.notion.com` | `*://app.notion.com/*`（**不是** `*://notion.so/*`） |
| 豆包 | `www.doubao.com` | `*://www.doubao.com/*` |
| 元宝 | `yuanbao.tencent.com` | `*://yuanbao.tencent.com/*` |

`*://example.com/*` **不匹配** `www.example.com`。如需匹配所有子域，写 `*://*.example.com/*`。

### 3. 探查 DOM 找选择器

打开目标平台的聊天页面，确保有至少一条用户消息。使用 DevTools Console 跑命令验证。

#### 3a. 用户消息元素（itemSel）

```javascript
// 验证候选 selector 只命中用户消息
const sel = '.candidate-item-sel';
Array.from(document.querySelectorAll(sel)).map(el => ({
  tag: el.tagName,
  text: el.innerText?.trim().slice(0, 40),
}))
// 期望：所有元素都是 user message，text 非空且不重复
```

**优先级**（按稳定性排序）：

| 方式 | 稳定性 | 真实案例 |
|---|---|---|
| `data-testid` / 唯一 `data-*` 属性 | 高 | Grok `[data-testid="user-message"]`、NotionAI `[data-agent-chat-user-step-id]` |
| `role="article"` 语义属性 | 中 | Copilot `[id$="-user-message"]` |
| 稳定 class（无 hash） | 中 | Yuanbao `.agent-chat__list__item--human`、Tongyi `.chat-question-card-wrap` |
| 自定义 tag | 中 | Gemini `user-query` |
| hash class（每次构建变） | 低 | 避免依赖 |

> 💡 多 selector fallback：CSS 选择器本身支持多候选（逗号分隔），如 `[data-role="user"], .user-message, .chat-message--user` —— 见 `coze.js`、`coderqwen.js`。

#### 3b. 消息列表容器（listSel）

```javascript
// 从用户消息沿祖先链找 overflow-y:auto/scroll 的容器
const el = document.querySelector('.item-sel');
let p = el.parentElement;
for (let i = 0; i < 20 && p; i++) {
  const oy = getComputedStyle(p).overflowY;
  if (oy === 'auto' || oy === 'scroll') {
    console.log(i, p.tagName, p.className?.slice(0, 60), p.scrollHeight - p.clientHeight);
    // 期望：scrollHeight > clientHeight（真有内容可滚）
    break;
  }
  p = p.parentElement;
}
```

**确认 listSel 命中所有消息**：

```javascript
document.querySelector('.list-sel').querySelectorAll('.item-sel').length
// 期望：等于用户消息总数
```

`listSel` 必须存在，否则 nav boot 30×300ms 后放弃（见 `core/index.js` `RETRY_MAX`）。

#### 3c. 消息文本节点（textSel）

```javascript
document.querySelector('.item-sel')?.innerText?.trim().slice(0, 60)
document.querySelector('.item-sel .text-sel')?.innerText?.slice(0, 60)
```

**三种情况**：

| 情况 | textSel 取值 |
|---|---|
| 文本直接在 item 元素 innerText 中 | `textSel: null`（用 `el.innerText`） |
| 文本在 item 的子节点 | `textSel: '.text-sel'` |
| 文本包含 sr-only 标签前缀或特殊结构 | 用 `extractText` hook（见 3d） |

#### 3d. 图片/附件消息 fallback（extractText）

很多平台用户消息可能是纯图片，纯靠 `innerText` 拿不到任何内容。`extractText` 是 fallback hook：

```javascript
extractText: (el) => {
  // 1. textSel 优先（多数情况）
  const textNode = el.querySelector('.text-sel');
  const text = textNode?.innerText?.trim();
  if (text) return text;

  // 2. 元素自身 innerText
  const own = el.innerText?.trim();
  if (own) return own;

  // 3. 图片/附件兜底：用 item 上或子节点的 data-id 推一个可显示标签
  const id =
    el.getAttribute('data-message-id') ||
    el.querySelector('[data-message-id]')?.getAttribute('data-message-id');
  if (id) return `🖼️ (img-${id.slice(-6)})`;

  return undefined;  // falsy → collector 跳过这条 + skippedCount++
}
```

**extractText 返回 falsy 时**：
- collector 跳过该消息，`skippedCount++`
- `skippedCount` 会被 `export.js` 写入 frontmatter
- 不影响其他消息的 nav row

**extractText 优先级**（与 collector 配合，见 `core/collector.js`）：

```
extractText → textSel → el.innerText → 跳过
```

### 4. 创建 adapter 文件

文件路径：`contentScripts/nav/platforms/{platformId}.js`

**模板 1：标准型（itemSel + textSel + extractText fallback）**

```javascript
/**
 * 平台名 (example.com) 平台 nav 配置
 *
 * 选择器：
 * - ITEM_SEL: ...
 * - LIST_SEL: ...
 * - TEXT_SEL: ...
 *
 * 备注：（为什么这样选）
 */

const IMAGE_FALLBACK_PREFIX = '🖼️ ';

export default {
  itemSel: '...',
  listSel: '...',
  textSel: '...',
  extractText: (el) => {
    // 1. textSel 优先
    const textNode = el.querySelector('...');
    if (textNode?.innerText?.trim()) return textNode.innerText.trim();

    // 2. el 自身 innerText
    const own = el.innerText?.trim();
    if (own) return own;

    // 3. 图片/附件兜底
    const id = el.getAttribute('data-message-id') || ...;
    if (id) return `${IMAGE_FALLBACK_PREFIX}(img-${id.slice(-6)})`;

    return undefined;
  },
};
```

**模板 2：自定义 tag（Gemini）**

```javascript
export default {
  itemSel: 'user-query',                      // 自定义元素 tag
  listSel: 'infinite-scroller.chat-history',
  textSel: null,
};
```

**模板 3：剥前缀（Copilot）**

```javascript
export default {
  itemSel: '[id$="-user-message"]',
  listSel: '[class*="container/chat"]',
  textSel: null,
  extractText: (el) => {
    // innerText 包含 "你说\n1111"——剥首行 sr-only 标签
    const text = el.innerText?.trim();
    if (!text) return undefined;
    const lines = text.split('\n');
    if (lines.length > 1) {
      const body = lines.slice(1).join('\n').trim();
      if (body) return body;
    }
    return text;
  },
};
```

**模板 4：多 selector 候选（CoderQwen / Coze）**

```javascript
export default {
  itemSel: '[data-cq-user-message], .cq-message--user, .user-message',
  listSel: '[data-cq-message-list], .cq-message-list, main',
  textSel: '[data-cq-message-text], .cq-message-content, .message-text',
};
```

**模板 5：virtual list（豆包 / DeepSeek）**

```javascript
// 豆包：用 :has(...) 把 user / assistant 行区分开
export default {
  itemSel: '.v_list_row[data-observe-row]:has([data-foundation-type="send-message-action-bar"])',
  listSel: '[class^="message-list-"]',
  textSel: null,
  extractText: (el) => {
    const text = el.innerText?.trim();
    if (text) return text;
    const msgId = el.querySelector('[data-message-id]')?.getAttribute('data-message-id');
    if (msgId) return `🖼️ (img-${msgId.slice(-6)})`;
    return undefined;
  },
};

// DeepSeek：直接排除 .ds-markdown 行
export default {
  itemSel: 'div.ds-message:not(:has(.ds-markdown))',
  listSel: '.ds-virtual-list--printable',
  textSel: '.ds-message .ds-markdown',
  extractText: (el) => {
    return (
      el.querySelector('.ds-message-content, [class*="content"], p')?.innerText?.trim() ||
      el.innerText?.trim()
    );
  },
};
```

### 5. 验证

扩展 reload + F5 → 在目标平台页面 DevTools Console 跑：

```javascript
JSON.stringify({
  nav: document.getElementById('bro-chat-right-edges-nav') !== null,
  rows: document.querySelectorAll('.bro-chat-nav__row').length,
})
// 期望：nav: true，rows 等于页面中用户消息数
```

逐项验证：

```javascript
// itemSel 数量
document.querySelectorAll('<itemSel>').length

// listSel 存在
!!document.querySelector('<listSel>')

// adapter import 正常
import('/contentScripts/nav/platforms/<id>.js').then(m => console.log(m.default))
```

## 常见陷阱

| 现象 | 根因 | 修复 |
|---|---|---|
| `rows: 0` 但 `listSel` 存在 | `itemSel` 没命中 | 改 selector |
| `rows` 数量 = 实际消息 × 2 | itemSel 同时命中 user + assistant | 加 `:not(.assistant)` 或属性限定 |
| `rows` 数量稳定但过少 | virtual list 限制 DOM 范围（仅视口附近） | **非 bug**，用户滚到才会出现 |
| adapter 报错 "缺少必要参数" | 漏 `itemSel` 或 `listSel` | 补字段 |
| extractText 返回 undefined 时整条跳过 | hook 写错（return '' 不算 falsy，但 0/空字符串/false 算） | 用 `return undefined` 而不是 `return ''` |
| boot 9 秒还没启动 | listSel 不存在或加载太晚 | 改 listSel 选延迟后出现的容器；或确认不是 SPA 整体还没渲染 |
| 用户切换 nav 开关后不生效 | `entry.js` mount 路径正常但 adapter 没引入 | 检查 `entry.js` 的 `import()` 路径对得上 |
| 拖拽 nav 时点击 row | onSelect 没 stopPropagation | 参考 `view.js` `createRow` 已处理 |
| 文件名 ≠ platformId | `import()` 失败 → mount catch | 文件名严格等于 `PLATFORM_CONFIG` key |

## adapter 性能约束

- `extractText` 在每条消息 collect 时调用（避免重操作）
- `itemSel` / `listSel` 都会进 MO + IO 高频回调
- 不要在 adapter 导出函数内做 async/await/IO（必须同步纯函数）
- 不要在 adapter 内调用 `document.querySelector`（应该靠 itemSel + listSel 拿到的元素子树）

## adapter 与 view 职责切分

| 场景 | 谁负责 |
|---|---|
| 找到用户消息 DOM 节点 | adapter（itemSel + listSel） |
| 提取消息文本 | adapter（textSel + extractText） |
| 监听列表新增消息 | core/observers.js `observeList` |
| 跟踪 active row | core/activeTracker.js |
| 渲染 nav DOM | view.js `createNavView` |
| 处理 hover/拖拽/点击 row | view.js |
| 处理导出/复制按钮 | view.js + core/index.js 回调 |
| 重新 collect（list 变化时） | core/index.js `rebuild()` |

adapter 永远不直接接触 view / observer / IO；只能提供 selector 让 core/index.js 驱动。
