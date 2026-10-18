/**
 * DOM comment prompt builder.
 *
 * Single source of truth for turning a stored comment record into the
 * AI-coding prompt text. Used by the dom_comments page.
 *
 * NOTE: funcs/元素dom/dom_comment_picker.js keeps an inline copy because
 * executeScript-injected scripts cannot import ES modules. Keep both in sync.
 *
 * @module shared/domComments/domCommentsPrompt
 */

export const VERDICT_LABELS = {
  like: '点赞',
  dislike: '点踩',
  none: '无',
};

/**
 * 把元素定位信息 + 用户评价构建成面向 AI 编程的提示词结构
 * @param {object} info - 记录对象（字段见 domCommentsStore 头注释）
 */
export function buildDomPrompt(info) {
  const lines = [];
  lines.push('## DOM 元素定位与评论（AI 编程辅助）');
  lines.push('');
  lines.push('### 1. 页面信息');
  lines.push(`- 页面 URL: ${info.url}`);
  if (info.title) lines.push(`- 页面标题: ${info.title}`);
  lines.push('');
  lines.push('### 2. 元素定位');
  lines.push(`- 元素标签: ${info.tag}`);
  lines.push(`- CSS 选择器: ${info.selectors.css}`);
  lines.push(`- JS 路径: ${info.selectors.jsPath}`);
  lines.push(`- XPath: ${info.selectors.xpath}`);
  lines.push(`- 完整 XPath: ${info.selectors.fullXPath}`);
  lines.push('');
  lines.push('### 3. 元素 HTML');
  lines.push('```html');
  lines.push(info.html);
  lines.push('```');
  lines.push('');
  lines.push('### 4. 用户评价');
  const verdictLabel = VERDICT_LABELS[info.verdict] || VERDICT_LABELS.none;
  lines.push(`- 评价: ${verdictLabel}`);
  lines.push(`- 评论: ${info.comment || '（无补充评论）'}`);
  lines.push('');
  lines.push('### 5. 任务');
  lines.push('请根据以上定位信息在项目源码中定位对应组件/模板，并结合用户评价说明处理意图。');
  return lines.join('\n');
}

/**
 * 复制用的纯定位信息（不含评论与 HTML）
 */
export function buildLocatorText(info) {
  return [
    `URL: ${info.url}`,
    `CSS: ${info.selectors.css}`,
    `JS: ${info.selectors.jsPath}`,
    `XPath: ${info.selectors.xpath}`,
    `Full XPath: ${info.selectors.fullXPath}`,
  ].join('\n');
}
