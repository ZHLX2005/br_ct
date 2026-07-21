/**
 * Zai (chat.z.ai) 平台 nav 配置
 *
 * 选择器：
 * - ITEM_SEL: .user-message                        (每条用户消息)
 * - LIST_SEL: [class*="chat"]:not([id])            (聊天容器，hash class 兜底)
 * - TEXT_SEL: .user-message .chat-user             (用户消息气泡文本)
 *
 * extractText fallback：图片/附件场景 .chat-user 为空时
 *                       用 row 内 [data-id] / [data-msg-id] 兜底
 */

const IMAGE_FALLBACK_PREFIX = '🖼️ ';

export default {
  itemSel: '.user-message',
  listSel: '[class*="chat"]:not([id])',
  textSel: '.user-message .chat-user',
  extractText: (el) => {
    // 1. textSel 优先
    const textNode = el.querySelector('.chat-user');
    const text = textNode?.innerText?.trim();
    if (text) return text;

    // 2. el 自身 innerText
    const own = el.innerText?.trim();
    if (own) return own;

    // 3. 图片/附件兜底
    const id =
      el.getAttribute('data-id') ||
      el.querySelector('[data-id]')?.getAttribute('data-id') ||
      el.getAttribute('data-msg-id') ||
      el.querySelector('[data-msg-id]')?.getAttribute('data-msg-id');
    if (id) return `${IMAGE_FALLBACK_PREFIX}(img-${id.slice(-6)})`;

    return undefined;
  },
};
