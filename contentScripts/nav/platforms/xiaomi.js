/**
 * 小米 (Xiaomi MiMo / aistudio.xiaomimimo.com) 平台 nav 配置
 *
 * 选择器：
 * - ITEM_SEL: '#claw-message-list > *'       (消息列表直接子节点)
 * - LIST_SEL: '#claw-message-list'            (消息列表父容器)
 * - TEXT_SEL: '.flex.w-full.user-message .chat-user'  (用户消息气泡文本)
 *
 * extractText 过滤掉纯 AI 头像 wrapper（.flex.h-8.w-8 形状被外层选择器命中）
 */

export default {
  itemSel: '#claw-message-list > *',
  listSel: '#claw-message-list',
  textSel: '.flex.w-full.user-message .chat-user',
  extractText: (el) => {
    // 排除 AI 头像 wrapper（.flex.h-8.w-8）—— 这种节点不是消息
    if (el.matches('.flex.h-8.w-8')) return undefined;
    return el.querySelector('.flex.w-full.user-message .chat-user')?.innerText?.trim();
  },
};
