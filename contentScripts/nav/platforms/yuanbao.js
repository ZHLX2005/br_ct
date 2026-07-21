/**
 * 元宝 (Yuanbao / yuanbao.tencent.com) 平台 nav 配置
 *
 * 选择器：
 * - ITEM_SEL: .agent-chat__list__item--human   (每条用户消息)
 * - LIST_SEL: .agent-chat__list                (消息列表，触发 MutationObserver)
 * - TEXT_SEL: .hyc-content-text                (用户消息文本节点)
 *
 * extractText fallback：图片上传/附件 类消息的 .hyc-content-text 为空时
 *                       用 [data-message-id] 推一个可显示标签
 */

const IMAGE_FALLBACK_PREFIX = '🖼️ ';

export default {
  itemSel: '.agent-chat__list__item--human',
  listSel: '.agent-chat__list',
  textSel: '.hyc-content-text',
  extractText: (el) => {
    // 1. 优先用 textSel（保留原行为）
    const textNode = el.querySelector('.hyc-content-text');
    const text = textNode?.innerText?.trim();
    if (text) return text;

    // 2. 图片/附件消息兜底：取 row 上或子节点上 [data-message-id]
    const msgId =
      el.getAttribute('data-message-id') ||
      el.querySelector('[data-message-id]')?.getAttribute('data-message-id');
    if (msgId) return `${IMAGE_FALLBACK_PREFIX}(img-${msgId.slice(-6)})`;

    return undefined;
  },
};
