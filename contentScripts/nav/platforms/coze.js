/**
 * Coze (www.coze.cn) 平台 nav 配置
 *
 * 选择器（含候选 fallback）：
 * - ITEM_SEL: [data-role="user"], .chat-message--user, .message-user
 * - LIST_SEL: .chat-message-list, .message-list, [data-testid="chat-list"]
 * - TEXT_SEL: .message-content, .message-text, .bubble-text
 *
 * extractText fallback：附件/图片场景 textSel 为空时，
 *                       用 row 内的 [data-message-id] 兜底
 */

const IMAGE_FALLBACK_PREFIX = '🖼️ ';

export default {
  itemSel: '[data-role="user"], .chat-message--user, .message-user',
  listSel: '.chat-message-list, .message-list, [data-testid="chat-list"]',
  textSel: '.message-content, .message-text, .bubble-text',
  extractText: (el) => {
    // 1. textSel 多候选（CSS 自身 fallback）+ 子节点 [class*="text"]
    const textSel =
      el.querySelector('.message-content, .message-text, .bubble-text')?.innerText?.trim();
    if (textSel) return textSel;

    // 2. el 自身 innerText（少数 Coze 旧版直接挂在 row 上）
    const own = el.innerText?.trim();
    if (own) return own;

    // 3. 图片/附件兜底
    const msgId =
      el.getAttribute('data-message-id') ||
      el.querySelector('[data-message-id]')?.getAttribute('data-message-id');
    if (msgId) return `${IMAGE_FALLBACK_PREFIX}(img-${msgId.slice(-6)})`;

    return undefined;
  },
};
