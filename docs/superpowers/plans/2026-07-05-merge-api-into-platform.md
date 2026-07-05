# Merge API Config into Platform Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `options/api/` 子页面的智谱 AI API 配置（BaseURL / API Key / Model + 测试连接）合并到 `options/platform/` 页面，删除 `options/api/` 目录并移除 sidebar 入口；存储键 `translation.api.config` 保持不变。

**Architecture:** 单一页面扩展 + 两个 navigation 数据源同步删除。把 api.js 的 DOM 和 JS 行为整体内联到 `platform/index.html` 和 `platform.js`，用独立的 `#api-status-message` 解耦状态消息冲突。

**Tech Stack:** Vanilla JS（Chrome extension），Chrome storage API。零依赖。

## Global Constraints

- 存储键 `translation.api.config` 必须保持不变（决定 `runjs/` 和 `backgroudtask/` 大量模块零改动）
- API 默认常量：`baseURL = 'https://open.bigmodel.cn/api/paas/v4'`、`model = 'glm-4.5v'`、`apiKey = ''`（来自 spec 第 108 行）
- 测试连接请求：`POST ${baseURL}/chat/completions`，headers `Authorization: Bearer ${apiKey}`，body `{ model, messages: [{role:'user', content:'Hi'}], max_tokens: 10 }`
- 不动 `runjs/`、`backgroudtask/`、`popup/`、`config/` 任何代码
- 不改 `manifest.json`（已确认不引用具体 options 子路径）
- 不动 `options.css`（已含 `.api-*` / `.form-*` / `.test-result` / `.ocr-prompt-*` 等所有需要的类）
- 所有改动在分支 `feature/popup-image-ocr` 上提交，沿用 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

| 路径 | 动作 | 职责 |
|------|------|------|
| `options/platform/index.html` | Modify | 添加 API 配置区块 DOM（含 `#api-status-message`），把 OCR 提示词从顶部移至 API 下方 |
| `options/platform/platform.js` | Modify | 添加 API 配置的：DOM ref、load/save/reset/test、`updateStatusDisplay`、`getAPISettings` 消息处理、统一的初始化函数 |
| `options/options.html` | Modify | 删除 `<div class="nav-item" data-page="api/index.html">` 整段 |
| `options/options.js` | Modify | 删除 `NAV_ITEMS` 数组里的 `{ icon: 'API', name: 'API 配置', page: 'api/index.html' }` |
| `options/api/index.html` | Delete | 整体删除 |
| `options/api/api.js` | Delete | 整体删除 |
| `README.md` | Modify | 项目结构表里删除 api 行（FYI 文档） |

---

## Task 1: 修改 `options/platform/index.html` — 添加 API 配置区块 + 调整 OCR 顺序

**Files:**
- Modify: `options/platform/index.html:1-52`（整文件重写）

**当前结构**（顶部 → 底部）：
1. 图片 OCR 提示词 textarea（30-32 行）
2. 平台可见性 `<div class="platform-grid">`（35-37 行）
3. 平台保存/重置按钮（39-42 行）

**目标结构**（顶部 → 底部）：
1. 平台可见性 `<div class="platform-grid" id="platform-grid">`
2. 平台保存/重置 button-group（紧跟平台 grid 之后）
3. API 配置区块（含测试连接与保存/重置 button-group 和 `#api-status-message`）
4. 图片 OCR 提示词 textarea

**Interfaces:**
- Consumes: 无（这是布局修改）
- Produces: 文件中存在 DOM id `#baseurl-input` / `#apikey-input` / `#model-input` / `#baseurl-status` / `#apikey-status` / `#model-status` / `#test-btn` / `#test-result` / `#save-btn` / `#reset-btn` / `#api-status-message` / `#ocr-prompt` / `#platform-grid` / `#save-settings` / `#reset-settings` / `#status-message`

**Steps:**

- [ ] **Step 1: 重写 `options/platform/index.html`**

