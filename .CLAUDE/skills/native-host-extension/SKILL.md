---
name: native-host-extension
description: 当需要为 Chrome 扩展的 native_host 添加新命令、新功能模块时触发。用于快速创建符合项目架构的 Go handler 包并完成注册。
---

# Native Host 命令扩展指南

为 bro_chat 浏览器扩展的 Go native messaging host 快速添加新命令模块。

## 架构概览

```
native_host/
├── main.go                    # 入口：注册所有命令 + 消息循环
├── internal/
│   ├── protocol/protocol.go   # 通信协议：4字节LE长度头 + JSON
│   ├── handler/handler.go     # 命令注册表：string → Handler 映射
│   ├── register/register.go   # Windows 注册表 + manifest 自动写入
│   ├── fileops/fileops.go     # 文件操作命令组
│   ├── executor/executor.go   # 子进程管理命令组
│   ├── gitmon/gitmon.go       # Git 操作命令组
│   └── prompts/prompts.go     # 提示词解析命令组
```

**核心协议**：Chrome Native Messaging 标准 — stdin/stdout，4 字节 Little-Endian 长度前缀 + JSON body。

## 扩展步骤（必须按序执行）

### Step 1: 确定命令名和所属包

命名规范：
- 包名：全小写，与目录名一致（如 `clipboard`, `screenshot`, `sysinfo`）
- 命令名：camelCase 动词+名词（如 `readClipboard`, `captureScreen`, `getSystemInfo`）
- 批量命令：`batch` 前缀 + 动词（如 `gitBatchStatus`, `gitBatchPull`）

### Step 2: 创建包目录和文件

```
native_host/internal/<包名>/<包名>.go
```

### Step 3: 编写 handler 函数

每个 handler 必须遵循签名：

```go
package <包名>

import "brochat_native_host/internal/protocol"

// 函数签名固定：protocol.Request → protocol.Response
func DoSomething(req protocol.Request) protocol.Response {
    // 1. 参数校验
    if req.Path == "" {
        return protocol.Response{Status: "error", Message: "path 不能为空"}
    }

    // 2. 执行业务逻辑
    result, err := doWork(req)
    if err != nil {
        return protocol.Response{Status: "error", Message: err.Error()}
    }

    // 3. 返回成功响应
    return protocol.Response{Status: "ok", Data: result}
}
```

**Response 格式约定**：
- 成功：`{Status: "ok", Data: <any>}` — Data 可以是 string、struct、slice、map
- 失败：`{Status: "error", Message: "描述文本"}` — 不要用 Data 字段放错误信息

### Step 4: 如需新参数，扩展 protocol.Request

```go
// native_host/internal/protocol/protocol.go
type Request struct {
    Command   string   `json:"command"`
    Path      string   `json:"path,omitempty"`
    // ... 现有字段 ...
    NewField  string   `json:"newField,omitempty"`  // 添加新字段
}
```

**注意**：所有新增字段必须 `omitempty`，避免破坏现有命令的 JSON 序列化。

### Step 5: 在 main.go 注册命令

```go
// native_host/main.go — 在对应注释分组下添加
registry.Register("commandName", pkgname.HandlerFunc)
```

### Step 6: 编译测试

```bash
cd native_host
go build -o brochat_native_host.exe .
```

### Step 7: 前端 JS 侧调用

```javascript
// 在扩展的 background/content script 中
const response = await chrome.runtime.sendNativeMessage('com.brochat.prompts_editor', {
    command: 'commandName',
    path: '/some/path',
    // 其他 Request 字段...
});
// response = { status: "ok"|"error", data: ..., message: ... }
```

## Handler 编写模式

### 模式 1：文件操作类

参考 `fileops.ReadFile` / `fileops.WriteFile`

```go
func ReadFile(req protocol.Request) protocol.Response {
    data, err := os.ReadFile(req.Path)
    if err != nil {
        return protocol.Response{Status: "error", Message: err.Error()}
    }
    return protocol.Response{Status: "ok", Data: string(data)}
}
```

### 模式 2：命令执行类

参考 `gitmon.runGit` — 用 `os/exec.Command`，通过 `req.Path` 指定工作目录：

