---
name: code-standards-guide
description: 当需要在 bro_chat 扩展项目中的 funcs/、runjs/、backgroudtask/ 三个目录下新增、修改、迁移代码模块时触发。本 skill 是一份极简导航：每个目录的规范独立完整地保留在 references/ 子文档中，本文档只做"该看哪一份"的指引。
---

# bro_chat 代码规范导航

本扩展有三层脚本架构，每个目录有独立的代码规范。**本文档不做内容复制** — 所有具体规范都在 `references/` 子文档里完整保留。

## 三层架构

```
┌────────────────────────────────────────────────────────────────┐
│                        popup / sidebar                          │  ← 用户界面层
├────────────────────────────────────────────────────────────────┤
│  funcs/         runjs/         backgroudtask/                   │  ← 三个并列目录
│  (按需脚本)     (注入脚本)     (后台模块)                       │
├────────────────────────────────────────────────────────────────┤
│                     manifest.json + content_scripts             │  ← 注入策略配置
└────────────────────────────────────────────────────────────────┘
```

| 目录 | 性质 | 注入方式 | 何时调用 |
|------|------|---------|---------|
| `funcs/` | 单次脚本（抓取/复制/点击） | `executeScript({ files })` 按需注入 | popup 点击 / 快捷键 |
| `runjs/` | 持续监听（DOM 监听/消息总线/悬浮 UI） | `content_scripts` 静态注入 | 页面加载即注入 |
| `backgroudtask/` | 后台服务模块（消息处理/存储/命令） | `import` 进 `background.js` | Service Worker 启动时初始化 |

## 涉及什么 → 读哪个章节

| 我的需求 | 读哪个 reference |
|---------|----------------|
| 加一个 funcs/ 下的脚本（popup 点击 / 快捷键触发） | `references/add-func-script.md` |
| 给 funcs/ 脚本批量加头标注 | `references/add-func-script.md` 末尾「加头标注」章节 |
| 在 backgroudtask/ 新增模块 / 重组目录 | `references/background-module-reorg.md` |
| 在 runjs/ 新增内容脚本 / 改 manifest 注入策略 | `references/runjs-module-standards.md` |
| 评估"这个快捷键脚本放 runjs 还是 funcs" | `references/runjs-module-standards.md` 末尾「快捷键脚本归属决策树」 |
| 加 prompt 提示词模板（@scenario/@feature 等占位符） | `references/prompt-extension.md`（**非代码规范**，仅作项目提示词资源） |

## 三套规范的共同主线

虽然每个章节独立，但有 **3 条贯穿所有目录的硬约束**：

1. **必要的才注入**（runjs/）— 默认休眠 + 按需激活，避免无差别全量加载
2. **快捷键脚本优先放 funcs/**（runjs/ → funcs/ 跨界）— 单次操作走 funcs + main() + executeScript
3. **目录优于文件**（backgroudtask/）— 新增模块必须建子目录，不在根目录加 .js

详见各 references 子文档。

## 代码规范 vs 提示词模板

本 skill 的三个核心 references（`add-func-script`、`background-module-reorg`、`runjs-module-standards`）都是 **代码模块规范**，指导目录划分、文件命名、注入策略、模块隔离。

`prompt-extension` **不是代码规范** — 它是 popup 提示词模板的占位符 / 分组规范（`%s` 占位符、`@scenario`/`@category` 字段、groups 子目录）。归档在 `references/` 下仅作为项目资源查找入口，**不参与代码规范的决策流程**。

## references 索引

| 文档 | 内容定位 |
|------|---------|
| `references/add-func-script.md` | funcs/ 脚本接入规范：分层目录、main() 包装、统一头标注 9 类别、popup 注册、快捷键绑定三步骤 |
| `references/background-module-reorg.md` | backgroudtask/ 模块化：目录优于文件、index.js 入口、集成模式、import 路径 +1 ../ 规则 |
| `references/runjs-module-standards.md` | runjs/ 内容脚本：必要的才注入 + 快捷键脚本归属决策树 + 模块依赖矩阵 |
| `references/prompt-extension.md` | （非代码规范）popup 提示词模板的扩展：占位符规范、分组结构、新增步骤 |

> 📁 主文档刻意保持极简（约 50 行），所有详细内容完整保留在 references/ 子文档中。这样做的好处：
> 1. 每个目录规范独立维护，互不污染
> 2. 单个目录规范更新不影响其他目录
> 3. 主文档只承担"导航"职责，不重复内容

## 相关 Skill

- [[keyboard-shortcut-architecture]] — 全扩展的快捷键分层架构（Chrome Commands / content script / 用户自定义）
- [[content-script-reactive-config]] — content_scripts 与 settings 页面的响应式配置同步
- [[chrome-bg-module-pattern]] — MV3 service worker 模块拆分模式（thin background.js + module/index.js setupXxxModule）