完整新文件内容：

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>平台显示设置</title>
    <link rel="stylesheet" href="../options.css" />
  </head>
  <body>
    <div class="page-container">
      <header class="page-header page-header--compact">
        <div class="page-header-row">
          <h1 class="page-title page-title--compact">平台显示设置</h1>
          <p class="page-description page-description--compact">
            选择您希望在主界面中显示的 AI 平台、管理 API 配置与图片 OCR 提示词。
          </p>
        </div>
      </header>

      <!-- 区块 1: 平台可见性 -->
      <section class="section section--compact">
        <div class="section-divider">
          <div class="section-title">平台可见性</div>
        </div>
        <div class="platform-grid" id="platform-grid">
          <!-- 平台选项将由 JavaScript 动态生成 -->
        </div>
        <div class="button-group">
          <button class="btn btn-primary" id="save-settings">保存设置</button>
          <button class="btn btn-secondary" id="reset-settings">重置为默认</button>
        </div>
      </section>

      <!-- 区块 2: API 配置 -->
      <section class="section section--compact">
        <div class="section-divider">
          <div class="section-title">API 配置</div>
        </div>
        <div class="api-form">
          <!-- API Base URL -->
          <div class="form-group">
            <div class="url-title">
              <label class="form-label">
                API Base URL
                <span id="baseurl-status" class="api-status not-configured">未配置</span>
              </label>
              <div class="button-row">
                <button class="btn btn-test" id="test-btn">测试连接</button>
              </div>
            </div>
            <input
              type="text"
              id="baseurl-input"
              class="form-input"
              placeholder="https://open.bigmodel.cn/api/paas/v4"
            >
            <p class="form-hint">智谱 AI API 的基础地址，通常为 https://open.bigmodel.cn/api/paas/v4</p>
          </div>

          <!-- API Key -->
          <div class="form-group">
            <label class="form-label">
              API Key
              <span id="apikey-status" class="api-status not-configured">未配置</span>
            </label>
            <input
              type="password"
              id="apikey-input"
              class="form-input"
              placeholder="请输入您的 API Key"
            >
            <p class="form-hint">在智谱 AI 开放平台获取您的 API Key</p>
            <p class="form-warning">API Key 将安全存储在浏览器本地，不会被上传到任何服务器</p>
          </div>

          <!-- Model -->
          <div class="form-group">
            <label class="form-label">
              模型名称
              <span id="model-status" class="api-status not-configured">未配置</span>
            </label>
            <input
              type="text"
              id="model-input"
              class="form-input"
              placeholder="glm-4.5v"
            >
            <p class="form-hint">推荐使用 glm-4.5v 进行 OCR 和文本处理</p>
          </div>

          <!-- 测试结果 -->
          <div id="test-result" class="test-result"></div>

          <!-- 按钮组 -->
          <div class="button-group">
            <button class="btn btn-primary" id="save-btn">保存设置</button>
            <button class="btn btn-secondary" id="reset-btn">重置为默认</button>
          </div>

          <div id="api-status-message" class="status-message"></div>
        </div>
      </section>

      <!-- 区块 3: 图片 OCR 提示词 -->
      <section class="section section--compact">
        <div class="section-divider">
          <div class="section-title">图片 OCR 提示词</div>
        </div>
        <div class="ocr-prompt-config">
          <label for="ocr-prompt" class="ocr-prompt-label">
            粘贴图片后，OCR 接口调用的提示词。识别结果将以 <code>[相关图片信息]</code> 段注入到用户输入框。
          </label>
          <textarea
            id="ocr-prompt"
            class="ocr-prompt-textarea"
            rows="3"
            placeholder="请识别这张图片中的所有文字内容"
          ></textarea>
        </div>
      </section>

      <div id="status-message" class="status-message"></div>
    </div>

    <script src="platform.js" type="module"></script>
    <script type="module" src="../focusScroll/init.js"></script>
  </body>
</html>
```

**关键检查点**：
- 顶部 `<p class="page-description">` 文案从「选择您希望在主界面中显示的 AI 平台。取消勾选将被隐藏，但不会影响已打开的标签页。」改为「选择您希望在主界面中显示的 AI 平台、管理 API 配置与图片 OCR 提示词。」
- 三个 `<section class="section section--compact">` 分别对应：平台可见性、API 配置、图片 OCR 提示词
- 平台保存/重置按钮放在**区块 1 内部**、紧跟 grid 之后（不挪到页面底部）
- API 按钮组内的 `#save-btn` / `#reset-btn` / `#test-btn` 与现有 `.btn-primary` / `.btn-secondary` / `.btn-test` 样式一致
- `#api-status-message` 紧跟 API button-group 后（同 section 内部）
- OCR 提示词区块**不**包含自己的 status-message（沿用页面级 `#status-message`）
- 页面级 `#status-message` 在 body 末尾、所有 section 之后（展示平台可见性 + OCR 的成功提示）

