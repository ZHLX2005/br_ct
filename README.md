# Bro Chat (AI Assistant) - 全能AI多平台助手

<div align="center">

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green?style=for-the-badge)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-orange?style=for-the-badge)
![ES6+](https://img.shields.io/badge/JavaScript-ES6+-yellow?style=for-the-badge)
![Go Native](https://img.shields.io/badge/Go-Native-blue?style=for-the-badge)

**一键同时发送消息到15个AI平台 | 翻译OCR | Git批量管理 | 自定义脚本 | 完全自定义提示词**

[功能介绍](#核心功能) • [技术架构](#技术架构) • [快速开始](#快速开始) • [开发指南](#开发指南)

[English](./README.en.md)

</div>

---

## 项目简介

**Bro Chat** 是一个功能极其强大的 Chrome 扩展，解决以下核心痛点：

- **多平台切换繁琐**：一次输入，同时发送给所有/多个AI平台
- **重复劳动**：统一界面 + 提示词模板 + 快捷键
- **工具分散**：翻译、OCR、Git管理、笔记、视频控制全部集成
- **效率低下**：自定义脚本、DOM监控、复制hook等高级功能

---

## 核心功能

### AI 平台消息广播 🚀

**支持 15 个主流AI平台**，一键同时发送消息：

| 平台 | 名称 | 官网 |
|------|------|------|
| 元宝 | 腾讯元宝 | yuanbao.tencent.com |
| Gemini | Google Gemini | gemini.google.com |
| ChatGPT | OpenAI | chatgpt.com |
| Claude | Anthropic | claude.ai |
| 豆包 | 字节跳动 | doubao.com |
| 智谱 | 智谱AI | chatglm.cn |
| 通义 | 阿里通义 | qianwen.com |
| GAS | Google AI Studio | aistudio.google.com |
| Grok | xAI | grok.com |
| NotionAI | Notion | notion.so |
| Zai | Z.ai | chat.z.ai |
| DeepSeek | DeepSeek | chat.deepseek.com |
| Kimi | 月之暗面 | kimi.com |
| CoderQwen | 阿里码模型 | coder.qwen.ai |
| Coze | 扣子 | coze.cn |

**核心特性**：
- 智能任务队列，支持**串行**和**并发**两种处理模式（默认3并发）
- 自动标签页管理（查找/创建/激活/复用）
- 动态脚本注入，无需手动配置
- 平台可见性独立配置，可隐藏不需要的平台
- **AI响应监听**：自动捕获各平台回复内容

### 提示词模板系统 📝

**完全自定义提示词**，内置丰富的提示词模板库：

#### 代码生成类 (`code_gen`)
| 模板 | 别名 | 说明 |
|------|------|------|
| 完整代码输出 | `/full` | 输出完整文件结构和代码 |
| 异常日志 | `/err` | 打印完整异常上下文 |
| 接口功能 | `/api` | 生成可靠可用的接口代码 |
| 文档生成案例 | `/doc` | 生成可直接运行的demo |
| 帮助我修复bug | `/fix` | 多种修复方案 |
| 你无法修复这个bug | `/debug` | 排除思路而非答案 |

#### 代码优化类 (`custom_design`)
| 模板 | 别名 | 说明 |
|------|------|------|
| vue模板 | `/vue` | 生成Vue代码 |
| 生成bat文件 | `/bat` | Windows批处理脚本 |
| docker运行 | `/docker` | 生成Docker Run和Compose |
| 识别器设计模式 | `/recognizer` | Go识别器模式 |
| channel设计模式 | `/channel` | Go协程池+channel任务 |
| 结构体Option模式 | `/option` | Go Functional Options |
| mermaid图表 | `/mermaid` | 生成流程图 |
| Mysql数据库设计 | `/mysql` | 规范建表语句 |

#### 其他类 (`other`, `analyze_plan`, `read`, `search`)
- `/prompt` - 封装提示词
- `/roar` - 满腔愤怒的批评
- `/buy` - 购物建议
- `/src` - 静态资源封装
- `/give` - 导出对话到其他AI
- `/ques` - 导出提示词问题清单

**`/alias` 快捷输入**：在输入框输入 `/err` 自动展开对应提示词模板

### 翻译与 OCR 📖

- **划词翻译**：选中文本即时显示翻译结果，支持多语言
- **图片OCR**：批量识别图片中的文字，提取率高
- **Markdown渲染**：支持 Markdown 格式和 KaTeX 数学公式
- **划词快捷提问**：选中文字 → 弹出面板 → 直接发送给AI

### 快捷键绑定 ⌨️

| 快捷键 | 功能 | 说明 |
|--------|------|------|
| `Alt+C` | div_copy | 复制页面 div 元素内容 |
| `Alt+D` | imgs_picker | 图片选择器，批量选取页面图片 |
| `Alt+F` | copy_file | 剪贴板内容保存为文件 |
| `Alt+B` | binddom | DOM 元素绑定点击事件 |
| `三击空格` | tripleSpace | 快速调用 AI 助手 |
| `Ctrl+S` | (输入框) | 手动保存当前输入 |

### 圆形导航菜单 🎯

- **悬浮激活**：鼠标悬浮在圆形图标上自动展开
- **拖动定位**：拖动到屏幕任意位置，自动记忆
- **右键添加**：右键任意链接 → "添加到圆形菜单"
- **历史记录**：自动显示最近24小时浏览历史
- **智能导航**：相同域名自动复用标签页

### 本地命令管理 💻

基于 Go 原生 Host，提供强大的本地开发工具：

#### Git 批量管理
- 批量查看多个仓库的 Git 状态
- 一键 Pull/Push/Fetch
- **自动提交推送**：有变更的仓库自动提交并推送
- 有变更的项目优先显示

#### 进程管理
- 查看运行中的进程
- 启动/停止/移除进程

#### Skill 管理
- 中心仓库 Skill 同步
- 项目 Skill 导入导出
- Skill 冲突检测

#### 命令模板
- 保存常用命令
- 一键执行
- 支持工作目录、命令、参数配置

### 自定义脚本系统 🔧

强大的 `funcs/` 函数库，涵盖各种实用工具：

#### 元素 DOM 操作
| 脚本 | 功能 |
|------|------|
| `div_copy_wrapper.js` | 复制页面 div 元素 |
| `div_Img_wrapper.js` | 图片选择器（38KB） |
| `div_counter.js` | 页面元素计数器 |
| `div_input_wrapper.js` | div输入框操作 |
| `div_changer_wrapper.js` | div内容修改器 |
| `dom_visibility_controller.js` | DOM显隐控制 |
| `color_show.js` | 颜色显示工具 |
| `xpath_batch_copy.js` | 批量XPath复制 |

#### 视频控制
| 脚本 | 功能 |
|------|------|
| `videoControllerPlane/videoPlane.js` | 视频控制面板（75KB） |
| `video/frame.js` | 逐帧控制 |
| `video/videoop.js` | 视频操作工具 |

#### 平台专属
| 脚本 | 平台 |
|------|------|
| `bili/` | B站视频、专栏、用户 |
| `leecode/` | LeetCode |
| `腾讯文档/` | 腾讯文档 |
| `boss直聘/` | Boss直聘 |

#### 实验性功能 (`x/`)
| 脚本 | 功能 |
|------|------|
| `typingMonitor/` | 输入监控 |
| `watching_dom/` | DOM变化监控 |
| `复制操作的hook/` | 复制操作拦截 |
| `展示效果/` | 页面特效（海浪等） |

### 侧边栏 AI 响应捕获 🎯（核心亮点）

**完全自研的 CDP 响应捕获系统**，无需 API key，实时监听各平台 AI 回复：

| 功能 | 说明 |
|------|------|
| **CDP 实时捕获** | 通过 Chrome Debugger Protocol 捕获 ChatGPT 响应内容 |
| **复制预览** | 自动显示最近一次复制操作的内容预览 |
| **流式输出** | 支持流式响应实时显示，带打字机效果 |
| **Markdown 渲染** | 自动渲染代码块、链接、表格等 |
| **多平台适配** | 每个平台有独立的 ResponseListener |
| **会话追踪** | 按平台 + 会话 ID 追踪，确保捕获正确对话 |
| **一键复制** | 点击按钮复制完整回复内容 |
| **折叠/展开** | 大段回复可折叠，节省空间 |

### 随手笔记 📌

快速记录临时笔记，持久化存储，支持 Markdown 格式。

### 倒计时面板 ⏱️

- 多种计时模式
- 历史记录保存
- 视觉效果丰富

### AI 响应监听 🎧

自动捕获各AI平台的回复内容：
- ChatGPT、Claude、Gemini、DeepSeek 等平台适配
- 统一格式存储
- 便于后续分析

### ChatGPT CDP 自动化 📋

通过 Chrome Debugger Protocol 实现 ChatGPT 内容复制，支持：
- 自动化内容提取
- 跨对话操作

### HTML 文本提取 📄

提取页面文本内容，支持：
- 净化处理
- 格式保留
- 批量提取

---

## 技术架构

### 核心技术栈

| 技术 | 用途 |
|------|------|
| JavaScript (ES6+ Modules) | 前端核心 |
| Go | Native Host 原生扩展 |
| Chrome Extensions Manifest V3 | 扩展标准 |
| chrome.storage.local | 数据存储 |
| chrome.scripting.executeScript | 脚本注入 |
| Chrome Debugger Protocol | CDP 自动化 |
| Native Messaging | 浏览器与原生程序通信 |

### 分层架构

```
┌─────────────────────────────────────────────────────────┐
│                      UI 层                              │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐ │
│  │  Popup  │  │ Sidebar │  │ Options │  │ Context │ │
│  │         │  │         │  │  Pages  │  │  Menu   │ │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘ │
├─────────────────────────────────────────────────────────┤
│                     服务层 (Service Worker)             │
│  ┌────────────────┐  ┌────────────────┐               │
│  │ ai_platform_   │  │ func_executor  │               │
│  │ processor       │  │                │               │
│  ├────────────────┤  ├────────────────┤               │
│  │ gotoServer     │  │ backupService  │               │
│  ├────────────────┤  ├────────────────┤               │
│  │ translation     │  │ binddom        │               │
│  ├────────────────┤  ├────────────────┤               │
│  │ html_text_     │  │ native_relay   │               │
│  │ reader          │  │                │               │
│  └────────────────┘  └────────────────┘               │
├─────────────────────────────────────────────────────────┤
│                    适配层 (Content Scripts)            │
│  yuanbao │ gemini │ chatgpt │ claude │ doubao │ ...   │
│  chatResponse/ (AI响应监听)                            │
├─────────────────────────────────────────────────────────┤
│                    运行层 (runjs/)                      │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐ │
│  │ Circular │  │ Triple  │  │Transla- │               │ │
│  │  Menu   │  │  Space  │  │  tion   │               │ │
│  └─────────┘  └─────────┘  └─────────┘               │ │
├─────────────────────────────────────────────────────────┤
│                    原生层 (Go Native Host)              │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐ │
│  │  Git    │  │  File   │  │ Process │  │Prompts  │ │
│  │ Monitor │  │   Ops   │  │ Manager │  │         │ │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 统一配置架构

所有平台配置集中在 `config/platformConfig.js`，添加新平台只需修改此文件：

```javascript
export const PLATFORM_CONFIG = {
  yourplatform: {
    name: 'YourPlatform',
    icon: 'Y',
    shortIcon: 'Y',
    color: '#ff0000',
    url: 'https://example.com',
    defaultVisible: true
  }
};
```

---

## 项目结构

```
bro_chat/
├── manifest.json                    # Manifest V3 配置
├── background.js                   # Service Worker 入口
├── config/
│   └── platformConfig.js            # 平台统一配置
│
├── popup/                           # 弹窗界面
│   └── main/
│       ├── main.html/js/css        # 核心 UI
│       ├── mainUtils.js            # 工具函数（提示词、历史、发送）
│       ├── platformRenderer.js     # 平台渲染
│       ├── dragDropHandler.js      # 拖拽处理
│       ├── modules/
│       │   ├── storage.js          # 存储管理
│       │   ├── platformVisibility.js # 平台可见性
│       │   └── uiHelpers.js        # UI 辅助函数
│       └── prompts/                # 提示词模板
│           ├── prompts.js          # 模板定义
│           ├── promptsUI.js        # UI 渲染
│           └── groups/             # 模板分组
│               ├── code_gen.js     # 代码生成
│               ├── analyze_plan.js # 分析规划
│               ├── custom_design.js # 代码优化
│               ├── read.js         # 阅读辅助
│               ├── search.js       # 搜索辅助
│               └── other.js        # 其他
│   ├── func_execute/              # 函数执行 UI
│   ├── translation/                # 翻译 UI
│   └── binddom/                    # DOM绑定 UI
│
├── sidebar/                         # 侧边栏
│   └── main/
│       ├── main.html/js/css
│       └── mainUtils.js
│
├── options/                         # 设置页面
│   ├── options.html/js/css         # 主页面 + 导航
│   ├── platform/                   # 平台可见性配置
│   ├── api/                        # API 配置
│   ├── storage/                    # 存储管理
│   ├── menu/                       # 圆形菜单配置
│   ├── notes/                      # 随手笔记
│   ├── ocr/                        # OCR 批量识别
│   ├── countdown/                   # 倒计时面板
│   │   ├── countdown.js            # 倒计时逻辑
│   │   └── history.js             # 历史记录
│   ├── prompts_editor/             # 提示词编辑器
│   │   ├── prompts_editor.html/js
│   │   └── (支持创建/编辑/删除模板)
│   └── local_cmd/                  # 本地命令管理
│       ├── git.js                  # Git 批量管理
│       ├── skill.js                # Skill 管理
│       ├── command.js              # 命令模板
│       └── core.js                 # 核心函数
│
├── contentScripts/                  # AI 平台适配脚本
│   ├── yuanbao.js ~ coze.js        # 15个平台适配
│   └── chatResponse/               # AI 响应监听
│       ├── responseListenerCore.js # 监听核心
│       └── *ResponseListener.js    # 各平台适配
│
├── backgroudtask/                   # 后台服务模块
│   ├── ai_platform_processor.js    # AI 平台任务队列
│   ├── func_executor.js            # 函数执行器
│   ├── gotoServer.js               # 导航/菜单服务
│   ├── backupService.js            # 备份服务
│   ├── chatgpt_copy_automation.js  # ChatGPT CDP 自动化
│   ├── message_http_server.js       # 消息服务
│   ├── video_plane_server.js       # 视频片段配置
│   ├── platformScriptFiles.js      # 平台脚本管理
│   ├── binddom/                    # DOM 绑定服务
│   ├── translation/                # 翻译/OCR 模块
│   ├── html_text_reader/           # HTML 文本提取
│   └── native_relay/               # Native Host 中继
│
├── native_host/                     # Go 原生消息主机
│   ├── main.go                     # 入口
│   ├── go.mod/go.sum               # 依赖
│   ├── internal/
│   │   ├── executor/               # 命令执行
│   │   ├── fileops/               # 文件操作
│   │   ├── gitmon/                # Git 监控
│   │   ├── handler/               # 消息处理
│   │   ├── prompts/               # 提示词管理
│   │   └── protocol/              # 协议处理
│   └── brochat_native_host.exe    # 编译后的可执行文件
│
├── runjs/                          # 页面注入脚本
│   ├── goto/                       # 圆形菜单
│   │   └── goto.js
│   ├── tripleSpace/                # 三击激活
│   │   └── tripleSpace.js
│   ├── word/                       # Word 集成
│   │   └── word.js
│   ├── translation/                # 翻译覆盖层
│   │   ├── content.js             # 翻译主脚本
│   │   ├── content-ocr.js         # OCR 脚本
│   │   ├── selection-ask.js       # 划词提问
│   │   └── lib/
│   │       ├── marked.min.js
│   │       └── katex.min.js
│   └── bilibiliCleaner/            # B站视频页清理
│
├── funcs/                          # 可执行函数库
│   ├── 元素dom/                    # DOM 操作工具
│   │   ├── div_copy_wrapper.js
│   │   ├── div_Img_wrapper.js     # 38KB 图片选择器
│   │   ├── div_counter.js
│   │   ├── div_input_wrapper.js
│   │   ├── div_changer_wrapper.js
│   │   ├── dom_visibility_controller.js
│   │   ├── color_show.js
│   │   ├── xpath_batch_copy.js
│   │   └── videoControllerPlane/
│   │       └── videoPlane.js      # 75KB 视频控制面板
│   ├── 平台专属/                   # 平台特定功能
│   │   ├── bili/
│   │   ├── leecode/
│   │   ├── 腾讯文档/
│   │   └── boss直聘/
│   └── x/                          # 实验性功能
│       ├── typingMonitor/          # 输入监控
│       ├── watching_dom/           # DOM监控
│       ├── 复制操作的hook/         # 复制拦截
│       └── 展示效果/               # 页面特效
│
└── icons/                          # 扩展图标
```

---

## 快速开始

### 一键安装（AI 自动执行）

> 如果你正在使用 AI 助手，可以直接下达指令：
>
> **"Set up https://github.com/ZHLX2005/br_ct for me."**
>
> **"Read `res/install.md` and follow the steps to install the extension and compile the native host for me."**
>
> AI 会自动完成：Go 环境检查 → native host 编译 → 注册表写入，并提示你手动加载扩展。

### 手动安装步骤

1. **克隆项目**
   ```bash
   git clone https://github.com/ZHLX2005/br_ct.git
   cd br_ct
   ```

2. **安装 Native Host（首次需要手动运行，后续浏览器自动拉起）**
   ```bash
   cd ext/native_host
   go build -o brochat_native_host.exe .
   ./brochat_native_host.exe
   ```
   执行后会自动写入注册表和 manifest，看到 `Native host registered at: ...` 即可关闭。

3. **加载扩展**
   - 打开 Chrome/Edge，访问 `chrome://extensions/`
   - 开启"开发者模式"
   - 点击"加载已解压的扩展程序"
   - 选择项目 `ext` 目录

### 基本使用

#### 发送消息到多个AI平台

1. 点击扩展图标打开 popup
2. 输入 `/` 查看可用快捷指令，或选择提示词模板
3. 选择目标平台（可多选/全选）
4. 输入消息内容
5. 点击发送 → 消息同时发送到所有选中平台

#### 使用提示词模板

- 输入 `/err` 自动展开"异常日志"模板
- 输入 `/fix` 自动展开"修复bug"模板
- 更多模板见上表

#### 使用侧边栏

1. 右键扩展图标 → "打开侧边栏"
2. 侧边栏提供与 popup 相同的功能

#### 使用圆形菜单

1. **悬浮展开**：鼠标悬浮在圆形图标上
2. **拖动定位**：按住拖动到合适位置
3. **右键添加**：在任意链接/页面右键选择"添加到圆形菜单"

---

## 开发指南

### 添加新的AI平台

只需修改 `config/platformConfig.js`：

```javascript
export const PLATFORM_CONFIG = {
  yourplatform: {
    name: 'YourPlatform',
    icon: 'Y',
    shortIcon: 'Y',
    color: '#ff0000',
    url: 'https://example.com',
    defaultVisible: true
  }
};
```

然后创建 `contentScripts/yourplatform.js`（参考 `platform.template.js`）

### 添加新的提示词模板

在 `popup/main/prompts/groups/` 中创建或修改文件：

```javascript
export default [
  {
    "label": "模板名称",
    "alias": "alias",  // 快捷别名，输入 /alias 使用
    "template": "模板内容 %s 占位符"
  }
];
```

### 添加新的功能函数

1. 创建文件 `funcs/{category}/{functionName}.js`
2. 导出 `main` 函数
3. 在 manifest.json 中注册快捷键（可选）

---

## 更新日志

### v1.5.x

- 新增 5 个AI平台：Zai, DeepSeek, Kimi, CoderQwen, Coze
- 新增侧边栏支持
- 新增 AI 响应监听功能
- 新增本地命令管理（Git监控、Skill管理、命令模板）
- 新增随手笔记功能
- 新增 OCR 批量识别
- 新增倒计时面板
- 新增视频片段标注功能
- 新增划词快捷提问
- 新增 ChatGPT CDP 自动化
- 新增 HTML 文本提取
- 优化圆形菜单体验
- 优化设置页面 UI

---

<div align="center">

**如果这个项目对您有帮助，请给一个 ⭐️ 支持！**

项目地址: [GitHub](https://github.com/ZHLX2005/br_ct)

</div>
