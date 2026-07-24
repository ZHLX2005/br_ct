/**
 * Claude (claude.ai) 平台 nav 配置
 *
 * 实测 DOM（2026-07-24，claude.ai web chat）:
 *   消息列表：[role="feed"][aria-label="Chat messages"]
 *     ↓ 每条消息按 `[data-rs-index]` 排序，所有消息共用 [role="article"][aria-label^="Message"]
 *   用户消息标识：[data-user-message-bubble="true"]   ← 仅 user message 出现一次
 *     内部 [data-testid="user-message"] 包真正的 <p class="whitespace-pre-wrap">
 *   助手消息标识：div.font-claude-response + .standard-markdown / .progressive-markdown
 *
 * 选择器优先级：
 *   itemSel: [data-user-message-bubble="true"]  ← 不再依赖 data-message-author（DOM 里没有）
 *   listSel: [role="feed"]                      ← feed 容器存在稳定；MO 监听到消息增删
 *   textSel: [data-testid="user-message"] p.whitespace-pre-wrap
 *     这层取第一条 <p>（即用户首段），避免抓到 "Show more" 按钮文本或遮挡层
 *
 * extractText fallback：
 *   - 用户首段空（极端场景）时退到 testid 容器的 innerText
 *   - 仅图片附件（无 <p>）时退到第二个候选，仍空则记为 "(image)"
 */

const IMAGE_FALLBACK_PREFIX = '🖼️ ';

export default {
  itemSel: '[data-user-message-bubble="true"]',
  listSel: '[role="feed"]',
  textSel: '[data-testid="user-message"] p.whitespace-pre-wrap',
  extractText: (el) => {
    // 1. 首选用户首段
    const firstP = el.querySelector('[data-testid="user-message"] p.whitespace-pre-wrap');
    const text = firstP?.innerText?.trim();
    if (text) return text;

    // 2. 退到 user-message 容器的整段 innerText（去 [Show more] 标签靠 :not）
    const userMsg = el.querySelector('[data-testid="user-message"]');
    if (userMsg) {
      const fallback = userMsg.innerText?.trim();
      if (fallback) {
        // 兼容旧 DOM：去掉尾部 "Show more" 之类按钮文案
        return fallback.replace(/\s*(Show more|Show less)\s*$/i, '').trim() || undefined;
      }
    }

    // 3. 纯图片/附件场景：bubble 仍在但里面没有 <p>
    if (el.querySelector('img[alt]')) {
      const alt = el.querySelector('img[alt]')?.getAttribute('alt')?.trim();
      return `${IMAGE_FALLBACK_PREFIX}${alt || 'image'}`;
    }

    return undefined;
  },
};
