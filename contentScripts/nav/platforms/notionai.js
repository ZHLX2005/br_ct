/**
 * NotionAI (app.notion.com/chat) 平台 nav 配置
 *
 * 选择器（CDP 验证 2026-07-21）：
 * - ITEM_SEL: [data-agent-chat-user-step-id]     (用户消息唯一 data 属性)
 * - LIST_SEL: .layout-content                     (页面布局容器，包含所有消息)
 * - TEXT_SEL: [data-content-editable-leaf="true"] (用户消息文本节点)
 * - extractText fallback：图片/附件场景用 element.innerText 兜底
 *
 * 注意：
 * - Notion 使用 CSS Module 哈希类名（x87ps6o 等），不能依赖类名选择器
 * - data-agent-chat-user-step-id 是 Notion 内部唯一标识，比 css class 稳定
 * - 文本节点用 data-content-editable-leaf="true"，scope 在 item 内只查到一个
 */

const IMAGE_FALLBACK_PREFIX = '🖼️ ';

export default {
  itemSel: '[data-agent-chat-user-step-id]',
  listSel: '.layout-content',
  textSel: '[data-content-editable-leaf="true"]',
  extractText: (el) => {
    // 1. textSel 优先（scoped in item 内）
    const textNode = el.querySelector('[data-content-editable-leaf="true"]');
    const text = textNode?.innerText?.trim();
    if (text) return text;

    // 2. el 自身 innerText
    const own = el.innerText?.trim();
    if (own) return own;

    // 3. 图片/附件兜底
    const stepId = el.getAttribute('data-agent-chat-user-step-id');
    if (stepId) return `${IMAGE_FALLBACK_PREFIX}(step-${stepId.slice(-6)})`;

    return undefined;
  },
};
