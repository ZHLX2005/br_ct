/**
 * ccSkills.js — Skills 子系统
 *
 * 负责 Skills 的懒加载和输入框 /skill 自动补全。
 */

import { getActiveTab } from './ccTabs.js';
import { sendBgRequest } from './ccBgComms.js';
import { escHtml } from './ccUtils.js';
import { CC_DEFAULT_PATH } from './ccConstants.js';

// ==================== Skills 加载 ====================

export function loadTabSkills(tab) {
  if (!tab || tab._skillsLoading) return;
  if (tab._skills.length > 0 && tab._skillsCwd === tab._path) return;
  tab._skillsLoading = true;
  const cwd = tab._path || CC_DEFAULT_PATH;
  // 用 __probe__ 会话探测技能，避免干扰真实会话
  sendBgRequest({ action: 'nxce_ws', cmd: 'getSkills', session: '__probe__', cwd }).then(resp => {
    tab._skillsLoading = false;
    if (!resp?.ok || !resp.data?.skills) return;
    tab._skills = resp.data.skills
      .map(s => typeof s === 'string' ? { name: s, desc: '' } : { name: s.name || String(s), desc: s.desc || '' })
      .sort((a, b) => a.name.localeCompare(b.name));
    tab._skillsCwd = cwd;
  });
}

// ==================== 自动补全 ====================

export function initSkillAutocomplete() {
  const input = document.getElementById('chat-input');
  const popup = document.getElementById('cc-skill-popup');
  if (!input || !popup) return;
  let sel = -1;

  function close() { popup.style.display = 'none'; sel = -1; }

  function show(items) {
    popup.innerHTML = items.length === 0
      ? '<div class="cc-skill-empty">无匹配 Skill</div>'
      : items.map((s, i) =>
        `<div class="cc-skill-item${i === sel ? ' selected' : ''}" data-i="${i}">` +
        `<span class="cc-skill-item-icon">S</span>` +
        `<span class="cc-skill-item-name">${escHtml(s.name)}</span>` +
        `<span class="cc-skill-item-desc">${escHtml(s.desc || '')}</span></div>`
      ).join('');
    popup.style.display = 'block';
  }

  function pick(name) {
    const cur = input.selectionStart || 0;
    const v = input.value;
    const sp = v.lastIndexOf('/', cur);
    if (sp < 0) return;
    input.value = v.slice(0, sp) + '/' + name + ' ' + v.slice(cur);
    const np = sp + name.length + 2;
    input.setSelectionRange(np, np);
    input.dispatchEvent(new Event('input'));
    close();
    input.focus();
  }

  input.addEventListener('input', () => {
    const cur = input.selectionStart || 0;
    const v = input.value;
    const sp = v.lastIndexOf('/', cur);
    if (sp < 0 || sp >= cur) return close();
    const word = v.slice(sp + 1, cur);
    if (word.includes(' ')) return close();
    const tab = getActiveTab();
    if (tab) loadTabSkills(tab);
    const matched = (tab?._skills || []).filter(s => s.name.toLowerCase().includes(word.toLowerCase())).slice(0, 20);
    sel = matched.length > 0 ? 0 : -1;
    show(matched);
  });

  input.addEventListener('keydown', e => {
    if (popup.style.display !== 'block') return;
    const items = popup.querySelectorAll('.cc-skill-item');
    if (!items.length && e.key !== 'Escape') return;
    if (e.key === 'Tab') {
      e.preventDefault();
      const n = items[sel]?.querySelector('.cc-skill-item-name')?.textContent;
      if (n) pick(n);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      sel = Math.min(sel + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('selected', i === sel));
      items[sel]?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      sel = Math.max(sel - 1, 0);
      items.forEach((el, i) => el.classList.toggle('selected', i === sel));
      items[sel]?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Escape') { close(); return; }
  });

  popup.addEventListener('mousedown', e => {
    const item = e.target.closest('.cc-skill-item');
    if (!item) return;
    const n = item.querySelector('.cc-skill-item-name')?.textContent;
    if (n) pick(n);
  });
}
