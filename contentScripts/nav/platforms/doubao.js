/**
 * 豆包 (Doubao / www.doubao.com/chat) 平台 nav 配置
 *
 * 选择器：
 * - ITEM_SEL: .v_list_row[data-observe-row]:has([data-foundation-type="send-message-action-bar"])
 *   doubao virtual list 把 user 和 assistant 两类消息都渲染为 .v_list_row。
 *   user-message row 内含 [data-foundation-type="send-message-action-bar"]
 *   （hover 时浮出的"复制 / 重新生成 / 点赞点踩"操作栏），assistant row 没有。
 *   所以用 :has(...) 把 nav 范围限定到 user message，避免双倍条目 + 错误文本。
 * - LIST_SEL: [class^="message-list-"]    (CSS Modules hash class 前缀)
 * - TEXT_SEL: null（直接用 row 的 innerText）
 * - extractText: 图片消息 fallback —— doubao 上传图片时 row.innerText 为空
 *   （SVG placeholder / base64 占位），用 [data-message-id] 推一个可显示标签
 *
 * 截断 60 字符与原 doubao.js 一致。
 */

const IMAGE_FALLBACK_PREFIX = '🖼️ ';

export default {
  itemSel: '.v_list_row[data-observe-row]:has([data-foundation-type="send-message-action-bar"])',
  listSel: '[class^="message-list-"]',
  textSel: null,
  extractText: (el) => {
    // 1. 文本消息直接用 row 内文本（保留原行为）
    const text = el.innerText?.trim();
    if (text) return text;

    // 2. 图片消息兜底：doubao user 上传图片后 row.innerText 为空
    //    用 [data-message-id] 的 hash 推一个可显示标签
    //    （CDP 实测 2026-07-21: row0 全部 SVG base64 placeholder + 空 innerText）
    const msgId = el.querySelector('[data-message-id]')?.getAttribute('data-message-id');
    if (msgId) {
      const shortId = msgId.slice(-6);
      return `${IMAGE_FALLBACK_PREFIX}(img-${shortId})`;
    }

    return undefined;
  },
};
