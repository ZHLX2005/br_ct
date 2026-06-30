/**
 * @fileoverview 输入框打字监听器，停止后自动复制
 *
 * @scenario    任何网页加载后激活，用于自动捕获用户输入
 * @feature     监听 keydown/input 事件，倒计时结束后复制输入框内容
 * @effect      页面右上角出现圆环倒计时 UI，停止后自动写入剪贴板并弹通知
 * @category    行为Hook
 * @platform    通用
 * @entry       自动执行
 */

console.log("typingMonitor.js loaded");

let typingTimer = null;
let lastTypingTime = 0;
let typingCharCount = 0; // 记录打字字符数量
let ringTimer = null; // 圆环动画计时器
let ringStartTime = null; // 圆环开始时间
let isRingActive = false; // 圆环是否激活
const TYPING_TIMEOUT = 3000; // 3秒没有输入视为停止打字
const MIN_TYPING_CHARS = 10; // 至少输入10个字符才视为打字行为

// 只监听有输入框元素的打字事件
document.addEventListener("keydown", function(e) {
    // 只在输入框内处理按键事件
    if (!isInputElement(document.activeElement)) {
        return;
    }

    // 忽略功能键、修饰键和导航键
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' ||
        e.key === 'Meta' || e.key === 'CapsLock' || e.key === 'Tab' ||
        e.key === 'Escape' || e.key === 'ArrowUp' || e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' ||
        e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown' ||
        e.key === 'F1' || e.key === 'F2' || e.key === 'F3' || e.key === 'F4' ||
        e.key === 'F5' || e.key === 'F6' || e.key === 'F7' || e.key === 'F8' ||
        e.key === 'F9' || e.key === 'F10' || e.key === 'F11' || e.key === 'F12') {
        return;
    }

    // 忽略组合键（Ctrl+C, Ctrl+V等）
    if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
    }

    handleTypingActivity();
});

// 监听输入内容变化事件
document.addEventListener("input", function(e) {
    // 只处理输入框的input事件
    if (!isInputElement(e.target)) {
        return;
    }

    handleTypingActivity();
});

function handleTypingActivity() {
    const now = Date.now();

    // 增加打字字符计数
    typingCharCount++;

    // 重置计时器
    if (typingTimer) {
        clearTimeout(typingTimer);
    }

    // 设置新的计时器，超时后执行复制操作
    typingTimer = setTimeout(() => {
        onTypingStopped();
    }, TYPING_TIMEOUT);

    lastTypingTime = now;

    // 显示打字状态指示器
    if (typingCharCount >= 1) {
        showTypingIndicator();
        updateRingTimer();
    }
}

function onTypingStopped() {
    console.log('onTypingStopped被调用，检查是否应该执行复制');

    // 清理圆环计时器
    if (ringTimer) {
        clearInterval(ringTimer);
        ringTimer = null;
    }
    isRingActive = false;

    // 只有在输入了足够字符数的情况下才执行复制
    if (typingCharCount >= MIN_TYPING_CHARS) {
        console.log('字符数足够，准备复制内容');

        // 获取当前活动的输入框
        const activeElement = document.activeElement;

        if (activeElement && isInputElement(activeElement)) {
            const inputContent = getInputContent(activeElement);

            if (inputContent && inputContent.trim().length > 0) {
                console.log('复制内容:', inputContent.substring(0, 50) + '...');
                copyToClipboard(inputContent);
                showCopyNotification(inputContent);
            } else {
                console.log('输入框内容为空，不执行复制');
            }
        } else {
            console.log('当前焦点不在输入框内，不执行复制');
        }

        hideTypingIndicator();
    } else {
        console.log('字符数不足，不执行复制');
    }

    // 重置打字计数
    typingCharCount = 0;
}

function isInputElement(element) {
    const inputTypes = [
        'INPUT', 'TEXTAREA'
    ];

    if (inputTypes.includes(element.tagName)) {
        return true;
    }

    // 检查 contenteditable 元素
    if (element.hasAttribute('contenteditable') &&
        element.getAttribute('contenteditable').toLowerCase() !== 'false') {
        return true;
    }

    return false;
}

