/**
 * Gemini (gemini.google.com/app) 平台 nav 配置
 *
 * 选择器（CDP 验证 2026-07-20）：
 * - ITEM_SEL: user-query                       (每条用户消息，自定义 tag)
 * - LIST_SEL: infinite-scroller.chat-history   (message list container,
 *                                              .conversation-container 的直接父)
 * - TEXT_SEL: null (直接用 user-query.textContent，inner 结构冗余，简化用 tag 自身)
 *
 * 注意点：
 * - gemini DOM 使用自定义 element (USER-QUERY, USER-QUERY-CONTENT, MODEL-RESPONSE)
 * - user 和 model 消息各被一个 .conversation-container 包裹 → 只用 user-query 不会双倍
 * - chat-history 包了多个 conversation container + autosuggest-scrim；
 *   MutationObserver 监听 childList+subtree 即可触发 build()
 */

export default {
  itemSel: 'user-query',
  listSel: 'infinite-scroller.chat-history',
  textSel: null,
};