- [ ] **Step 2: 验证 HTML 在浏览器中能打开**

不需要手动验证 — 浏览器加载到这一步会因 JS 还没绑定事件处理器而 console 报错，这是预期的；下一步添加 JS 后会消失。在这一步只读取本地文件并打开：
打开方式：`file:///D:/code/a_js/app_ext/bro_chat/options/platform/index.html`
允许看到「未定义 API 配置的 event handler」之类的 warn 或 error —— **预期**。

- [ ] **Step 3: 提交**

```bash
cd 'D:/code/a_js/app_ext/bro_chat'
git add 'options/platform/index.html'
git -c user.name='claude' -c user.email='noreply@anthropic.com' commit -m "feat(platform): inline API config section into platform page"
```

---

## Task 2: 修改 `options/platform/platform.js` — 添加 API 配置逻辑

**Files:**
- Modify: `options/platform/platform.js:1-214`（新增函数；现有函数保持不变）

**Interfaces:**

- Consumes: `chrome.storage.local` API（已在项目中其他文件使用）
- Produces: 公开以下函数名供测试与协作任务识别：`loadAPISettings`、`updateStatusDisplay`、`saveAPISettings`、`resetToDefaults`、`testAPIConnection`、`showAPITestResult`、`showAPIStatusMessage`
- Produces: 模块级常量 `STORAGE_KEY = 'translation.api.config'`、`DEFAULT_CONFIG = { baseURL, apiKey, model }`

**Steps:**

- [ ] **Step 1: 在文件顶部现有常量之后插入 API 常量**

定位：在 `const DEFAULT_OCR_PROMPT = '请识别这张图片中的所有文字内容';` 之后插入新代码块，原内容**不删**。

```javascript
// API 配置存储
const STORAGE_KEY = 'translation.api.config';
const DEFAULT_CONFIG = {
  baseURL: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: '',
  model: 'glm-4.5v'
};

// API 配置 DOM 元素
let baseURLInput, apiKeyInput, modelInput;
let baseURLStatus, apiKeyStatus, modelStatus;
let testResultDiv, apiStatusMessageDiv;
```

不要写在文件顶部的全局变量声明区之后 —— 与现有 `let platformGrid;` / `let statusMessage;` 风格一致：在现有全局 let 声明之后插入。

- [ ] **Step 2: 在 `initializePlatformSettings()` 末尾追加 API 初始化调用**

定位：现有 `initializePlatformSettings` 函数最后一句（`bindEventListeners();`）之后追加：

```javascript
  // API 配置
  bindAPIDomElements();
  loadAPISettings();
```

**注意**：现有 `bindEventListeners()` 内已经包含 OCR 的 blur 自动保存 listener 绑定 —— 保持不动。新增的 API 事件绑定将在 Step 5 中追加到一个新的 `bindAPIEventListeners()` 函数里、并通过 `initializePlatformSettings` 调用。

- [ ] **Step 3: 新增 `bindAPIDomElements()`**

把这一段插在 `bindEventListeners()` 函数**之前**的位置：

```javascript
/**
 * 获取 API 配置相关 DOM 元素引用
 */
function bindAPIDomElements() {
  baseURLInput = document.getElementById('baseurl-input');
  apiKeyInput = document.getElementById('apikey-input');
  modelInput = document.getElementById('model-input');
  baseURLStatus = document.getElementById('baseurl-status');
  apiKeyStatus = document.getElementById('apikey-status');
  modelStatus = document.getElementById('model-status');
  testResultDiv = document.getElementById('test-result');
  apiStatusMessageDiv = document.getElementById('api-status-message');
}
```

- [ ] **Step 4: 新增 `loadAPISettings()` 与 `updateStatusDisplay()`**

把以下两个函数紧跟 `bindAPIDomElements()` 之后插入：

