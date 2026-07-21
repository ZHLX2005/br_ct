/**
 * Kimi (www.kimi.com) 平台 nav 配置
 *
 * 选择器：
 * - ITEM_SEL: .chat-content-item-user     (用户消息条目)
 * - LIST_SEL: .chat-content-list          (聊天内容列表)
 * - TEXT_SEL: .segment-content-box        (消息文本节点)
 *
 * extractText fallback：图片/附件场景 .segment-content-box 为空时
 *                       用 row 内 [data-id] / [data-message-id] 兜底
 */

const IMAGE_FALLBACK_PREFIX = '🖼️ ';

export default {
  itemSel: '.chat-content-item-user',
  listSel: '.chat-content-list',
  textSel: '.segment-content-box',
  extractText: (el) => {
    // 1. textSel 优先
    const textNode = el.querySelector('.segment-content-box');
    const text = textNode?.innerText?.trim();
    if (text) return text;

    // 2. el 自身 innerText
    const own = el.innerText?.trim();
    if (own) return own;

    // 3. 图片/附件兜底
    const id =
      el.getAttribute('data-id') ||
      el.querySelector('[data-id]')?.getAttribute('data-id') ||
      el.getAttribute('data-message-id') ||
      el.querySelector('[data-message-id]')?.getAttribute('data-message-id');
    if (id) return `${IMAGE_FALLBACK_PREFIX}(img-${id.slice(-6)})`;

    return undefined;
  },
};
