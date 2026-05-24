# 项目启动指南

> 本文档面向 AI 助手。首次部署时，按以下分工执行：AI 负责环境检查、编译与 native host 注册；**浏览器扩展加载必须由用户手动完成**。

---

## 阶段一：用户手动操作（AI 无法代劳）

### 1. 加载浏览器扩展

请用户执行以下步骤：

1. 打开 Chrome / Edge 的扩展管理页：`chrome://extensions` 或 `edge://extensions`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本项目下的 `ext` 目录（包含 `manifest.json` 的文件夹）
5. 确认扩展 ID 为 `oklmcegaafghdpdbignoacfgmknleben`（manifest 中已内嵌 key，应保持一致）

> 完成此步后，后续所有操作均可由 AI 自动执行。

---

## 阶段二：AI 自动执行

### 2. 克隆仓库

```bash
git clone git@github.com:ZHLX2005/br_ct.git
cd br_ct/ext
```

### 3. 检查 Go 环境

```bash
go version
```

- 要求 **Go 1.21+**
- 若未安装或版本过低，提示用户先安装/升级：https://go.dev/dl/

### 4. 编译 Native Host

```bash
cd native_host
go mod tidy
go build -o brochat_native_host.exe .
```

- 编译产物：`native_host/brochat_native_host.exe`
- 依赖：`golang.org/x/sys`（Windows 注册表操作）

### 5. 首次执行（自动注册）

**只需执行一次**，用于写入注册表和 manifest：

```bash
# 在 native_host 目录下
.\brochat_native_host.exe
```

执行后预期输出（标准错误流）：

```
Native host registered at: C:\Users\<用户名>\.bro_chat_native_host\com.brochat.prompts_editor.json
```

随后进程会在等待 stdin 输入后自动退出。此过程已完成：

- 在 `~/.bro_chat_native_host/` 生成 host manifest
- 向 **Edge** 注册：`HKEY_CURRENT_USER\Software\Microsoft\Edge\NativeMessagingHosts\com.brochat.prompts_editor`
- 向 **Chrome** 注册：`HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.brochat.prompts_editor`

> 注册表写入的是 **HKCU**，无需管理员权限/UAC 弹窗。

### 6. 验证注册

```powershell
# Edge
Get-ItemProperty -Path "Registry::HKEY_CURRENT_USER\Software\Microsoft\Edge\NativeMessagingHosts\com.brochat.prompts_editor"

# Chrome
Get-ItemProperty -Path "Registry::HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.brochat.prompts_editor"
```

两条命令均应返回 manifest 文件路径。

---

## 阶段三：关闭与后续说明

首次注册完成后，直接关闭终端或按 `Ctrl+C` 结束进程即可。

**后续行为：**

- 浏览器扩展在需要与本地系统交互时，会通过 `chrome.runtime.sendNativeMessage` **自动拉起** `brochat_native_host.exe`
- native host 的 `main.go` 每次启动都会调用 `register.EnsureRegistered()`，自动修复 manifest 和注册表（路径变更时无需手动处理）
- **无需**将 native host 作为守护进程常驻，也无需手动再次执行注册步骤

---

## 快速检查清单

### 用户确认项
- [ ] `ext` 目录已加载为浏览器扩展
- [ ] 扩展 ID 为 `oklmcegaafghdpdbignoacfgmknleben`

### AI 自动执行项
- [ ] `go version` >= 1.21
- [ ] `native_host/brochat_native_host.exe` 编译成功
- [ ] 首次执行后标准错误流出现 `Native host registered at: ...`
- [ ] 注册表项已写入（PowerShell 验证通过）

完成以上步骤后，项目即处于可运行状态。