```javascript
/**
 * 加载 API 设置到表单
 */
function loadAPISettings() {
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    const config = result[STORAGE_KEY] || { ...DEFAULT_CONFIG };

    baseURLInput.value = config.baseURL || DEFAULT_CONFIG.baseURL;
    apiKeyInput.value = config.apiKey || '';
    modelInput.value = config.model || DEFAULT_CONFIG.model;

    updateStatusDisplay();
  });
}

/**
 * 更新 API 输入框旁的「已配置/默认值/未配置」状态显示
 */
function updateStatusDisplay() {
  // Base URL 状态
  if (baseURLInput.value && baseURLInput.value !== DEFAULT_CONFIG.baseURL) {
    baseURLStatus.textContent = '已配置';
    baseURLStatus.className = 'api-status configured';
  } else if (baseURLInput.value === DEFAULT_CONFIG.baseURL) {
    baseURLStatus.textContent = '默认值';
    baseURLStatus.className = 'api-status configured';
  } else {
    baseURLStatus.textContent = '未配置';
    baseURLStatus.className = 'api-status not-configured';
  }

  // API Key 状态
  if (apiKeyInput.value) {
    apiKeyStatus.textContent = '已配置';
    apiKeyStatus.className = 'api-status configured';
  } else {
    apiKeyStatus.textContent = '未配置';
    apiKeyStatus.className = 'api-status not-configured';
  }

  // Model 状态
  if (modelInput.value) {
    modelStatus.textContent = '已配置';
    modelStatus.className = 'api-status configured';
  } else {
    modelStatus.textContent = '未配置';
    modelStatus.className = 'api-status not-configured';
  }
}
```

- [ ] **Step 5: 新增 `saveAPISettings()` / `resetToDefaults()` / `testAPIConnection()` / `showAPITestResult()` / `showAPIStatusMessage()` / `bindAPIEventListeners()`**

紧跟 Step 4 的 `updateStatusDisplay` 之后插入：

```javascript
/**
 * 保存 API 设置
 */
function saveAPISettings() {
  const config = {
    baseURL: baseURLInput.value.trim(),
    apiKey: apiKeyInput.value.trim(),
    model: modelInput.value.trim()
  };

  if (!config.baseURL) {
    showAPIStatusMessage('请输入 API Base URL', 'error');
    return;
  }
  if (!config.apiKey) {
    showAPIStatusMessage('请输入 API Key', 'error');
    return;
  }
  if (!config.model) {
    showAPIStatusMessage('请输入模型名称', 'error');
    return;
  }

  chrome.storage.local.set({ [STORAGE_KEY]: config }, () => {
    showAPIStatusMessage('设置已保存', 'success');
    updateStatusDisplay();
    testResultDiv.style.display = 'none';
  });
}

/**
 * 重置为默认 API 设置（不自动保存）
 */
function resetAPIToDefaults() {
  baseURLInput.value = DEFAULT_CONFIG.baseURL;
  apiKeyInput.value = '';
  modelInput.value = DEFAULT_CONFIG.model;

  showAPIStatusMessage('已重置为默认设置，请点击保存', 'success');
  updateStatusDisplay();
}

/**
 * 测试 API 连接
 */
async function testAPIConnection() {
  const config = {
    baseURL: baseURLInput.value.trim(),
    apiKey: apiKeyInput.value.trim(),
    model: modelInput.value.trim()
  };

  if (!config.baseURL || !config.apiKey || !config.model) {
    showAPITestResult('请先填写完整的 API 配置信息', 'error');
    return;
  }

  showAPITestResult('正在测试连接...', 'info');

  try {
    const response = await fetch(`${config.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 10
      })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.choices && data.choices.length > 0) {
        showAPITestResult('连接成功，API 配置有效', 'success');
      } else {
        showAPITestResult('连接成功，但返回格式异常', 'error');
      }
    } else {
      const errorData = await response.json().catch(() => ({}));
      showAPITestResult(`连接失败：${errorData.error?.message || response.statusText}`, 'error');
    }
  } catch (error) {
    showAPITestResult(`连接失败：${error.message}`, 'error');
  }
}

/**
 * 显示 API 测试结果
 */
function showAPITestResult(message, type) {
  testResultDiv.textContent = message;
  testResultDiv.className = `test-result ${type}`;
  testResultDiv.style.display = 'block';
}

/**
 * 显示 API 区域状态消息（独立于平台可见性的页面级 #status-message）
 */
