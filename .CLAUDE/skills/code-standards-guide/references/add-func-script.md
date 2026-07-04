---
name: add-func-script
description: 当用户要求"添加脚本到函数库"、"加一个新功能脚本"、"把这个脚本加到popup"、"新增函数执行"、或提到 funcs/ 目录下的脚本接入时触发。指导用户按分层、main() 包装、统一头标注的规范，将新脚本接入 bro_chat 扩展的函数执行系统（含 popup 注册、快捷键绑定、注入限制三大链路）。
reference: code-standards-guide — funcs/ 脚本接入规范（归档版，与代码规范主 skill 分离）
---

# 添加函数执行脚本

## 触发场景

- "我要加一个复制图片的脚本"
- "把这个脚本放到函数库里"
- "新增一个 B 站专用脚本"
- "添加脚本到 popup 的函数执行"
- "在 funcexecu 里加一个功能"
- "给 funcs/ 下的脚本加上头部注释"（参见末尾"加头标注"章节）

## 默认路径：绝大多数脚本只走 popup 一条路

**本仓库里 45 个 funcs 脚本中，只有 3 个绑定了快捷键**（`div_copy_wrapper`、`div_Img_wrapper`、`copy2file`，对应 `Alt+C`/`Alt+D`/`Alt+F`）。其余 42 个全部走 popup 点击执行。

所以**新脚本默认只需要做三件事**：
1. 放到 `funcs/` 正确子目录
2. 用 `main()` 包装 + 加统一头标注
3. 在 `popup/func_execute/functioncall.js` 的 `scriptFiles` 数组里加一行

只有用户**明确要求**"加个快捷键"、"绑定 Alt+X"时，才进入 Step 4。

## 核心流程（默认三步）

### Step 1: 确定目录层级

脚本必须放在 `funcs/` 下的正确子目录中。按以下决策树选择：

```
脚本用途是？
├── 针对特定网站/平台（如 B站、Boss直聘、LeetCode、腾讯文档、ChatGPT）
│   └── → funcs/平台专属/<平台名>/<功能名>.js
├── 通用 DOM 操作（拾取元素、复制内容、控制可见性、计数）
│   └── → funcs/元素dom/<功能名>.js
├── 底层模块（被其他 funcs 引用，不可独立运行）
│   └── → funcs/mods/<模块名>/<文件名>.js
└── 临时测试 / 实验性脚本 / 自测脚本
    └── → funcs/x/<功能名>/
```

**现有分层参考：**

| 层级 | 路径 | 已有示例 |
|------|------|----------|
| 平台专属 | `funcs/平台专属/boss直聘/` | `boss_job.js`, `boss_job_pull.js` |
| 平台专属 | `funcs/平台专属/bili/` | `extract_bilibili_favlist.js`, `专栏kan/专栏2md.js` |
| 平台专属 | `funcs/平台专属/腾讯文档/` | `use.js`, `t.js` |
| 通用元素 | `funcs/元素dom/` | `div_copy_wrapper.js`, `dom_visibility_controller.js` |
| 视频 | `funcs/元素dom/video/` | `frame.js`, `videoop.js` |
| 测试脚本 | `funcs/x/` | `typingMonitor/`, `watching_dom/` |
| 底层模块 | `funcs/mods/` | `binddom/`, `html_text_reader/` |

> ⚠️ **目录命名约束**：平台名目录是中文（`boss直聘/` `bili/` `腾讯文档/`），但 `scriptFiles` 注册时也必须**原样使用中文**（见 Step 3）。

### Step 2: 编写脚本（main() 包装 + 统一头标注 + 模块隔离）

脚本必须满足**三条硬约束**，缺一不可：

#### 2.1 main() 包装强制要求

`func_executor.js:43` 注入后会 `typeof main === "function" && main()`，未包装将报"未找到 main() 函数"。

```javascript
// funcs/元素dom/my_feature.js
function main() {
  // 你的脚本逻辑
  console.log("脚本已执行");
  return { success: true };
}
```

**异步脚本示范：**

```javascript
function main() {
  return (async () => {
    await someAsyncOperation();
    return "success";
  })();
}
```

#### 2.2 统一头标注（必填，9 类别候选）

参考本仓库已有的 45 个脚本，**所有新脚本必须在第 1 行插入统一 JSDoc 头**。该头用于：
- popup 侧渲染脚本元信息（未来可扩展）
- grep 按类别批量索引（`@category`）
- 跨平台统一阅读体验

模板：

```javascript
/**
 * @fileoverview <一句话，15字以内>
 *
 * @scenario    <适用场景：什么情况下用>
 * @feature     <功能简述>
 * @effect      <使用后的效果：产生什么DOM/数据/行为>
 * @category    <从下列9个选一个>
 * @platform    <通用 / bilibili / boss直聘 / chatgpt / leecode / 腾讯文档 / yuanbao（腾讯元宝）>
 * @entry       <main() / new ClassName() / 自动执行 / 模块导出>
 *
 * @test_url    <模式1名称>：<完整URL>   ← 可选，多行
 * @test_url    <模式2名称>：<完整URL>
 */
```