```go
func runCommand(dir string, args ...string) (string, error) {
    cmd := exec.Command("tool", args...)
    cmd.Dir = dir
    out, err := cmd.CombinedOutput()
    return strings.TrimSpace(string(out)), err
}
```

### 模式 3：批量操作类

参考 `gitmon.GitBatchStatus` — 遍历 `req.Dirs`，逐个执行：

```go
func BatchOperation(req protocol.Request) protocol.Response {
    var results []SomeResult
    for _, dir := range req.Dirs {
        results = append(results, doForDir(dir))
    }
    return protocol.Response{Status: "ok", Data: results}
}
```

### 模式 4：子进程管理类

参考 `executor.StartProcess` — 用 `exec.Command` + `CREATE_NEW_PROCESS_GROUP` 脱离父进程：

```go
cmd := exec.Command(req.Cmd, args...)
cmd.SysProcAttr = &syscall.SysProcAttr{
    CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP,
}
```

进程状态持久化到 `~/.bro_chat_native_host/processes.json`。

## 关键常量（register.go）

| 常量 | 值 | 用途 |
|------|-----|------|
| HostName | `com.brochat.prompts_editor` | Native messaging host 标识 |
| ExtensionId | `oklmcegaafghdpdbignoacfgmknleben` | Chrome 扩展 ID |
| EdgeRegPath | `Software\Microsoft\Edge\NativeMessagingHosts\...` | Edge 注册表路径 |
| ChromeRegPath | `Software\Google\Chrome\NativeMessagingHosts\...` | Chrome 注册表路径 |

## 错误案例

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| 新字段不加 `omitempty` | 现有命令的 JSON 输出多出空字段 `"path":""` | 所有 Request 新字段必须 `omitempty` |
| handler 返回 `Data: err.Error()` | 前端无法区分成功/失败 | 失败用 `Message` 字段，成功用 `Data` 字段 |
| 忘记在 main.go 注册 | 命令发送后返回 "Unknown command" | 每个新 handler 必须在 main.go Register |
| 用 `os/exec` 不设 `cmd.Dir` | 在 native_host.exe 所在目录执行 | 必须从 `req.Path` 或 `req.WorkDir` 设置工作目录 |
| 子进程不用 `CREATE_NEW_PROCESS_GROUP` | native host 退出时子进程被杀 | Windows 子进程必须设 CreationFlags |
| 编译后不更新 manifest | 浏览器仍调用旧 exe 路径 | `EnsureRegistered()` 每次启动自动更新，无需手动处理 |
| 直接读写 stdin/stdout | 破坏 4 字节长度协议，消息解析失败 | 只用 `protocol.ReadMessage/SendResponse` |
| Windows registry 操作用 HKLM | 需要管理员权限，UAC 弹窗 | 用 `registry.CURRENT_USER`（HKCU），无需提权 |

## 调试 Windows 进程 / IPC 问题

排查 native_host 子进程「莫名连坐自杀」、Service Worker 30s idle 链路、单例锁、CreateProcess CreationFlags 选错等问题时，详见 [[windows-process-ipc]]（完整诊断手册 + 心智模型 + 失败模式速查 + 仓库代码索引）。

## 扩展检查清单

- [ ] 确定命令名（camelCase）和包名（lowercase）
- [ ] 在 `internal/<包名>/` 创建 Go 文件
- [ ] handler 函数签名：`func(req protocol.Request) protocol.Response`
- [ ] 成功返回 `{Status: "ok", Data: ...}`
- [ ] 失败返回 `{Status: "error", Message: ...}`
- [ ] 如需新参数：Request 结构体加 `omitempty` 字段
- [ ] main.go 中 `registry.Register()` 注册
- [ ] `go build` 编译通过
- [ ] 前端 JS 调用 `chrome.runtime.sendNativeMessage` 验证

## 参考资料（按需加载）

| ref | 何时读取 | 路径 |
|-----|---------|------|
| [[windows-process-ipc]] | 排查 Windows 子进程连坐、Service Worker 30s 链路、单例锁多开、CreateProcess CreationFlags 选错等问题 | references/windows-process-ipc.md |
