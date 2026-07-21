/**
 * @fileoverview Nav export module — Markdown generation + browser download.
 *
 * Pure function: buildMarkdown(records, meta) → string.
 * URL/download boilerplate in exportChat().
 */

/**
 * Build YAML frontmatter + Markdown body from conversation records.
 * @param {Array<{fullText: string}>} records
 * @param {object} meta
 * @param {string} meta.platformId
 * @param {string} [meta.platformName]
 * @param {string} meta.sourceUrl
 * @param {number} meta.messageCount
 * @param {number} meta.skippedCount
 * @returns {string}
 */
export function buildMarkdown(records, meta) {
  const lines = [];

  // YAML frontmatter
  lines.push('---');
  lines.push(`exportedAt: "${new Date().toISOString()}"`);
  lines.push(`platform: ${meta.platformId}`);
  lines.push(`platformName: ${meta.platformName || meta.platformId}`);
  lines.push(`sourceUrl: ${meta.sourceUrl}`);
  lines.push(`messageCount: ${meta.messageCount}`);
  lines.push(`skippedCount: ${meta.skippedCount}`);
  lines.push('---');
  lines.push('');
  lines.push('# 会话消息');
  lines.push('');

  // Body
  records.forEach((record, index) => {
    const text = record.fullText || '[empty]';
    lines.push(`${index + 1}. ${text}`);
    lines.push('');
  });

  return lines.join('\n');
}

/**
 * Export chat records as a Markdown file download.
 * Uses <a download> with object URL (works in content script context).
 *
 * @param {Array<{fullText: string}>} records
 * @param {object} meta — same as buildMarkdown meta
 */
export function exportChat(records, meta) {
  if (!records || records.length === 0) {
    console.warn('[nav export] no records to export');
    return;
  }

  console.log('[nav export] exporting', records.length, 'messages');

  const markdown = buildMarkdown(records, meta);
  const dataUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(markdown);

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const filename = `${meta.platformId}-${dateStr}-${timeStr}.md`;

  // Use <a download> with data URL — works across content script isolated world
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  console.log('[nav export] download triggered for', filename);
  // Give Chrome enough time to initiate the download before removing anchor
  setTimeout(() => {
    if (a.parentNode) a.remove();
  }, 2000);
}
