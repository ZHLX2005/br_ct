---
name: prompt-extension
description: 当用户想要扩展或添加提示词模板时触发。适用于：添加新提示词、修改现有提示词、分组归类、理解占位符使用、查询可用提示词。提供提示词扩展的结构规范和项目上下文。
reference: code-standards-guide — popup 提示词模板扩展指南（非代码规范，仅作项目资源归档）
---

# 提示词扩展指南

## 项目提示词结构

```
popup/promots/
├── groups/              # 分组目录，按功能分类
│   ├── code_gen.js      # 代码生成类
│   ├── analyze_plan.js  # 分析规划类
│   ├── custom_design.js # 自定义设计类
│   ├── read.js          # 阅读理解类
│   ├── search.js        # 搜索类
│   └── other.js         # 其他类
└── prompts.js           # 入口，聚合所有分组
```

## 单个提示词的格式

```js
"唯一键名": {
  group: "分组名",           // 必须与文件名一致
  label: "显示名称",         // UI 显示用
  template: "模板内容..."    // 支持占位符
},
```

**注意**：`key`（唯一键名）必须与 `label` 保持语义一致但可不同。

## 占位符规范

| 占位符 | 含义 | 用法 |
|--------|------|------|
| `%s` | 用户输入替换 | 直接插入用户选中的文本 |
| `%s\n\n` | 换行分隔 | 模板前缀 + 用户输入 + 后缀 |
| `%s 要求:` | 带要求前缀 | 明确告知 AI 需要处理的方向 |

**示例**：
```js
// 简单替换
template: "%s"

// 带格式指令
template: "内容: %s 要求: 帮我整理格式"

// 多段组合（%s 出现一次，替换为整段选中文本）
template: "代码: %s\n\n要求：\n1. 分析代码\n2. 指出问题"
```

## 分组说明与适用场景

| 分组 | 文件 | 适用场景 |
|------|------|---------|
| `code_gen` | code_gen.js | 生成完整代码、接口、脚本、修复 bug |
| `analyze_plan` | analyze_plan.js | 深度分析、学习路线、面试题、对比表格 |
| `custom_design` | custom_design.js | 特定格式输出（vue、mermaid、docker、swagger） |
| `read` | read.js | 理解代码、翻译、文档生成 |
| `search` | search.js | 搜索资源、快速回答、语言学习 |
| `other` | other.js | 特殊场景（攻击力、购物建议等） |

## 添加新提示词的步骤

1. **确定分组**：根据功能选择合适的分组文件
2. **编写模板**：遵循占位符规范
3. **添加到文件**：导出 `PROMPTS` 对象中添加新条目
4. **验证**：UI 自动发现，无需修改其他文件

## 扩展原则

- **单一职责**：一个提示词做一件事
- **命名清晰**：`label` 直接表达用途
- **模板精简**：占位符后跟具体要求，避免冗余
- **分组准确**：同类功能放同一分组

## 示例：添加新提示词

**场景**：用户想要一个"生成 TypeScript 类型定义"的提示词

**分析**：
- 功能：代码生成 → `code_gen` 分组
- 输入：接口/数据结构
- 输出：TypeScript 类型定义

**添加到** `groups/code_gen.js`：
```js
生成TypeScript类型: {
  group: "code_gen",
  label: "生成TypeScript类型",
  template: "内容: %s\n\n要求: 根据提供的数据结构或接口生成 TypeScript 类型定义，使用 interface 或 type，确保类型安全",
},
```
