/**
 * 智谱 GLM (chatglm.cn) 平台 nav 配置
 *
 * 选择器：
 * - ITEM_SEL: .question-text-style   (用户问题容器)
 * - LIST_SEL: .conversation-inner    (整个对话容器)
 * - TEXT_SEL: .question-txt          (问题文本节点)
 *
 * extractText fallback：图片/附件场景 .question-txt 为空时
 *                       用 row 内 hash 兜底
 */

const IMAGE_FALLBACK_PREFIX = '🖼️ ';

export default {
  itemSel: '.question-text-style',
  listSel: '.conversation-inner',
  textSel: '.question-txt',
  extractText: (el) => {
    // 1. textSel 优先
    const textNode = el.querySelector('.question-txt');
    const text = textNode?.innerText?.trim();
    if (text) return text;

    // 2. el 自身 innerText（少数场景直接挂在 row 上）
    const own = el.innerText?.trim();
    if (own) return own;

    // 3. 图片/附件兜底：row 内任意 [data-id] / [data-message-id]
    const idEl =
      el.querySelector('[data-id]') ||
      el.querySelector('[data-message-id]');
    const id = idEl?.getAttribute('data-id') || idEl?.getAttribute('data-message-id');
    if (id) return `${IMAGE_FALLBACK_PREFIX}(img-${id.slice(-6)})`;

    return undefined;
  },
};
