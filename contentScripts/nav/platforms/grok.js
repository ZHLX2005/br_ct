/**
 * Grok (grok.com) 平台 nav 配置
 *
 * 选择器（CDP 验证 2026-07-21）：
 * - ITEM_SEL: [data-testid="user-message"]  (用户消息，Grok 用 data-testid 区分 user/assistant)
 * - LIST_SEL: [class*="overflow-y-auto"][class*="px-gutter"] (滚动容器)
 * - TEXT_SEL: null (直接用元素 innerText)
 *
 * extractText fallback：图片/附件场景 innerText 为空时
 *                       用 row 内 [data-message-id] / [data-turn-id] 兜底
 */

const IMAGE_FALLBACK_PREFIX = '🖼️ ';

export default {
  itemSel: '[data-testid="user-message"]',
  listSel: '[class*="overflow-y-auto"][class*="px-gutter"]',
  textSel: null,
  extractText: (el) => {
    // 1. 元素自身 innerText 优先
    const text = el.innerText?.trim();
    if (text) return text;

    // 2. 图片/附件兜底
    const id =
      el.getAttribute('data-message-id') ||
      el.querySelector('[data-message-id]')?.getAttribute('data-message-id') ||
      el.getAttribute('data-turn-id') ||
      el.querySelector('[data-turn-id]')?.getAttribute('data-turn-id');
    if (id) return `${IMAGE_FALLBACK_PREFIX}(img-${id.slice(-6)})`;

    return undefined;
  },
};
