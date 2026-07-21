/**
 * DeepSeek (chat.deepseek.com) 平台 nav 配置
 *
 * 选择器：
 * - ITEM_SEL: div.ds-message:not(:has(.ds-markdown))  (虚拟列表中 user-message 行)
 * - LIST_SEL: .ds-virtual-list--printable             (虚拟列表容器)
 * - TEXT_SEL: .ds-message .ds-markdown                (user message 中无 .ds-markdown，触发 extractText 兜底)
 *
 * extractText 兜底逻辑：
 *   1) 第一个文本节点或自身 innerText
 */

export default {
  itemSel: 'div.ds-message:not(:has(.ds-markdown))',
  listSel: '.ds-virtual-list--printable',
  textSel: '.ds-message .ds-markdown',
  extractText: (el) => {
    return (
      el.querySelector('.ds-message-content, [class*="content"], p')?.innerText?.trim() ||
      el.innerText?.trim()
    );
  },
};
