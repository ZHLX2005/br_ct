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
import { RETRY_INTERVAL_MS, RETRY_MAX, CLICK_LOCK_MS, SUMMARY_TEMPLATE, isSummaryMessage, COPY_MAX_LEN } from '../constants.js';

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

  // 过滤掉"总结按钮"发出的消息（这些是上一轮总结的产物，包含 SUMMARY_MARKER）。
  // 复制/导出/再次总结都要避开它们 —— 否则会出现用户提问被自己上一次的总结嵌套覆盖。
  // 复制单条时也要走这条过滤：万一用户双击复制了一条总结消息，体验上同样应该跳过。
  function getUserQuestionRecords() {
    return records.filter(r => r.fullText && !isSummaryMessage(r.fullText));
  }

  // 复制单条消息全文到剪贴板（无 frontmatter / 无 ========== 分隔，纯原文）
  async function onCopyRow(index) {
    const record = records[index];
    if (!record || !record.fullText) return;
    // 单条复制时若这条恰好是总结发出的消息，按钮响应了但剪贴板实际写入空字符串
    // 让用户感知到"按了但没生效"。
    if (isSummaryMessage(record.fullText)) {
      console.warn('[nav] copy row skipped: this is a summary-generated message', index);
      return;
    }
    try {
      await navigator.clipboard.writeText(record.fullText);
      console.log('[nav] copied row', index, `(${record.fullText.length} chars)`);
    } catch (err) {
      console.warn('[nav] clipboard write failed', err);
    }
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
    const userQuestions = getUserQuestionRecords();
    if (userQuestions.length === 0) return;
    const filteredOut = records.length - userQuestions.length;
    const platformId_ = platformId;
    const platformName_ = platformName || platformId;
    const sourceUrl = location.href;
    const msgCount = userQuestions.length;
    // 不与 collector 的 skippedCount 混淆 —— 这是过滤器主动排除的"总结消息"
    const skipCount = skippedCount + filteredOut;

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const filename = `${platformId_}-${dateStr}-${timeStr}.md`;

    const markdown = buildExportMarkdown(
      userQuestions.map(r => ({ fullText: r.fullText })),
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
    if (filteredOut > 0) {
      console.log('[nav] export filtered out', filteredOut, 'summary message(s)');
    }
  }

  // 复制原文到剪贴板（用 ========== 分隔多条消息，与 sidebar 的"导入阻塞消息"功能配对）
  // 用法：粘贴到 sidebar 底部的"导入"按钮 → 自动拆成阻塞消息
  // 已过滤：① 排除所有"总结按钮"发出的消息，避免复制出含自己总结的嵌套原文；
  //         ② 排除字数超过 COPY_MAX_LEN 的条目（太长复制出来没有意义）。
  async function onCopy() {
    const userQuestions = getUserQuestionRecords();
    if (userQuestions.length === 0) return;
    const copyable = userQuestions.filter(r => r.fullText.length <= COPY_MAX_LEN);
    const excludedLong = userQuestions.length - copyable.length;
    if (copyable.length === 0) return;
    const SEP = '==========';
    const text = copyable.map(r => r.fullText).join(`\n\n${SEP}\n\n`);
    try {
      await navigator.clipboard.writeText(text);
      console.log('[nav] copied', copyable.length, 'user questions to clipboard',
        records.length - userQuestions.length, 'summary message(s) excluded,',
        excludedLong, 'long message(s) excluded (>' + COPY_MAX_LEN + ' chars)');
    } catch (err) {
      console.warn('[nav] clipboard write failed', err);
    }
  }

  // 总结模板由 constants.js 的 SUMMARY_TEMPLATE 统一提供（复制/导出/总结都靠 marker 识别）
  // 详见 constants.js SUMMARY_MARKER / isSummaryMessage
  async function onSummary() {
    const userQuestions = getUserQuestionRecords();
    if (userQuestions.length === 0) {
      // 两种 0 的来源：
      // 1) nav 里压根没有用户问题（records 为空）—— 真正的"无内容"
      // 2) nav 里有记录但全是"总结按钮"发的消息（上一轮总结已回流）—— 防止无限递归
      const hasAnySummary = records.some(r => r.fullText && isSummaryMessage(r.fullText));
      if (hasAnySummary) {
        console.warn('[nav] summary skipped: last message is already a summary, '
          + 'would cause recursion');
      } else {
        console.warn('[nav] summary skipped: no records');
      }
      return false;
    }
    const SEP = '==========';
    const questions = userQuestions.map(r => r.fullText).join(`\n\n${SEP}\n\n`);
    const message = SUMMARY_TEMPLATE.replace('%s', questions);

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'directSend',
        platform: platformId,
        message,
        switchToTab: false, // 当前正在使用，无需切换
      });
      if (response && response.status === 'success') {
        console.log('[nav] summary sent to', platformId, `(${userQuestions.length} questions, `
          + `${records.length - userQuestions.length} summary message(s) excluded)`);
        return true;
      }
      console.warn('[nav] summary send non-success response', response);
      return false;
    } catch (err) {
      console.warn('[nav] summary send failed', err);
      return false;
    }
  }

  const view = createNavView({ onSelect, onExport, onCopy, onCopyRow, onSummary });
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

    // 同步"总结"按钮的禁用态：nav 中存在由"总结"按钮发出的消息时禁用。
    // 这是防无限递归的另一道保险（即便 isSummaryMessage marker 漏判，disabled 也拦住）。
    const hasSummaryMessage = records.some(r => r.fullText && isSummaryMessage(r.fullText));
    if (typeof view.setSummaryEnabled === 'function') {
      view.setSummaryEnabled(!hasSummaryMessage,
        hasSummaryMessage
          ? '已总结过，避免无限递归（请新建一个会话再总结）'
          : undefined);
    }

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
