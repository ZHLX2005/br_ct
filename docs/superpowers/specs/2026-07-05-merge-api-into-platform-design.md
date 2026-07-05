# 合并 API 配置到平台页面 - 设计文档

**日期**: 2026-07-05
**分支**: feature/popup-image-ocr
**作者**: Claude (brainstorming + writing-plans)

---

## 目标

把 `options/api/` 子页面里的智谱 AI API 配置（BaseURL / API Key / Model）合并到 `options/platform/` 页面，让 options 侧边栏只保留一个"平台显示"入口即可管理所有相关配置。

合并后 `options/platform/` 页面同时承载：
- 平台可见性（哪些 AI 平台在主界面显示）
- 智谱 AI API 配置（用于划词翻译、OCR 调用）
- 图片 OCR 提示词（OCR 调用模板）

## 背景与现状

### 当前 options 子页面分布

| 子页面 | 路由 | 主要内容 |
|--------|------|---------|
| platform | `options/platform/index.html` | 平台可见性复选框 + OCR 提示词 textarea |
| api | `options/api/index.html` | 智谱 AI BaseURL / API Key / Model + 测试连接 |
| storage | `options/storage/index.html` | 本地存储管理 |
| notes | `options/notes/index.html` | 随手笔记 |
| prompts_editor | `options/prompts_editor/` | 提示词编辑 |
| local_cmd | `options/local_cmd/index.html` | 本地命令管理 |

### 关键存储键

- `platformVisibilitySettings` — platform 页面写入
- `translation.api.config` — api 页面写入；**被 `runjs/`、`backgroudtask/` 多个模块读取**
- `platformOcrPrompt` — platform 页面写入（OCR 提示词）

### 消费 `translation.api.config` 的模块

- `runjs/translation/content.js`
- `runjs/translation/content-ocr.js`
- `backgroudtask/translation/ocr.js`

它们都直接 `chrome.storage.local.get(['translation.api.config'])` 读 storage，**与 api 子页面是否还存在无关**。

## 决策记录（来自 brainstorming）

1. **导航处理**：删除 `options/api/` 目录；`options/options.html` 侧边栏移除 `data-page="api/index.html"` 入口。
2. **存储键**：保持 `translation.api.config` 不变，零下游影响。
3. **OCR 提示词位置**：合并后放到 API 配置**下方**。理由：API 是"用什么端点"，OCR 提示词是"端点内的调用模板"，逻辑流更顺。
4. **使用说明**：不保留。来自 `api/index.html` 的"使用说明"列表删除。

## 设计

### 合并后 `options/platform/index.html` 区块顺序（由上至下）

1. **平台可见性** — 原 `platform-grid` 复选框网格
2. **API 配置** — BaseURL / API Key / Model 三组 input + 测试连接按钮 + 保存/重置按钮（一个 button-group）
3. **图片 OCR 提示词** — textarea + blur 自动保存
4. **平台可见性保存/重置按钮**（单独 button-group）— 不与 API 按钮混在一起

### DOM 结构

```html
<section class="section section--compact">
  <!-- 区块 1: 平台可见性 -->
  <div class="section-divider"><div class="section-title">平台可见性</div></div>
  <div class="platform-grid" id="platform-grid">...</div>

  <div class="button-group">
    <button class="btn btn-primary" id="save-settings">保存设置</button>
    <button class="btn btn-secondary" id="reset-settings">重置为默认</button>
  </div>
</section>

<section class="section section--compact">
  <!-- 区块 2: API 配置 -->
  <div class="section-divider"><div class="section-title">API 配置</div></div>
  <div class="api-form">
    <div class="form-group"> BaseURL + 测试连接 </div>
    <div class="form-group"> API Key </div>
    <div class="form-group"> 模型名称 </div>
    <div id="test-result" class="test-result"></div>
    <div class="button-group">
      <button class="btn btn-primary" id="save-btn">保存设置</button>
      <button class="btn btn-secondary" id="reset-btn">重置为默认</button>
    </div>
    <div id="api-status-message" class="status-message"></div>
  </div>
</section>

<section class="section section--compact">
  <!-- 区块 3: OCR 提示词 -->
  <div class="section-divider"><div class="section-title">图片 OCR 提示词</div></div>
  <div class="ocr-prompt-config">
    <textarea id="ocr-prompt" rows="3"></textarea>
  </div>
</section>

<div id="status-message" class="status-message"></div>
```

**说明**：
- DOM 示例里 API 配置区块内部已经包含 `#test-result` 和 `#api-status-message`，结构为「BaseURL/Key/Model 三个 form-group → test-result → button-group → api-status-message」，所以该区块无需单独的 `<div id="api-status-message">` 在 button-group 之外 — 它就嵌在 `.api-form` 内、紧跟 button-group 之后。
- OCR 提示词区块**不再**有自己专属的 status-message —— 沿用页面级 `#status-message` 即可（设计段已说明）。

### JavaScript 行为 (`options/platform/platform.js`)

新增以下内容（来自原 `api/api.js`）：