function showAPIStatusMessage(message, type = 'success') {
  apiStatusMessageDiv.textContent = message;
  apiStatusMessageDiv.className = `status-message show ${type}`;

  setTimeout(() => {
    apiStatusMessageDiv.classList.remove('show');
  }, 3000);
}

/**
 * 绑定 API 配置相关事件监听器
 */
function bindAPIEventListeners() {
  document.getElementById('save-btn').addEventListener('click', saveAPISettings);
  document.getElementById('reset-btn').addEventListener('click', resetAPIToDefaults);
  document.getElementById('test-btn').addEventListener('click', testAPIConnection);

  baseURLInput.addEventListener('input', updateStatusDisplay);
  apiKeyInput.addEventListener('input', updateStatusDisplay);
  modelInput.addEventListener('input', updateStatusDisplay);
}
```

**重要命名注意**：
- 重置函数命名为 `resetAPIToDefaults()`，**不是** `resetToDefaults()` —— 避免与现有 `resetToDefaults()`（平台可见性函数）冲突。
- 测试结果/状态消息以 `showAPITestResult` / `showAPIStatusMessage` 命名，与现有 `showStatusMessage` 区分。

- [ ] **Step 6: 在 `initializePlatformSettings()` 调用 `bindAPIEventListeners()`**

回到 Step 2 追加的代码块末尾（`loadAPISettings();` 之后）再追加一行：

```javascript
  bindAPIEventListeners();
```

最终 `initializePlatformSettings()` 函数末尾应包含：

```javascript
  // API 配置
  bindAPIDomElements();
  loadAPISettings();
  bindAPIEventListeners();
```

- [ ] **Step 7: 扩展 `chrome.runtime.onMessage` 监听器以分发 `getAPISettings`**

定位：现有 `bindEventListeners()` 函数末尾的 `chrome.runtime.onMessage.addListener(...)`（约 199-211 行）。在原来 `if (request.action === 'getPlatformVisibilitySettings') { ... }` 块的 `}` 之后**追加**一个 `else if`：

```javascript
    if (request.action === 'getAPISettings') {
      const config = {
        baseURL: baseURLInput.value.trim(),
        apiKey: apiKeyInput.value.trim(),
        model: modelInput.value.trim()
      };
      sendResponse({ config });
    }
```

完整监听器结构为：

```javascript
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'getPlatformVisibilitySettings') {
      const settings = {};
      Object.keys(PLATFORM_CONFIG).forEach(platformId => {
        const checkbox = document.getElementById(`platform-${platformId}`);
        if (checkbox) {
          settings[platformId] = checkbox.checked;
        }
      });
      sendResponse({ settings });
    } else if (request.action === 'getAPISettings') {
      const config = {
        baseURL: baseURLInput.value.trim(),
        apiKey: apiKeyInput.value.trim(),
        model: modelInput.value.trim()
      };
      sendResponse({ config });
    }
  });
```

- [ ] **Step 8: 浏览器内验证整页行为**

打开 `chrome-extension://<id>/options/options.html`：
1. 默认进入 `platform/index.html`
2. 应看到：平台复选框、平台按钮组、API 三组 input + 测试/保存/重置、API 状态位、OCR 提示词 textarea
3. 改任意 API input → 输入框旁的红绿点状态实时变化
4. 点「测试连接」→ 测试结果框出现
5. 点「保存设置」→ API 状态消息区显示「设置已保存」
6. 点「重置为默认」→ 三个 input 回到默认值，状态消息「已重置为默认设置，请点击保存」
7. OCR 提示词 textarea 改完失焦 → 底部 `#status-message` 短暂显示「OCR 提示词已保存」
8. 平台可见性的勾选 → 点「保存设置」→ 底部 `#status-message`「设置已保存」
9. 同时改 OCR + 点 API 保存 → 两条消息分别在自己所属区域显示，互不覆盖

- [ ] **Step 9: 提交**

```bash
cd 'D:/code/a_js/app_ext/bro_chat'
git add 'options/platform/platform.js'
git -c user.name='claude' -c user.email='noreply@anthropic.com' commit -m "feat(platform): add API config logic (load/save/reset/test)"
```

---

## Task 3: 从 `options/options.html` 删除 API 导航项