**9 个候选 `@category`（必须精确选一个，不要自创）：**

| 类别 | 典型场景 |
|---|---|
| `DOM创建` | 悬浮 UI、面板、注入控件、Counter |
| `数据提取` | 抓取 DOM 文本/图片/链接、读剪贴板转文件 |
| `自动化点击` | 模拟点击、滚动、键盘、表单提交 |
| `视觉展示` | 装饰动画（海浪、彩条、隐藏/全屏） |
| `行为Hook` | hook 剪贴板、hook 页面事件、修改浏览器 API |
| `文本处理` | 字符串转义、格式化、复制 |
| `视频处理` | 视频帧捕获、播放控制、片段剪辑 |
| `平台专属` | 仅当脚本同时是平台专用 + 跨类别（如 B站提取）时使用 |
| `工具辅助` | 通用辅助，不创建 DOM、不抓数据、不点击 |

**可选标签 `@test_url`（推荐平台专属脚本使用）：**

平台专属脚本最容易因页面改版失效，**强烈建议**头部标注 1~N 个真实测试 URL，注明对应模式，方便后续回归测试。

格式：
```
@test_url    <模式名>：<完整URL>
```

- **模式名**：简短描述该 URL 触发的代码分支，如"多层课程（pod 模式）"、"单层合集（flat 模式）"
- **URL**：含 query string 的完整链接（`?spm_id_from=...` 等也保留），方便定位具体入口
- **多模式时多行**：每行一个 `@test_url`，谁看到这个脚本都能立刻找到验证素材

> 💡 真实案例：`funcs/平台专属/bili/extract_bilibili_pod.js` 头部带 2 个 `@test_url`，分别覆盖 pod/flat 两种分支。

#### 2.3 模块隔离（不能用 import/export）

注入方式 `chrome.scripting.executeScript({ files: ['funcs/xxx.js'] })` 是 **ISOLATED world 普通脚本**，**不支持 ES Module**。

- ❌ 不能用 `import { x } from '../mods/foo.js'`
- ✅ 直接在被引用文件里 `// @require ./foo.js` 风格会被忽略 → 把依赖代码 copy 进来或用全局变量 `window.__myModule`
- ✅ 真要跨文件共享，**唯一办法**是把被引用代码也通过 `executeScript({ files: [...] })` 按顺序注入（不在 funcs 注入流程里，需要改 `func_executor.js`）

> 💡 **实践建议**：如果脚本依赖其他 funcs 脚本的函数，**改成注入同一个 `main()` 调用链**，或把通用工具下沉到 `funcs/mods/` 并在 `func_executor.js` 里同时注入。

### Step 3: 在 functioncall.js 中注册（popup 展示）

编辑 `popup/func_execute/functioncall.js`，在 `scriptFiles` 数组中添加条目：

```javascript
const scriptFiles = [
  // ... 现有条目 ...
  { name: "脚本的显示名称", file: "目录层级/文件名.js" },
];
```

**name 规范：** 简短描述功能，不超过 15 字。
**file 规范：** 相对于 `funcs/` 的路径，**含中文目录名**（如 `"平台专属/boss直聘/boss_job.js"`、`"元素dom/my_feature.js"`）。

> ⚠️ **现实痛点**：`funcs/` 下有 45 个脚本，但 `scriptFiles` 数组当前只列了 14 个。**新增脚本如果忘了注册，popup 列表里就看不到**，但 `executeFunctionScript()` 仍能直接调用、快捷键也能用。所以"加头 + 加 main + 加注册"这三步**一步都不能省**。

### Step 4（仅按需）: 绑定快捷键

只有用户**明确要求**"加个快捷键"、"绑 Alt+X" 时才走这一步。

**4.1 `manifest.json` 的 `commands` 字段加一项：**

```json
"commands": {
  "my_shortcut_id": {
    "suggested_key": { "default": "Alt+X" },
    "description": "我的新脚本"
  }
}
```

**4.2 `backgroudtask/func_executor.js` 的 `setupFuncCommandListener` 里加一个分支：**

```javascript
if (command === "my_shortcut_id") {
  executeFunctionScript("元素dom/my_feature.js", (response) => {
    console.log("快捷键执行结果:", response);
  });
}
```

> ⚠️ `id` 必须全小写下划线，**manifest 和 executor 两边字符串完全一致**。

## 完整示例：添加"高亮所有链接"脚本

**1. 判断层级：** 通用 DOM 操作 → `funcs/元素dom/`

**2. 创建脚本（含统一头）：**

```javascript
/**
 * @fileoverview 高亮页面所有链接
 *
 * @scenario    想快速看出页面上有多少可点击链接、哪些是隐藏的
 * @feature     遍历所有 <a>，加红色描边
 * @effect      所有 a 标签被加上 2px 红色 outline
 * @category    DOM创建
 * @platform    通用
 * @entry       main()
 */

function main() {
  const links = document.querySelectorAll("a");
  links.forEach((link) => {
    link.style.outline = "2px solid red";
    link.style.outlineOffset = "2px";
  });
  console.log(`已高亮 ${links.length} 个链接`);
  return { highlighted: links.length };
}
```