function getInputContent(element) {
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        return element.value;
    } else if (element.hasAttribute('contenteditable')) {
        return element.innerText || element.textContent;
    }
    return '';
}

function copyToClipboard(text) {
    // 尝试使用现代 Clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            console.log('文本已复制到剪切板:', text);
        }).catch(err => {
            console.error('复制失败:', err);
            fallbackCopyText(text);
        });
    } else {
        // 降级到传统方法
        fallbackCopyText(text);
    }
}

function fallbackCopyText(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;

    // 使文本区域不可见
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    textArea.style.opacity = '0';

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
        const successful = document.execCommand('copy');
        if (successful) {
            console.log('文本已复制到剪切板:', text);
        } else {
            console.error('复制失败');
        }
    } catch (err) {
        console.error('复制失败:', err);
    }

    document.body.removeChild(textArea);
}

function showTypingIndicator() {
    // 检查是否已存在指示器
    const existingIndicator = document.getElementById('typing-indicator');
    if (existingIndicator) {
        // 如果已存在，只更新圆环计时器，不重新创建
        updateRingTimer();
        return;
    }

    const indicator = document.createElement('div');
    indicator.id = 'typing-indicator';
    indicator.className = 'typing-ring-container';

    indicator.innerHTML = `
        <div class="typing-ring">
            <svg width="60" height="60" viewBox="0 0 60 60">
                <circle class="ring-bg" cx="30" cy="30" r="25" fill="none" stroke="#e0e0e0" stroke-width="4"/>
                <circle class="ring-progress" id="ring-progress" cx="30" cy="30" r="25" fill="none"
                        stroke="url(#gradient)" stroke-width="4" stroke-linecap="round"
                        stroke-dasharray="157" stroke-dashoffset="0"
                        transform="rotate(-90 30 30)"/>
                <defs>
                    <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#667eea"/>
                        <stop offset="100%" stop-color="#764ba2"/>
                    </linearGradient>
                </defs>
                <text x="30" y="35" text-anchor="middle" class="ring-text" fill="#333" font-size="11" font-weight="600">
                    ${Math.ceil(TYPING_TIMEOUT / 1000)}s
                </text>
            </svg>
        </div>
        <div class="typing-label">📝 打字中</div>
    `;

    indicator.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        background: white;
        border-radius: 16px;
        padding: 12px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.12);
        cursor: pointer;
        transition: all 0.3s ease;
        animation: slideIn 0.3s ease-out;
        pointer-events: auto;
        user-select: none;
        -webkit-user-select: none;
        -moz-user-select: none;
        -ms-user-select: none;
    `;

    // 添加点击事件来刷新计时器
    indicator.addEventListener('mousedown', function(e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        console.log('点击圆环刷新计时器');
        refreshTypingTimer();

        // 阻止任何可能的默认行为
        return false;
    });

    // 也阻止click事件的传播
    indicator.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return false;
    });

    // 添加悬停效果
    indicator.addEventListener('mouseenter', function() {
        this.style.transform = 'scale(1.05)';
        this.style.boxShadow = '0 12px 32px rgba(0,0,0,0.18)';
    });

    indicator.addEventListener('mouseleave', function() {
        this.style.transform = 'scale(1)';
        this.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)';
    });

    document.body.appendChild(indicator);
}

function hideTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) {
        indicator.remove();
    }
}

function updateRingTimer() {
    // 清理之前的计时器
    if (ringTimer) {
        clearInterval(ringTimer);
    }

    isRingActive = true;
    ringStartTime = Date.now();

    ringTimer = setInterval(() => {
        const elapsed = Date.now() - ringStartTime;
        const progress = Math.min(elapsed / TYPING_TIMEOUT, 1);
        const remainingTime = Math.max(TYPING_TIMEOUT - elapsed, 0);

        updateRingProgress(1 - progress);
        updateRingText(Math.ceil(remainingTime / 1000));

        if (progress >= 1) {
            clearInterval(ringTimer);
            ringTimer = null;
            isRingActive = false;
        }
    }, 50); // 每50ms更新一次，提供流畅的动画
}

function updateRingProgress(progress) {
    const ringProgress = document.getElementById('ring-progress');
    if (ringProgress) {
        const circumference = 2 * Math.PI * 25; // 圆的周长
        const offset = circumference * (1 - progress);
        ringProgress.style.strokeDashoffset = offset;
    }
}

function updateRingText(seconds) {
    const ringText = document.querySelector('.ring-text');
    if (ringText) {
        ringText.textContent = `${seconds}s`;
    }
}

function refreshTypingTimer() {
    // 重置主计时器，延长倒计时
    if (typingTimer) {
        clearTimeout(typingTimer);
    }

    // 设置新的倒计时，但不立即复制
    typingTimer = setTimeout(() => {
        console.log('倒计时结束，准备复制');
        onTypingStopped();
    }, TYPING_TIMEOUT);

    // 重新启动圆环动画，从3秒开始倒计时
    updateRingTimer();

    console.log('打字计时器已刷新，延长', TYPING_TIMEOUT/1000, '秒');
}

function showCopyNotification(text) {
    hideCopyNotification(); // 先移除已存在的通知

    const notification = document.createElement('div');
    notification.id = 'copy-notification';

    // 截取前50个字符作为预览
    const preview = text.length > 50 ? text.substring(0, 50) + '...' : text;
    notification.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 4px;">✅ 已复制到剪切板</div>
        <div style="font-size: 11px; opacity: 0.8;">${escapeHtml(preview)}</div>
    `;

    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #56ab2f 0%, #a8e063 100%);
        color: white;
        padding: 12px 18px;
        border-radius: 12px;
        font-size: 13px;
        max-width: 300px;
        z-index: 10001;
        box-shadow: 0 6px 20px rgba(0,0,0,0.2);
        animation: slideIn 0.3s ease-out;
    `;

    document.body.appendChild(notification);

    // 3秒后自动移除
    setTimeout(() => {
        hideCopyNotification();
    }, 3000);
}

function showTypingStoppedNotification() {
    const notification = document.createElement('div');
    notification.id = 'typing-notification';
    notification.innerHTML = '⚠️ 输入框为空，没有内容可复制';
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #ff6b6b 0%, #feca57 100%);
        color: white;
        padding: 12px 18px;
        border-radius: 12px;
        font-size: 13px;
        z-index: 10001;
        box-shadow: 0 6px 20px rgba(0,0,0,0.2);
        animation: slideIn 0.3s ease-out;
    `;

    document.body.appendChild(notification);

    // 2秒后自动移除
    setTimeout(() => {
        const notification = document.getElementById('typing-notification');
        if (notification) {
            notification.remove();
        }
    }, 2000);
}

