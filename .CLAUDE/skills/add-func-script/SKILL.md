---
name: add-func-script
description: 当用户要求"添加脚本到函数库"、"加一个新功能脚本"、"把这个脚本加到popup"、"新增函数执行"时触发。指导用户按正确分层和main()包装规范，将新脚本接入 bro_chat 扩展的函数执行系统。
---

# 添加函数执行脚本

## 触发场景

- "我要加一个复制图片的脚本"
- "把这个脚本放到函数库里"
- "新增一个B站专用脚本"
- "添加脚本到 popup 的函数执行"
- "在 funcexecu 里加一个功能"

## 核心流程（必须按序执行）

### Step 1: 确定目录层级

脚本必须放在 `funcs/` 下的正确子目录中。按以下决策树选择：

```
脚本用途是？
├── 针对特定网站/平台（如 B站、Boss直聘、LeetCode）
│   └── → funcs/平台专属/<平台名>/<功能名>.js
├── 通用 DOM 操作（如拾取元素、复制内容、控制可见性）
│   └── → funcs/元素dom/<功能名>.js
└── 临时测试 / 实验性脚本
    └── → funcs/x/<功能名>/
```

**现有分层参考：**

| 层级 | 路径 | 已有示例 |
|------|------|----------|
| 平台专属 | `funcs/平台专属/boss直聘/` | `boss_job.js`, `boss_job_pull.js` |
| 平台专属 | `funcs/平台专属/bili/` | `extract_bilibili_favlist.js` |
| 通用元素 | `funcs/元素dom/` | `div_copy_wrapper.js`, `dom_visibility_controller.js` |
| 测试脚本 | `funcs/x/` | `typingMonitor/`, `watching_dom/` |

### Step 2: 创建脚本文件（main() 包装强制要求）

**关键规则：所有脚本必须用 `function main()` 包装。** 注入执行器 `func_executor.js` 在注入后会显式调用 `main()`，未包装将导致执行失败。

**正确示范：**

```javascript
// funcs/元素dom/my_feature.js
function main() {
  // 你的脚本逻辑
  console.log("脚本已执行");

  // 如果有异步操作，返回 Promise
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve("完成");
    }, 1000);
  });
}
```

**异步脚本示范：**

```javascript
// funcs/平台专属/bili/my_async_feature.js
function main() {
  return (async () => {
    await someAsyncOperation();
    console.log("异步脚本完成");
    return "success";
  })();
}
```

### Step 3: 在 functioncall.js 中注册

编辑 `popup/func_execute/functioncall.js`，在 `scriptFiles` 数组中添加条目：

```javascript
const scriptFiles = [
  // ... 现有条目 ...
  { name: "脚本的显示名称", file: "目录层级/文件名.js" },
];
```

**name 规范：** 简短描述功能，如 `"拾取元素并复制"`、`"B站收藏夹导出"`。
**file 规范：** 相对于 `funcs/` 的路径，如 `"元素dom/my_feature.js"`、`"平台专属/bili/my_feature.js"`。

## 完整示例：添加一个 "高亮所有链接" 脚本

**1. 判断层级：** 通用 DOM 操作 → `funcs/元素dom/`

**2. 创建脚本：**

```javascript
// funcs/元素dom/highlight_links.js
function main() {
  const links = document.querySelectorAll("a");
  links.forEach((link, i) => {
    link.style.outline = "2px solid red";
    link.style.outlineOffset = "2px";
  });
  console.log(`已高亮 ${links.length} 个链接`);
  return { highlighted: links.length };
}
```

**3. 注册到 functioncall.js：**

```javascript
const scriptFiles = [
  // ... 其他条目 ...
  { name: "高亮页面所有链接", file: "元素dom/highlight_links.js" },
];
```

## 错误案例

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| 脚本用自执行函数 `(async function(){...})()` 包装，不写 `main()` | 注入后执行器调用 `main()` 时报错 "未找到 main() 函数" | 始终使用 `function main() { ... }` 作为最外层包装 |
| 把平台专属脚本放到 `funcs/元素dom/` | 目录混乱，后续维护困难，通用脚本和平台脚本混在一起 | Boss直聘脚本放 `平台专属/boss直聘/`，B站脚本放 `平台专属/bili/` |
| 在 `scriptFiles` 中写错路径，如 `"div_copy_wrapper.js"`（缺少 `元素dom/` 前缀） | 脚本注入失败，控制台报 "Could not load file" | 路径必须相对于 `funcs/`，如 `"元素dom/div_copy_wrapper.js"` |
| 在 `x/` 目录下放生产级脚本 | 测试脚本和正式脚本混在一起，popup 中可能误展示未完成的脚本 | 只有临时/实验脚本放 `x/`，完成测试后迁移到正确层级 |

## 成功标准检查清单

- [ ] 脚本文件放在正确的分层目录下
- [ ] 脚本外层使用 `function main() { ... }` 包装
- [ ] `popup/func_execute/functioncall.js` 中 `scriptFiles` 数组已添加对应条目
- [ ] `file` 字段路径相对于 `funcs/` 且与实际文件位置一致
- [ ] 脚本在目标页面上已通过 popup 手动测试执行成功