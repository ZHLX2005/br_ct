/**
 * Google AI Studio (aistudio.google.com) 平台 nav 配置
 *
 * 选择器（CDP 验证 2026-07-21，prompts/playground 页面）：
 * - ITEM_SEL: .chat-turn-container.user   (用户消息轮次容器)
 * - LIST_SEL: ms-chat-session              (聊天会话根容器)
 * - TEXT_SEL: .turn-content                (消息文本节点)
 *
 * 注意：
 * - prompts/playground 页面 DOM 结构与 chat 页面不同
 *   (ms-chat-turn → .chat-turn-container.render.{user,model} → .turn-content)
 * - 如果 chat 页面也使用不同结构，后续需加 fallback selector
 */

const IMAGE_FALLBACK_PREFIX = '🖼️ ';

export default {
  itemSel: '.chat-turn-container.user',
  listSel: 'ms-chat-session',
  textSel: '.turn-content',
  extractText: (el) => {
    // 1. textSel 优先
    const textNode = el.querySelector('.turn-content');
    const text = textNode?.innerText?.trim();
    if (text) return text;

    // 2. 图片/附件兜底（带 data-turn-id 的 chat-turn-container）
    const turnId = el.getAttribute('data-turn-id');
    if (turnId) return `${IMAGE_FALLBACK_PREFIX}(img-${turnId.slice(-6)})`;

    return undefined;
  },
};