function hideCopyNotification() {
    const notification = document.getElementById('copy-notification');
    if (notification) {
        notification.remove();
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 添加CSS动画
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeInOut {
        from { opacity: 0; transform: translateY(-10px); }
        to { opacity: 1; transform: translateY(0); }
    }

    @keyframes slideIn {
        from {
            opacity: 0;
            transform: translateX(100px);
        }
        to {
            opacity: 1;
            transform: translateX(0);
        }
    }

    @keyframes refreshPulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.1); }
        100% { transform: scale(1); }
    }

    .typing-ring-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        user-select: none;
    }

    .typing-ring {
        position: relative;
    }

    .typing-ring svg {
        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));
    }

    .ring-progress {
        transition: stroke-dashoffset 0.05s linear;
        filter: drop-shadow(0 0 3px rgba(102, 126, 234, 0.3));
    }

    .typing-label {
        font-size: 12px;
        font-weight: 600;
        color: #667eea;
        text-align: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .ring-text {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    }

    /* 悬停时的圆环效果 */
    .typing-ring-container:hover .ring-progress {
        filter: drop-shadow(0 0 6px rgba(102, 126, 234, 0.5));
    }

    /* 添加脉冲效果 */
    .typing-ring-container.pulse {
        animation: refreshPulse 0.3s ease-out;
    }
`;
document.head.appendChild(style);

// 页面卸载时清理
window.addEventListener('beforeunload', () => {
    if (typingTimer) {
        clearTimeout(typingTimer);
    }
    if (ringTimer) {
        clearInterval(ringTimer);
    }
    hideTypingIndicator();
    hideCopyNotification();
});

console.log("typingMonitor.js: 打字监听器已激活");