/**
 * ChatGPT (chatgpt.com) 平台 nav 配置
 *
 * 选择器：
 * - ITEM_SEL: [data-message-author-role="user"]   (Next.js 稳定属性选择器)
 * - LIST_SEL: main                                (消息列表父容器)
 * - TEXT_SEL: .whitespace-pre-wrap                (用户消息文本节点)
 * - extractText: 图片消息 fallback —— user 上传图片时 .whitespace-pre-wrap 不存在，
 *                从 <img alt> 或 data-message-id 推一个可显示的标签
 *
 * 注：chatgpt.com 用 Next.js 渲染，className 经常 hash 化，优先用属性选择器。
 *     user 消息可能是文本、图片、或两者混合，extractText 三层兜底。
 */

const IMAGE_FALLBACK_PREFIX = '🖼️ ';

export default {
  itemSel: '[data-message-author-role="user"]',
  listSel: 'main',
  textSel: '.whitespace-pre-wrap',
  extractText: (el) => {
    // 1. 文本节点优先（标准 .whitespace-pre-wrap）
    const textNode = el.querySelector('.whitespace-pre-wrap');
    const text = textNode?.innerText?.trim();
    if (text) return text;

    // 2. 图片消息 fallback：取第一张 <img alt>
    const img = el.querySelector('img[alt]');
    const alt = img?.getAttribute('alt')?.trim();
    if (alt) return `${IMAGE_FALLBACK_PREFIX}${alt}`;

    // 3. 兜底：取前 8 位 data-message-id 作为唯一标识
    const msgId = el.getAttribute('data-message-id')?.slice(0, 8);
    if (msgId) return `${IMAGE_FALLBACK_PREFIX}(img-${msgId})`;

    return undefined;
  },
};
