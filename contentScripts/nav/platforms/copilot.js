/**
 * Microsoft Copilot (copilot.microsoft.com) 平台 nav 配置
 *
 * 选择器（CDP 验证 2026-07-21）：
 * - ITEM_SEL: [id$="-user-message"]           (用户消息容器，id 唯一后缀)
 * - LIST_SEL: [class*="container/chat"]        (滚动容器，CSS container query)
 * - TEXT_SEL: null (用 extractText 剥离 sr-only 标签前缀)
 *
 * extractText：Copilot 用户消息的 innerText 包含 h5.sr-only 标签文字前缀
 * 如 "你说\n1111"，用 split("\n").slice(1) 剥离标签行。
 *
 * 结构：
 *   <div id="xxx-user-message" class="group/user-message" role="article">
 *     <div class="relative space-y-3">
 *       <h5 class="sr-only">你说</h5>
 *       <div ...>用户消息文本</div>
 *     </div>
 *   </div>
 */

export default {
  itemSel: '[id$="-user-message"]',
  listSel: '[class*="container/chat"]',
  textSel: null,
  extractText: (el) => {
    // innerText 包含 "你说\n1111" 格式——剥离首行标签
    const text = el.innerText?.trim();
    if (!text) return undefined;

    const lines = text.split('\n');
    // 首行是 sr-only 标签（"你说"），取剩余部分
    if (lines.length > 1) {
      const body = lines.slice(1).join('\n').trim();
      if (body) return body;
    }
    // 没有标签行或者 body 为空，返回原始文本
    return text;
  },
};
