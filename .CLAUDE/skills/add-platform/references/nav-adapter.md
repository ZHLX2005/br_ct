# Nav Adapter 接入规范

## 完整接入流程

### 1. 声明 nav 支持

`config/platformConfig.js` 的 platform entry 添加 `hasNav: true`：

```js
yourplatform: {
  // ... name, icon, color, url
  hasNav: true,
},
```

### 2. 注册 manifest match

`manifest.json` nav `content_scripts` 段加入域名：

```json
{ "matches": ["*://example.com/*"], "js": ["contentScripts/nav/entry.js"], "run_at": "document_idle", "all_frames": false }
```

⚠️ 域名精确陷阱：`*://example.com/*` 不匹配 `www.example.com`；`*://notion.so/*` 不匹配 `app.notion.com`。需按用户实际访问域书写。

### 3. 探查 DOM 找选择器

打开目标平台的聊天页面，确保有至少一条用户消息。使用浏览器 DevTools 或远程调试协议探查三个值。

#### 3a. 用户消息元素（itemSel）

找到只命中用户消息的 selector：

```
document.querySelectorAll('.potential-selector').length
```

验证只返回用户消息，不混入 AI 回复。候选人（按优先级）：

| 方式 | 稳定性 | 说明 |
|------|--------|------|
| `data-testid` 属性 | 高 | 平台风格一致时最可靠 |
| 唯一 data 属性 | 高 | Notion 的 `data-agent-chat-user-step-id` 等平台内部 ID |
| `role` 属性 | 中 | `role="article"`、`role="listitem"` 等语义角色 |
| id 后缀匹配 | 中 | `[id$="-user-message"]` |
| 稳定 class | 中 | 非 hash 的框架或布局类 |
| hash class | 低 | 每次构建变化，避免依赖 |

验证命令：

```js
// 确认只命中用户消息
Array.from(document.querySelectorAll('.potential-item-sel')).map(el => ({
  tag: el.tagName,
  text: el.innerText.trim().slice(0, 40),
}))
```

#### 3b. 消息列表容器（listSel）

找到包含所有消息的滚动容器：

```js
// 从用户消息沿祖先链找 overflow-y:auto/scroll 的容器
const el = document.querySelector('.item-sel');
let p = el.parentElement;
for (let i = 0; i < 20 && p; i++) {
  const oy = getComputedStyle(p).overflowY;
  if (oy === 'auto' || oy === 'scroll') {
    console.log(i, p.tagName, p.className.slice(0, 60), p.scrollHeight - p.clientHeight);
    break;
  }
  p = p.parentElement;
}
```

确认容器包含所有用户消息：

```js
document.querySelector('.list-sel').querySelectorAll('.item-sel').length
```

#### 3c. 消息文本节点（textSel）

在用户消息元素内部找文本节点：

```js
document.querySelector('.item-sel')?.innerText?.trim()  // 全量文本
document.querySelector('.item-sel .text-sel')?.innerText  // 子节点文本
```

如果：

- 文本直接在内层元素中 → 用 `textSel` 指向该元素
- 文本在 item 元素自身 → 设 `textSel: null`，用 `el.innerText`
- 文本包含 sr-only 标签前缀或复杂结构 → 用 `extractText` hook 自行提取

#### 3d. 图片/附件兜底

如果平台的消息可能是纯图片（无文本），检查是否有 data-id / data-message-id 等备用属性：

```js
document.querySelector('.item-sel')?.getAttribute('data-message-id')
```

有则在 `extractText` 中返回占位文本。

### 4. 创建 nav adapter

`contentScripts/nav/platforms/{platformId}.js`：

```js
export default {
  itemSel: '[data-testid="user-message"]',   // 用户消息 selector（必填）
  listSel: '.message-container',              // 消息列表容器（必填，MO 绑定点）
  textSel: '.message-text',                   // 文本节点（可选；null 则用 innerText）
  extractText: (el) => { /* 可选 hook */ },  // 图片/附件兜底等特殊提取
};
```

禁止在 adapter 中写 IIFE、CSS、DOM 创建、Observer 或滚动行为。

### 5. 更新测试计数

`tests/nav/platform-configs.test.mjs`：

```js
assert.equal(files.length, 17);  // 新增后 +1
```

### 6. 验证

扩展 reload + F5 → DevTools 确认：

```js
JSON.stringify({
  nav: document.getElementById('bro-chat-right-edges-nav') !== null,
  rows: document.querySelectorAll('.bro-chat-nav__row').length,
})
```

期望：`nav: true`，`rows` 等于页面中用户消息数。

## Selector 探查优先级

| 方式 | 稳定性 | 平台示例 |
|------|--------|----------|
| `data-testid` | 高 | Grok: `[data-testid="user-message"]` |
| 唯一 data 属性 | 高 | Notion: `[data-agent-chat-user-step-id]` |
| `role` 属性 | 中 | Copilot: `[id$="-user-message"]` |
| stable class | 中 | Notion: `.layout-content` |
| hash class | 低 | 避免使用（每次构建变） |

## 常见陷阱

- `itemSel` 只命中用户消息，不混入 assistant 消息
- `listSel` 是新增消息时会变化的列表容器；不存在时 nav boot 永不成功（`RETRY_MAX` = 30 × 300ms 后放弃）
- virtual list 平台（doubao）只保留视口附近 DOM，不在 DOM 中的消息 nav 无法捕获（非 bug）
- 文件路径严格等于 platform ID：`platforms/{platformConfig 的 key}.js`
- textSel 查询作用域是 item 内部；如果整个页面有多个匹配，scope 到 item 内只有 1 个即可
- extractText 返回空值时继续走 textSel → innerText 兜底，不需要在每个分支都 return
- 点击后滚动闪烁 --> 检查 watchScroll 中是否含 `clickLockUntil = 0`（已移除，不应出现）
