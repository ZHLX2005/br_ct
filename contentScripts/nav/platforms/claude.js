/**
 * Claude (claude.ai) 平台 nav 配置
 *
 * 选择器：
 * - ITEM_SEL: [data-message-author="human"]   (每条用户消息)
 * - LIST_SEL: main                             (消息列表父容器)
 * - TEXT_SEL: .font-claude-message             (用户消息文本节点)
 *
 * extractText fallback：附件场景 .font-claude-message 为空时
 *                       用 data-message-author / 子节点 hash 兜底
 */

const IMAGE_FALLBACK_PREFIX = '🖼️ ';

export default {
  itemSel: '[data-message-author="human"]',
  listSel: 'main',
  textSel: '.font-claude-message',
  extractText: (el) => {
    // 1. 优先用 textSel
    const textNode = el.querySelector('.font-claude-message');
    const text = textNode?.innerText?.trim();
    if (text) return text;

    // 2. 图片/附件兜底
    const msgId =
      el.getAttribute('data-message-id') ||
      el.querySelector('[data-message-id]')?.getAttribute('data-message-id');
    if (msgId) return `${IMAGE_FALLBACK_PREFIX}(img-${msgId.slice(-6)})`;

    return undefined;
  },
};