- 模块级 DOM 引用：`baseURLInput` / `apiKeyInput` / `modelInput` / `baseURLStatus` / `apiKeyStatus` / `modelStatus` / `testResultDiv` / `apiStatusMessageDiv`（**与已有的 `statusMessage` 分离** — 各自保留自己的引用，避免互相覆盖提示）
- 常量：
  - `STORAGE_KEY = 'translation.api.config'`
  - `DEFAULT_CONFIG = { baseURL: 'https://open.bigmodel.cn/api/paas/v4', apiKey: '', model: 'glm-4.5v' }`
- 函数：
  - `loadAPISettings()` — 读 storage → 填三个 input → 调 `updateStatusDisplay()`
  - `updateStatusDisplay()` — 已配置 / 默认值 / 未配置 红绿点切换
  - `saveAPISettings()` — 校验 → `chrome.storage.local.set`
  - `resetToDefaults()` — input 值重置 → 提示「已重置为默认设置，请点击保存」
  - `testAPIConnection()` — fetch `${baseURL}/chat/completions` → 显示结果
  - `showAPITestResult(msg, type)` / `showAPIStatusMessage(msg, type)`

### 共享 vs 独立状态消息

| 区块 | 自己的 status-message | 显示什么 |
|------|----------------------|---------|
| 平台可见性 | 复用页面级 `#status-message` | 「设置已保存」 |
| API 配置 | 自带 `<div id="api-status-message">`（API button-group 下方） | 「设置已保存」/ 「请输入 API Key」 |
| OCR 提示词 | blur 自动保存，**复用页面级 `#status-message`** | 「OCR 提示词已保存」 |

**理由**：页面级状态消息 3 秒自动隐藏，OCR blur 后立即显示也走它，会与平台保存消息冲突。给 API 一个独立 `api-status-message` 可彻底解耦；OCR 提示与平台可见性共享页面级是合理的（两者都属"平台相关"配置，且不会同时触发）。

### chrome.runtime 消息

`platform.js` 启动时**注册一次** `chrome.runtime.onMessage` 监听器，分发：

```js
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'getPlatformVisibilitySettings') {
    const settings = {};
    PLATFORM_CONFIG keys 遍历 → checkbox.checked
    sendResponse({ settings });
  }
  if (request.action === 'getAPISettings') {
    const config = {
      baseURL: baseURLInput.value.trim(),
      apiKey: apiKeyInput.value.trim(),
      model: modelInput.value.trim()
    };
    sendResponse({ config });
  }
});
```

### 文件变更清单

| 动作 | 路径 |
|------|------|
| 修改 | `options/platform/index.html` |
| 修改 | `options/platform/platform.js` |
| 修改 | `options/options.html`（移除 API 导航项） |
| 删除 | `options/api/index.html` |
| 删除 | `options/api/api.js` |

### 不动的代码（验证过）

- `runjs/translation/content.js` — 直接读 storage，不依赖 api 页面
- `runjs/translation/content-ocr.js` — 同上
- `backgroudtask/translation/ocr.js` — 同上
- `config/platformConfig.js` — 与 api 配置无关
- `popup/` — popup 通过 storage 而非消息获取 api 配置；不受影响（待实施时再 grep 确认）

## 测试要点

1. 打开 `chrome-extension://.../options/options.html`，sidebar 只剩 5 个入口，不再有「API 配置」
2. 默认进入的就是 `platform/index.html`（即平台显示），三个区块并存
3. 在 API 配置输入 BaseURL 合法 URL + 任意 API Key + 模型名 → 点「测试连接」 → 状态区显示「正在测试...」→ 成功/失败反馈
4. 点「保存设置」(API) → 提示「设置已保存」
5. 改任意输入框 → 输入框上方的红绿点状态实时变化（已配置 / 默认值 / 未配置）
6. 点「重置为默认」(API) → 三个 input 重置为默认值
7. 改 OCR 提示词 textarea → 失焦后提示「OCR 提示词已保存」；刷新页面后值仍在
8. 取消勾选某平台 → 点「保存设置」(平台) → 提示「设置已保存」
9. 完全卸载扩展再重装（模拟清 storage） → API 默认值 = `https://open.bigmodel.cn/api/paas/v4` + model = `glm-4.5v`
10. 旧路径 `options/api/index.html` 在文件系统中已不存在（git status 无 `options/api/`）

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 状态消息冲突 | 拆为页面级（平台/OCR）+ API 独立级 |
| OCR blur 与平台保存共用消息时间窗 | OCR 消息显示 3s 自动消失；用户先点保存再改 OCR 也无副作用 |
| 删除 api 目录后 manifest 是否引用 | manifest.json 已知不引用具体子 HTML（待实施时确认） |
| dot-nav / switcher 渲染导航项是否硬编码 | 待实施时 grep `data-page` / api/index.html 字符串 |

## 不在本次范围

- 不改 `translation.api.config` 键名
- 不改任何 `runjs/` / `backgroudtask/` 代码
- 不动 CSS（`options.css` 已含所有 `.api-*` / `.form-*` / `.test-result` 类，无需新增）
- 不动 popup（已确认零依赖）
- 不引入新依赖 / npm 包
