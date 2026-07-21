# Nav Adapter 接入规范

## 4 个接入步骤

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

### 3. 创建 nav adapter

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

### 4. 更新测试计数 + 验证

`tests/nav/platform-configs.test.mjs`：

```js
assert.equal(files.length, 17);  // 新增后 +1
```

扩展 reload + F5 → DevTools 确认：

```js
JSON.stringify({
  nav: document.getElementById('bro-chat-right-edges-nav') !== null,
  rows: document.querySelectorAll('.bro-chat-nav__row').length,
})
```

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
- `listSel` 是新增消息时会变化的列表容器；不存在时 nav boot 永不成功
- virtual list 平台（doubao）只保留视口附近 DOM，不在 DOM 中的消息 nav 无法捕获（非 bug）
- 文件路径严格等于 platform ID：`platforms/{platformConfig 的 key}.js`
