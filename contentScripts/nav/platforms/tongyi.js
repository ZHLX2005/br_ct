/**
 * 通义千问 (qianwen.com) 平台 nav 配置
 *
 * 选择器（CDP 验证 2026-07-21）：
 * - ITEM_SEL: .chat-question-card-wrap   (用户消息卡片容器)
 * - LIST_SEL: .message-list-scroll-container (消息滚动容器——注意不是 #message-list-scroller)
 * - TEXT_SEL: .question-text-card         (用户消息文本)
 *
 * extractText fallback：图片/附件场景 .question-text-card 为空时
 *                       用 row 内 [data-id] / [data-msg-id] 兜底
 */

const IMAGE_FALLBACK_PREFIX = '🖼️ ';

export default {
  itemSel: '.chat-question-card-wrap',
  listSel: '.message-list-scroll-container',
  textSel: '.question-text-card',
  extractText: (el) => {
    // 1. textSel 优先
    const textNode = el.querySelector('.question-text-card');
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