**3. 注册到 functioncall.js：**

```javascript
{ name: "高亮页面所有链接", file: "元素dom/highlight_links.js" },
```

**4. 测试：** popup 刷新 → 找到该条目 → 点击执行 → 看到 console 打印 + 链接红框。

## 错误案例

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| 脚本用 IIFE `(async function(){...})()` 包装，不写 `main()` | 注入后 `typeof main === "function"` 为 false，报"未找到 main() 函数" | 始终使用 `function main() { ... }` 作为最外层包装 |
| 把平台专属脚本放到 `funcs/元素dom/` | 目录混乱，平台脚本污染通用池 | Boss 放 `平台专属/boss直聘/`，B 站放 `平台专属/bili/` |
| `scriptFiles` 中路径漏中文目录，如 `"boss直聘/boss_job.js"` | 脚本找不到，注入失败报"通用函数脚本注入失败" | 完整路径：`"平台专属/boss直聘/boss_job.js"` |
| 在 funcs 脚本里用 `import { x } from './y.js'` | `executeScript({ files })` 不解析模块语法，运行时 `import is not defined` | 把依赖代码 copy 进同一个 main()，或改造注入链路 |
| 脚本创建好但忘了在 `scriptFiles` 注册 | popup 列表里看不到，只能靠快捷键或手动 executeScript 触发 | 走默认三步即可，无需快捷键也能在 popup 用 |
| 快捷键 ID 在 manifest 和 executor 不一致（如大小写） | 监听器永远收不到事件，命令失效 | 两处字符串完全一致（全小写下划线），且**只有需要快捷键时才配** |
| `scriptFiles` 写了但 `funcs/` 下没文件 | "通用函数脚本注入失败: Could not load file" | 先创建文件再注册 |
| 在 `x/` 目录下放生产级脚本 | 测试脚本和正式脚本混在一起，popup 中可能误展示 | 临时/实验脚本放 `x/`，完成后迁移到 `元素dom/` 或 `平台专属/` |
| 自定义 `@category`（不在 9 个候选里） | grep 索引不到、后续分类脚本失效 | 必须从 9 个候选里精确选一个 |
| 平台名用拼音（如 `tianna`）而不是 `yuanbao` | 跨脚本 grep 不到同平台脚本 | 平台名用 `yuanbao（腾讯元宝）` 这类标准名 |
| 只加头标注不加 main() | 注入直接报"未找到 main() 函数" | 头标注 + main() 必须同时存在 |
| 把已有 JSDoc 头注释整个删掉再换新的 | 丢失原作者的细节注释，新头又写不全 | 保留原注释块，在 `*/` 后追加独立新块 |

## 实战发现：当前架构的 3 个已知问题

1. **scriptFiles 与 funcs/ 不同步** — funcs/ 下 45 个脚本，scriptFiles 只有 14 个。**新脚本默认不在 popup 列表显示**，必须主动注册。
2. **没有自动发现机制** — 每次新增脚本都得手动改 `functioncall.js`。可考虑改成扫描 `web_accessible_resources` 里的 `funcs/*.js` 清单，但需要先在 `manifest.json` 加扫描接口。
3. **没有真正"模块化"** — `funcs/mods/` 下的 `Readability.js` 等模块目前是被 `pageTextExtractor.js` 引用 copy 模式（不是真的 ES Module import），跨文件复用全靠 copy。

## 成功标准检查清单

- [ ] 脚本文件放在正确的分层目录下（平台专属 / 元素dom / mods / x）
- [ ] 脚本**第 1 行**包含统一 JSDoc 头，`@category` 从 9 个候选精确选一个
- [ ] 脚本外层使用 `function main() { ... }` 包装（异步用 `return (async () => {...})()`）
- [ ] 脚本**没有用** `import` / `export`
- [ ] `popup/func_execute/functioncall.js` 中 `scriptFiles` 数组已添加对应条目（**中文目录名原样**）
- [ ] `file` 字段路径相对于 `funcs/` 且与实际文件位置一致
- [ ] 脚本在目标页面上已通过 popup 手动测试执行成功
- [ ] （仅当用户要求快捷键）`manifest.json` 的 `commands` 和 `func_executor.js` 的 `setupFuncCommandListener` 两边 ID 一致
- [ ] （平台专属脚本强烈推荐）头部带至少 1 个 `@test_url`，覆盖每种代码分支

## 加头标注（仅修改注释的批量任务）

当用户的请求是"给 funcs/ 下的脚本批量加头注释"（不涉及新功能），可使用以下简化流程：

1. 用 `find funcs/ -name "*.js" -type f` 列出全部脚本，按目录分桶
2. 并行分发 4~6 个 subagent，每个负责 10~20 个文件
3. subagent 任务里**显式给出** 9 个 `@category` 候选和 `@platform` 候选，避免自创
4. 主线程对**已知的脚本**（之前 Read 过的）直接 Edit 处理，跳过 subagent
5. 收到所有 subagent 完成后**校对一遍**，重点查 `tianna` 拼音目录、`x/` 自测脚本的 platform 标注
