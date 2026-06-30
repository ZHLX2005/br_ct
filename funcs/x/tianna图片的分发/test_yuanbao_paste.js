/**
 * @fileoverview 元宝页面图片粘贴自测脚本
 *
 * @scenario    在元宝(yuanbao.tencent.com)对话页 DevTools 中手动执行，用于验证图片粘贴流程
 * @feature     构造图片 DataTransfer、模拟 paste 事件、发送消息
 * @effect      向元宝输入框派发 paste 事件后自动点击发送按钮
 * @category    自动化点击
 * @platform    yuanbao（腾讯元宝）
 * @entry       IIFE 自动执行
 */

/**
 * 元宝页面图片粘贴自测脚本
 * 直接在 DevTools Console 跑：复制整段 → 粘贴 → 回车
 *
 * 流程：
 *   1. 构造一张 1×1 红色 PNG（base64）
 *   2. 转成 File 放进 DataTransfer
 *   3. 构造 ClipboardEvent('paste') 派发给元宝的输入框
 *   4. 等待元宝渲染缩略图后，再追加文本并触发 input
 *   5. 点击发送按钮
 *
 * 注意：本脚本不依赖 chrome.runtime，纯 page-world 模拟。
 */

(async function () {
  const log = (...a) => console.log('[YuanBaoPasteTest]', ...a);

  // ============ 1. 构造一张 1×1 红色 PNG（base64） ============
  // 用 canvas 生成更直观，且能控制尺寸。
  async function makeImageBase64({ width = 200, height = 120, color = '#e53935', text = 'TEST' } = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    // 背景
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, width, height);
    // 文字
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, height / 2);
    // 边框
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, width - 4, height - 4);
    return canvas.toDataURL('image/png');
  }

  const dataUrl = await makeImageBase64({ width: 240, height: 140, color: '#1e88e5', text: 'HELLO' });
  log('生成的图片 dataURL 长度:', dataUrl.length);

  // dataURL → Blob
  function dataUrlToBlob(dataUrl) {
    const [meta, b64] = dataUrl.split(',');
    const mimeMatch = meta.match(/data:(.*?);base64/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  // ============ 2. 构造 File + DataTransfer ============
  const blob = dataUrlToBlob(dataUrl);
  const file = new File([blob], 'pasted-test.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  log('已构造 DataTransfer，files:', dt.files.length, dt.files[0]?.name);

  // ============ 3. 定位元宝输入框 ============
  const inputSelectors = [
    '#prompt-textarea',
    '.ql-editor[contenteditable="true"]',
    '[contenteditable="true"]',
  ];
  let inputEl = null;
  for (const sel of inputSelectors) {
    inputEl = document.querySelector(sel);
    if (inputEl) { log('找到输入框:', sel); break; }
  }
  if (!inputEl) {
    console.error('[YuanBaoPasteTest] ❌ 未找到元宝输入框，请确认在 yuanbao.tencent.com 对话页');
    return;
  }

  // 聚焦
  inputEl.scrollIntoView({ block: 'center' });
  inputEl.click();
  inputEl.focus();
  await new Promise(r => setTimeout(r, 100));

  // ============ 4. 构造并派发 paste 事件 ============
  const pasteEvent = new ClipboardEvent('paste', {
    bubbles: true,
    cancelable: true,
    clipboardData: dt,
  });
  // 兜底：部分 Chromium 版本不会自动填 clipboardData
  if (!pasteEvent.clipboardData) {
    Object.defineProperty(pasteEvent, 'clipboardData', { value: dt });
  }
  const dispatched = inputEl.dispatchEvent(pasteEvent);
  log('paste 事件已派发，dispatched=', dispatched);

  // 等待元宝自己处理 paste，把图片渲染成 <img>
  await new Promise(r => setTimeout(r, 400));

  // 检查输入框是否真的出现了图片
  const imgsInInput = inputEl.querySelectorAll('img');
  log('输入框内 <img> 数量:', imgsInInput.length);
  imgsInInput.forEach((img, i) => {
    log(`  img[${i}]`, { src: img.src.slice(0, 60) + '...', w: img.naturalWidth, h: img.naturalHeight });
  });

  if (imgsInInput.length === 0) {
    console.warn('[YuanBaoPasteTest] ⚠ 输入框内没看到 <img>，元宝可能没有正确接收 paste。请在 DevTools 监听 "paste" 事件排查。');
  }

  // ============ 5. 追加文本（可选） ============
  const text = '这是从脚本派发的测试消息';
  if (inputEl.isContentEditable || inputEl.contentEditable === 'true') {
    // 在末尾追加文本节点（不要清空，避免覆盖图片）
    const p = document.createElement('p');
    p.textContent = text;
    inputEl.appendChild(p);
  } else {
    inputEl.value = (inputEl.value || '') + text;
  }
  // 触发 input 事件让元宝的 React 状态更新
  inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
  inputEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  log('已追加文本:', text);
  await new Promise(r => setTimeout(r, 150));

  // ============ 6. 点击发送按钮 ============
  const btnSelectors = [
    '#yuanbao-send-btn',
    '#composer-submit-button',
    'button[aria-label="Send message"]',
    'button[aria-label="发送消息"]',
    'button[type="submit"]',
  ];
  let btnEl = null;
  for (const sel of btnSelectors) {
    btnEl = document.querySelector(sel);
    if (btnEl) { log('找到发送按钮:', sel); break; }
  }
  if (!btnEl) {
    console.warn('[YuanBaoPasteTest] ⚠ 未找到发送按钮，请手动点击。');
    return;
  }
  if (btnEl.disabled) {
    console.warn('[YuanBaoPasteTest] ⚠ 发送按钮处于 disabled 状态，不点击。');
    return;
  }
  btnEl.click();
  log('✅ 已点击发送按钮');

})().catch(err => {
  console.error('[YuanBaoPasteTest] ❌ 脚本异常:', err);
});