**Files:**
- Modify: `options/options.html:31-34`

**Steps:**

- [ ] **Step 1: 删除 `<div class="nav-item" data-page="api/index.html">…</div>` 整段**

定位并删除（精确匹配，包括前后缩进）：

```html
          <div class="nav-item" data-page="api/index.html">
            <span class="nav-icon">API</span>
            <span>API 配置</span>
          </div>
```

文件结构：这段原本在 line 31-34 之间，是 `<nav class="sidebar-nav">` 内的第二个 nav-item（紧跟「平台显示」之后，「存储管理」之前）。删除后位置空缺由相邻 nav-item 自动收敛，**不需插入任何替代元素**。

- [ ] **Step 2: 验证默认加载页面仍是 platform**

打开 `options/options.html`：
- sidebar 应只剩 5 个 nav-item：平台显示、存储管理、随手笔记、提示词编辑、本地命令管理
- 默认 iframe 内容仍为 `platform/index.html`

- [ ] **Step 3: 提交**

```bash
cd 'D:/code/a_js/app_ext/bro_chat'
git add 'options/options.html'
git -c user.name='claude' -c user.email='noreply@anthropic.com' commit -m "refactor(options): remove API config nav-item from sidebar"
```

---

## Task 4: 从 `options/options.js` 删除 `NAV_ITEMS` 里的 API 条目

**Files:**
- Modify: `options/options.js:38-45`

**Interfaces:**
- 现有代码：`getNavIndexByPage`、`getCyclicPageByDirection`、`initNavRing`、`initSwitcher`、`navigateToPage` 都依赖 `NAV_ITEMS`。
- 一旦移除 API 条目，原来的 `getNavIndexByPage('api/index.html')` 会返回 `-1` —— 已知在 `getCyclicPageByDirection` 里有 `if (currentIndex === -1) currentIndex = 0;` 兜底，**无需额外修改**。同理 `initNavRing` / `initSwitcher` 只遍历 `NAV_ITEMS`，自动收敛。

**Steps:**

- [ ] **Step 1: 删除 API 那行**

定位 `const NAV_ITEMS = [` 数组中的 `{ icon: 'API', name: 'API 配置', page: 'api/index.html' },` 一行（包括尾随逗号），删除。

最终数组应为：

```javascript
const NAV_ITEMS = [
  { icon: 'PL', name: '平台显示', page: 'platform/index.html' },
  { icon: 'DB', name: '存储管理', page: 'storage/index.html' },
  { icon: 'NT', name: '随手笔记', page: 'notes/index.html' },
  { icon: 'PR', name: '提示词编辑', page: 'prompts_editor/prompts_editor.html' },
  { icon: 'CMD', name: '本地命令管理', page: 'local_cmd/index.html' },
];
```

- [ ] **Step 2: 验证 dot-nav / switcher**

打开 `options/options.html`，试：
1. 悬浮圆环（dot-nav）：只剩 5 个圆点 + 退出按钮
2. Win+Tab 切换器（switcher overlay）：只剩 5 个面板
3. 上下方向键在 nav 间循环 —— 不应因长度变化而崩

- [ ] **Step 3: 提交**

```bash
cd 'D:/code/a_js/app_ext/bro_chat'
git add 'options/options.js'
git -c user.name='claude' -c user.email='noreply@anthropic.com' commit -m "refactor(options): drop API page from NAV_ITEMS"
```

---

## Task 5: 删除 `options/api/` 目录

**Files:**
- Delete: `options/api/index.html`
- Delete: `options/api/api.js`

**Steps:**

- [ ] **Step 1: 删除整个目录**

```bash
cd 'D:/code/a_js/app_ext/bro_chat'
rm -rf 'options/api/'
ls 'options/'  # 确认输出不再含 'api'
```

期望输出（剩余子目录）：

```
focusScroll
local_cmd
notes
options.css
options.html
options.js
platform
prompts_editor
storage
```

- [ ] **Step 2: 全仓 grep 防止遗漏引用**

```bash
cd 'D:/code/a_js/app_ext/bro_chat'
grep -rIn --include='*.html' --include='*.js' --include='*.json' 'api/index\.html'
grep -rIn --include='*.html' --include='*.js' --include='*.json' 'options/api/'
grep -rIn --include='*.html' --include='*.js' --include='*.json' "name: 'API 配置'"
```

