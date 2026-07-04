---
name: background-module-reorg
description: 当需要整理 background.js 模块、重组 backgroudtask 目录结构、迁移模块到子目录时触发
reference: code-standards-guide — backgroudtask/ 模块化重组规范（归档版）
---

# Background 模块化重组规范

## 核心原则：目录优于文件，防止根目录腐蚀

新增模块必须创建独立目录，**禁止**在 `backgroudtask/` 根目录直接放代码文件。

## 目录结构规范

```
backgroudtask/
├── translation/           ← 模块目录（展示优先）
│   ├── index.js           ← 入口文件（固定名称）
│   ├── ocr.js             ← 功能文件
│   ├── contextMenu.js
│   └── selectionAskConfig.js
│
├── binddom/               ← 模块目录
│   ├── index.js
│   └── ...
│
├── native_relay/          ← 模块目录
│   ├── index.js
│   └── ...
│
├── ai_platform_processor.js  ← ❌ 禁止新增，只允许已存在的文件
└── func_executor.js         ← ❌ 禁止新增，只允许已存在的文件
```

**规则**：
1. 每个模块一个目录
2. 目录内必须有 `index.js` 作为入口
3. 功能代码按职责拆分到目录内
4. `backgroudtask/` 根目录只保留已有文件，**不新增**

## 新增模块流程

### Step 1: 创建目录

```
mkdir backgroudtask/newModule/
touch backgroudtask/newModule/index.js
```

### Step 2: 编写 index.js 入口

```javascript
/**
 * NewModule 模块入口
 */
import { setupStorage } from './storage.js';
import { setupHandlers } from './handlers.js';

export function setupNewModule() {
  console.log('[NewModule] 初始化...');
  setupStorage();
  setupHandlers();
  console.log('[NewModule] 初始化完成');
}
```

### Step 3: 在 background.js 中导入

```javascript
// background.js
import { setupNewModule } from './backgroudtask/newModule/index.js';

// 在初始化序列中调用
setupNewModule();
```

### Step 4: 若模块需合并到父模块

按以下顺序执行（见下方"集成模式"）

## 集成模式：将独立模块合并到父模块

**场景**：某模块原本独立初始化，后需合并到父模块统一管理

**示例**：selectionAskConfig 合并到 translation

```
原结构：
  background.js → 直接导入 selectionAskConfig.js → initSelectionAskConfig()

目标结构：
  background.js → setupTranslationModule() → translation/index.js → initSelectionAskConfig()
```

**操作步骤**：

1. 移动文件到目标目录（建立目录结构）
2. 更新文件内部 import 路径（相对路径 +1 `../`）
3. 在父模块 index.js 中添加 import
4. 在父模块 setupXxx() 中调用 init
5. 在 background.js 中注释原 import（保留，注明已迁移）

**关键**：移动后必须更新文件内部所有相对路径

```javascript
// 移动前：backgroudtask/selectionAskConfig.js
import { PLATFORM_CONFIG } from '../config/platformConfig.js';

// 移动后：backgroudtask/translation/selectionAskConfig.js
import { PLATFORM_CONFIG } from '../../config/platformConfig.js';  // 路径 +1 ../
```

## 注释保留规范

```javascript
// background.js

// 初始化 NewModule (已移至 translation/index.js)
// import { initNewModule } from './backgroudtask/translation/newModule.js';
// initNewModule();
```

## 验证流程

1. 检查文件内部 import 路径是否正确
2. reload extension（chrome://extensions/ 点击刷新）
3. 检查 Service Worker 日志
4. 实际触发功能测试

## 错误案例

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|--------|
| 直接在 backgroudtask/ 根目录新增 .js | 根目录腐蚀，结构混乱 | 必须创建模块目录 |
| 移动文件但未更新内部 import | 模块静默失败 | 相对路径 +1 `../` |
| 删除 background.js 中的原代码 | 回滚困难 | 用注释保留 |
| 未 reload 就测试 | 缓存导致行为诡异 | 必须刷新 extension |

## 坑点警示

1. **ES Module 相对路径基于文件位置**
   - A.js 在 `subdir/` 里，`../config.js` 指向 `subdir` 的上一级
   - 不是相对于 background.js

2. **模块失效静默**
   - import 失败不抛明显错误
   - 检查日志 `[Xxx] 初始化完成` 是否出现

3. **循环 import**
   - 确保 A → B → A 不存在

## 快速检查清单

新增模块：
- [ ] 创建了 `backgroudtask/模块名/` 目录
- [ ] 目录内有 `index.js` 入口
- [ ] 功能代码在目录内拆分
- [ ] background.js 正确导入

移动/合并模块：
- [ ] 建立了目标目录结构
- [ ] 文件内部 import 路径已更新
- [ ] 父模块已添加 import
- [ ] 父模块 setupXxx() 中已调用 init
- [ ] background.js 中原代码已注释
- [ ] Extension 已 reload
- [ ] 日志确认初始化成功
