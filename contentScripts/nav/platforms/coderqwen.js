/**
 * CoderQwen (coder.qwen.ai) 平台 nav 配置
 *
 * 选择器（含候选 fallback）：
 * - ITEM_SEL: [data-cq-user-message], .cq-message--user, .user-message
 * - LIST_SEL: [data-cq-message-list], .cq-message-list, main
 * - TEXT_SEL: [data-cq-message-text], .cq-message-content, .message-text
 *
 * CSS 选择器原生支持多候选（逗号分隔），不需要 extractText 兜底。
 */

export default {
  itemSel: '[data-cq-user-message], .cq-message--user, .user-message',
  listSel: '[data-cq-message-list], .cq-message-list, main',
  textSel: '[data-cq-message-text], .cq-message-content, .message-text',
};
