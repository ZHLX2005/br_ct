/**
 * @fileoverview Nav orchestrator。
 *
 * 编排 collector / view / activeTracker / observers。
 * createNav(cfg) 返回 { destroy }。
 */

import { createNavView } from '../view.js';
import { createDisposer } from '../util/disposer.js';
import { collectRecords } from './collector.js';
import { createActiveTracker } from './activeTracker.js';
import { observeViewport, watchScroll, observeList, observeShell } from './observers.js';
import { RETRY_INTERVAL_MS, RETRY_MAX, CLICK_LOCK_MS } from '../constants.js';

export function createNav(cfg) {
  const { itemSel, listSel, textSel, extractText, platformId, platformName } = cfg;
  if (!itemSel || !listSel) {
    console.warn('[nav] 缺少必要参数', { itemSel, listSel });
    return null;
  }

  const d = createDisposer();
  let records = [];
  let skippedCount = 0;
  let bootRetries = 0;

  // ---- view ----
  function onSelect(index) {
    const record = records[index];
    if (!record) return;
    tracker.commit(index);
    record.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    tracker.lock();
  }

  function buildExportMarkdown(records, meta) {
    const lines = [];
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
    records.forEach((record, index) => {
      const text = record.fullText || '[empty]';
      lines.push(`${index + 1}. ${text}`);
      lines.push('');
    });
    return lines.join('\n');
  }

  function onExport() {
    if (records.length === 0) return;
    const platformId_ = platformId;
    const platformName_ = platformName || platformId;
    const sourceUrl = location.href;
    const msgCount = records.length;
    const skipCount = skippedCount;

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const filename = `${platformId_}-${dateStr}-${timeStr}.md`;

    const markdown = buildExportMarkdown(
      records.map(r => ({ fullText: r.fullText })),
      { platformId: platformId_, platformName: platformName_, sourceUrl, messageCount: msgCount, skippedCount: skipCount }
    );

    const href = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(markdown);
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { if (a.parentNode) a.remove(); }, 2000);
  }

  // 复制原文到剪贴板（不带 frontmatter，直接拼 fullText，保留换行）
  // 用法：粘贴到 IM / 邮件 / 笔记时不会被 md 标记干扰
  async function onCopy() {
    if (records.length === 0) return;
    const text = records.map(r => r.fullText).join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      console.log('[nav] copied', records.length, 'messages to clipboard');
    } catch (err) {
      console.warn('[nav] clipboard write failed', err);
    }
  }

  const view = createNavView({ onSelect, onExport, onCopy });
  if (!view) return null;
  d.add(() => view.destroy());

  // ---- 采集器 ----
  const collector = { itemSel, textSel, extractText };

  // ---- active 跟踪 ----
  const tracker = createActiveTracker({
    getRecords: () => records,
    onChange: (i) => view.setActive(i),
  });

  // ---- rebuild ----
  function rebuild() {
    const result = collectRecords(collector);
    records = result.records;
    skippedCount = result.skippedCount;
    view.render(records.map((r) => r.text));

    if (records.length > 0) {
      if (!tracker.evaluate()) {
        tracker.commit(records.length - 1);
      }
    }
  }

  // ---- observers ----

  // viewport IO：active 跟随视口变化
  const vpDispose = observeViewport({
    records: () => records,
    onChange: () => tracker.schedule(),
  });
  // 当 records 变化时需重挂 IO
  let currentVpDispose = vpDispose;

  function attachViewport() {
    if (currentVpDispose) currentVpDispose();
    currentVpDispose = observeViewport({
      records: () => records,
      onChange: () => tracker.schedule(),
    });
  }

  // scroll：所有平台统一 capture
  d.add(watchScroll({ onChange: () => tracker.schedule() }));

  // shell：页面级结构变化（SPA 切换对话）
  d.add(observeShell({
    listSel,
    onListReady: (list) => {
      // 绑新 list 的 MO
      d.add(observeList({
        list,
        onChange: () => rebuild(),
      }));
      // 重建 + 重挂 viewport IO
      rebuild();
      attachViewport();
    },
  }));

  // ---- boot ----
  function boot() {
    const list = document.querySelector(listSel);
    if (list) {
      d.add(observeList({ list, onChange: () => rebuild() }));
      rebuild();
      attachViewport();
    } else if (++bootRetries <= RETRY_MAX) {
      setTimeout(boot, RETRY_INTERVAL_MS);
    }
  }
  boot();

  // ---- public ----
  return {
    destroy() {
      d.flush();
      records = [];
    },
  };
}