期望输出：除 `README.md` 之外全部为空（README 修改见 Task 6）。

- [ ] **Step 3: 提交**

```bash
cd 'D:/code/a_js/app_ext/bro_chat'
git add -u 'options/api/'
git -c user.name='claude' -c user.email='noreply@anthropic.com' commit -m "refactor(options): remove obsolete api/ subpage"
```

---

## Task 6: 更新 `README.md` 项目结构表（FYI 文档）

**Files:**
- Modify: `README.md:349`（项目结构段对 api/ 的描述行）

**Steps:**

- [ ] **Step 1: 删除 README 里对 `api/` 子目录的描述**

定位 `README.md:349` 区域，找到类似：
```
│   ├── api/                        # API 配置
```
删除该行（包括前导的 `│   ├── ` 与尾部换行）。

如果 README 的说明文字中明确提到「独立的 API 配置页面」，需要把那段也一起修改成「API 配置已合并到平台显示页面」之类的措辞。**待实际编辑时根据上下文判断**——保持最小改动原则。

- [ ] **Step 2: 提交**

```bash
cd 'D:/code/a_js/app_ext/bro_chat'
git add 'README.md'
git -c user.name='claude' -c user.email='noreply@anthropic.com' commit -m "docs(readme): remove obsolete api/ entry from project structure"
```

---

## Task 7: 端到端验证 + 最终清点

**Steps:**

- [ ] **Step 1: 完整 reload 扩展**

在 `chrome://extensions/` 找到本扩展，点「刷新」按钮（确保缓存清空）。

- [ ] **Step 2: 逐项核对测试要点**（来自 spec 第 168-178 行）

| # | 操作 | 期望 | 通过 |
|---|------|------|------|
| 1 | 打开 options 页面 | sidebar 只剩 5 个入口 | ☐ |
| 2 | 默认进入的是 platform 页 | 三个区块都在 | ☐ |
| 3 | API 输入 → 点测试连接 | 测试结果显示 | ☐ |
| 4 | API 点「保存设置」 | API 区域状态消息「设置已保存」 | ☐ |
| 5 | 改任一 API 输入 | 红绿点实时变化 | ☐ |
| 6 | API 点「重置为默认」 | 三个 input 回到默认值 | ☐ |
| 7 | OCR 提示词 blur | 底部状态消息「OCR 提示词已保存」 | ☐ |
| 8 | 平台勾选 → 保存 | 底部状态消息「设置已保存」 | ☐ |
| 9 | 清空扩展数据 → 重新打开 | API 默认值 = bigmodel URL + glm-4.5v | ☐ |
| 10 | git status | `options/api/` 彻底消失 | ☐ |

- [ ] **Step 3: 验证 storage 键不变**

在 `chrome://extensions/` → 扩展的「service worker」console 里：

```javascript
chrome.storage.local.get(['translation.api.config'], console.log);
```

期望：返回 `{ 'translation.api.config': { baseURL, apiKey, model } }`。证明 key 名未被改名。

- [ ] **Step 4: 验证 popup / 内容脚本功能未受影响**

打开 `chrome-extension://<id>/popup/main/main.html`（如启用）：
1. 触发任意使用翻译 API 的功能（划词翻译 / OCR / popup 提问）
2. 行为应与合并前一致（API 配置仍以同样方式从 `translation.api.config` 读取）

- [ ] **Step 5: 最终 git log**

```bash
cd 'D:/code/a_js/app_ext/bro_chat'
git log --oneline -10
```

期望 5-6 个新提交按 Task 顺序排列，每个 task 一次提交。

---

## 实施完成检查表（实施者自填）

- [ ] Task 1 — `options/platform/index.html` 已重写并提交
- [ ] Task 2 — `options/platform/platform.js` 已添加 API 逻辑并提交
- [ ] Task 3 — `options/options.html` 已移除 API nav-item 并提交
- [ ] Task 4 — `options/options.js` 已移除 `NAV_ITEMS` 中 API 条目并提交
- [ ] Task 5 — `options/api/` 目录已彻底删除并提交
- [ ] Task 6 — `README.md` 已更新并提交
- [ ] Task 7 — 端到端验证全部通过
