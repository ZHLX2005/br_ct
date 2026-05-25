# 环境变量管理模块 - 任务书

> 创建日期: 2025-05-25
> 需求来源: 参考 `windowspath/pathenv` CLI 工具，为 bro_chat 扩展添加 Windows 环境变量管理功能

---

## 已完成

### 1. 后端 Go 模块 `native_host/internal/envvars`
- [x] 创建 `envvars.go`，实现 18 个命令
  - 快照: `saveEnvSnapshot`, `listEnvSnapshots`, `restoreEnvSnapshot`
  - 用户 PATH: `getUserPath`, `addUserPath`, `removeUserPath`, `batchRemoveUserPath`
  - 系统 PATH: `getSystemPath`, `addSystemPath`, `removeSystemPath`, `batchRemoveSystemPath`
  - 用户变量: `getUserEnvVars`, `setUserEnvVar`, `removeUserEnvVar`
  - 系统变量: `getSystemEnvVars`, `setSystemEnvVar`, `removeSystemEnvVar`
- [x] `protocol.go` 复用现有字段（`Name`, `Path`），未新增字段
- [x] `main.go` 注册全部命令
- [x] 编译通过

### 2. 前端 `options/local_cmd/`
- [x] 新增 `envvar.js` - 环境变量面板逻辑
  - 四个子面板: 用户 PATH / 系统 PATH / 用户变量 / 系统变量
  - 搜索过滤、多选批量删除、快照管理、首次自动快照
- [x] `index.html` - 添加第五个 Tab「环境变量」及四个子面板 HTML
- [x] `local_cmd.js` - 注册所有事件映射
- [x] 添加 `.envvar-sub-panel` / `.envvar-sub-btn` 样式

### 3. Tab 状态记忆
- [x] `core.js` - `STORAGE_KEYS` 新增 `lastActiveTab`
- [x] `local_cmd.js` - 切换 tab 时保存，初始化时恢复

### 4. Bug 修复
- [x] 系统 PATH 面板无 checkbox/删除按钮（`editable` 参数为 `false`）
- [x] 点击系统 PATH checkbox 后行消失（`setupEnvvarCheckboxDelegation` 中 `editable` 为 `false`）
- [x] 子 tab 切换时清空选中集合，避免用户/系统选中项混淆
- [x] 环境变量面板 HTML 位置错误（被放在 `local-cmd-container` 外部）

---

## 待办 / 后续优化

### P1 - 防御性措施（建议近期）
- [ ] `readFile` 加 1MB 大小上限，避免撑爆 native messaging 管道
- [ ] `protocol.SendResponse` 加消息大小检查（发送端目前无上限）

### P2 - 性能优化（瓶颈出现时）
- [ ] `scanSkills` 改为 goroutine 并发扫描（当前串行读 SKILL.md 算 MD5）
- [ ] `gitBatchStatus` / `gitBatchFetch` 改为并发执行（当前串行）
- [ ] 添加分页参数 `limit` / `offset`，前端按需加载

### P3 - 可靠性增强（可选）
- [ ] `RestoreSnapshot` 恢复前先自动保存一份"恢复前备份"
- [ ] Git 批量操作加总超时（如 30 秒），避免单目录卡住

### P4 - UX 优化（可选）
- [ ] 环境变量面板支持拖拽排序 PATH 条目
- [ ] 快照支持手动命名/备注
- [ ] 系统级操作失败时给出更友好的权限提示（当前直接返回"需要管理员权限"）

---

## 涉及文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `native_host/internal/envvars/envvars.go` | 新增 | 环境变量管理核心包 |
| `native_host/internal/protocol/protocol.go` | 修改 | 无需新增字段 |
| `native_host/main.go` | 修改 | 注册 18 个新命令 |
| `options/local_cmd/envvar.js` | 新增 | 前端环境变量模块 |
| `options/local_cmd/index.html` | 修改 | 添加 Tab + 四个子面板 + 样式 |
| `options/local_cmd/local_cmd.js` | 修改 | Tab 切换记忆 + 事件委托 |
| `options/local_cmd/core.js` | 修改 | `STORAGE_KEYS` 新增 `lastActiveTab` |
