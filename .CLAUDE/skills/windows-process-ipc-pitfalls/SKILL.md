---
name: windows-process-ipc-pitfalls
description: 调试 Windows 父子进程生命周期/IPC 问题时触发——子进程被「莫名连坐杀掉」、Chrome 扩展 native messaging host 的 child 30s 后自杀、`npm run` 弹出多余 cmd 黑窗、taskkill /T 误伤、单例锁导致无法多开。触发词：Windows 进程管理、信号量、native messaging、Service Worker idle、子进程连坐、pipe EOF、DETACHED_PROCESS、CREATE_NO_WINDOW、CREATE_BREAKAWAY_FROM_JOB、HideWindow、Job Object、taskkill /T、process.on('exit')、状态文件单例锁、stdin EOF 级联。
---

# Windows 进程管理 & 信号量通信痛点速查

为「Chrome 扩展 → Go native_host → Node CLI → Git Bash 窗口」这类长链路 child 写的诊断手册。也适用于任何 Windows 上「父进程退出就把孩子带走」的场景。

## 一、心智模型：Windows 没有你以为的「信号」

跨 OS 的人一来就会犯的错：**把 POSIX signal 当通用语言**。Windows 上几乎所有「信号传递」其实是下面四种机制中的一种：

| 你以为的「信号」 | Windows 实际机制 | 触发器 |
|---|---|---|
| SIGINT (Ctrl+C) | Console Ctrl Event | `GenerateConsoleCtrlEvent` / 终端 Ctrl+C |
| SIGTERM | **不存在**（Node.js 仿真，几乎没人发） | 没有 |
| 子进程被杀 | TerminateProcess（硬杀，无回调） | `taskkill /F` / `proc.Kill()` |
| 「父进程退出我也死」 | **pipe EOF 级联** 或 **Job Object kill on close** | 父端关 pipe writer / 父进程退出导致 Job 被销毁 |
| 「关窗就退出」 | WM_CLOSE | GUI 关闭按钮 / `taskkill` 不带 `/F` |

> **关键认知**：你在 Windows 上看到的「子进程跟着父进程一起死」，**通常不是信号传递，是 stdin pipe 收到 EOF 之后子进程自己决定退出**——是协议性的，不是 OS 强制的。

## 二、Chrome 扩展的连坐死亡链路（本次案例）

```
Chrome MV3 Service Worker
   │ (~30s idle → SW evicted)
   ▼
chrome.runtime.connectNative port 断开
   │
   ▼
native_host (Go) stdin 收到 EOF
   │ (默认实现：读到 EOF 就 main 返回)
   ▼
Go 进程退出，OS 关闭所有它持有的 pipe writer
   │
   ▼
所有 child 的 stdin 收到 EOF
   │ (Node 仍 process.stdin.resume()，但 readable 的 'end' 事件触发，event loop 空了)
   ▼
Node 进程退出 → process.on('exit') 触发
   │
   ▼
controller.stopSync() → taskkill /T /F /PID <bash_window>
   │
   ▼
Git Bash 窗口被杀（用户看到「莫名其妙关掉了」）
```

**修复思路**（三道防线，任选/叠加）：

| 防线 | 改在哪 | 作用 |
|---|---|---|
| ① child 不继承父的 Job Object | native_host 启动 child 时加 `CREATE_BREAKAWAY_FROM_JOB` | 即使 Chrome 关 native_host，child 不被 Job 强杀 |
| ② parent 守在原地不退出 | Go `main` 在 stdin EOF 后轮询 `HasActiveChildren()`，只要还有活 child 就不返回 | pipe writer 不被 OS 关，child 永远收不到 EOF |
| ③ child 不自我了结 | Node 拿掉 `process.on('exit') → stopSync()` 这种连带杀逻辑 | 即使 EOF 来了，child 也不主动 taskkill 自己 |

**选择**：① + ② 不动 child 源码，是最干净的修法；只有当 child 不归你管时才考虑 ③。本案例选了 ① + ②。

## 三、CreateProcess CreationFlags 翻译表（Go on Windows 视角）

```go
cmd.SysProcAttr = &syscall.SysProcAttr{
    HideWindow:    true,
    CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP | createNoWindow | createBreakawayFromJob,
}
const (
    createNoWindow         = 0x08000000
    createBreakawayFromJob = 0x01000000
    detachedProcess        = 0x00000008   // 容易和 createNoWindow 弄混
)
```

| 标志 | 行为 | 何时用 | 别和谁混 |
|---|---|---|---|
| `CREATE_NEW_PROCESS_GROUP` | child 自成 process group，能独立接收 Ctrl 事件 | 默认加，几乎无害 | — |
| `CREATE_NEW_CONSOLE` | 给 child 分配一个新可见控制台 | 你想要看到黑窗时 | 与 DETACHED 互斥 |
| `DETACHED_PROCESS` | child **没有任何 console** | 想完全断开 console 继承 | 对 `.cmd → cmd.exe → npm.cmd` 不可靠：cmd.exe 仍会自己 AllocConsole |
| `CREATE_NO_WINDOW` | child 有 console，但**窗口不可见** | 推荐：「我要静默运行 console app」 | 和 DETACHED 互斥；这是 .cmd/npm 静默的正解 |
| `CREATE_BREAKAWAY_FROM_JOB` | 不继承父的 Job Object | 父被 Job 管控（Chrome、Service host）但你不想连坐 | 父端 Job 必须允许 breakaway 才生效（Chrome 现版本是允许的） |

**`HideWindow: true`**：Go `syscall.SysProcAttr` 里独立字段，设 `STARTUPINFO.wShowWindow = SW_HIDE`。和 `CREATE_NO_WINDOW` 是**互补的双保险**：前者告诉 child「就算你 AllocConsole 了，窗口也别 show」，后者从 OS 层就不分配可见窗口。

> **本次踩坑**：第一版用 `DETACHED_PROCESS`，认为「没 console = 没窗口」。结果 npm.cmd 通过 cmd.exe 包装时仍弹黑窗。换成 `CREATE_NO_WINDOW + HideWindow:true` 后才稳。

## 四、pipe writer 是 child 的「生命线」

匿名 pipe 作 child stdin 的目的有 3 个：

1. 防止 child 误读 Chrome native messaging 的 stdin（污染协议）
2. pipe 无数据时 child read 阻塞 → 事件循环不空 → Node 不退出
3. 关 writer = 发 EOF = 「请优雅退出」的协议信号

**Go 端代码模式**（本仓库 `executor.go`）：

```go
stdinReader, stdinWriter, _ := os.Pipe()
cmd.Stdin = stdinReader
cmd.Start()
stdinReader.Close()                           // 父留 writer
processStdinWriters.Store(pid, stdinWriter)   // 保存到 sync.Map

// 想优雅停 child：
if w, ok := processStdinWriters.LoadAndDelete(pid); ok {
    w.(*os.File).Close()                      // EOF 信号
}
exec.Command("taskkill", "/PID", strconv.Itoa(pid)).Run()   // 兜底 graceful
time.Sleep(2 * time.Second)
if isProcessRunning(pid) { os.FindProcess(pid).Kill() }     // 兜底 force
```

**关键**：父进程**自己**退出会让 OS 关掉它持有的所有 pipe writer——这是「父退我也退」的根因。要让 child 活到自然死亡，父必须**手动撑着不退**：

```go
// stdin EOF 后不立即返回 main
<-stdinDone
for executor.HasActiveChildren() {
    time.Sleep(5 * time.Second)
}
```

## 五、Job Object：Chrome 的「连环杀」陷阱

Windows Job Object = 一组进程的容器，父被 close 时可以选择「容器内所有进程一起死」（`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`）。Chrome 给 native messaging host 加 Job 是合理的，但意味着：

- 默认情况下，child 是 native_host 的 Job 成员
- Chrome 关 native_host → Job 销毁 → 所有 child 强死（无 EOF，无清理机会）
- `CREATE_BREAKAWAY_FROM_JOB` = child 不入 Job，逃出生天

如果加了 breakaway 仍连坐，说明父 Job 设了 `JOB_OBJECT_LIMIT_BREAKAWAY_OK = false`——这种情况你需要在 child 真正想做的事之前再 fork 一次，或换 PowerShell 的 `Start-Process` 由 explorer 重新生父。

## 六、单例锁：状态文件 + name 是隐藏的多开杀手

很多 CLI 工具用 `~/.config/<name>.json` 存 pid 实现「同名只能跑一个」。第二次启动时 `readState() → isProcessAlive(pid) → return noop`。

本次案例：nx-sx 用 `~/.start-cli/<extractCommandName(command)>.json`，`extractCommandName('happy') = 'happy'`，所有 `nx-sx happy` 都打到 `happy.json` 上，第二个直接 noop。

**多开方案**：让 name 不冲突。三种粒度：

| 方案 | name 构造 | 后果 |
|---|---|---|
| cwd 哈希 | `${base}-${sha1(cwd).slice(0,8)}` | 不同目录可多开；同目录仍单例 |
| 每次随机 | `${base}-${randomBytes(4).hex}` | **任意场景都多开**（本次最终方案） |
| 全随机 + cwd 哈希 | `${base}-${cwdHash}-${nonce}` | 多开 + state 文件还能看出来源 |
| 调用方显式指定 | 读 `NXSX_INSTANCE_NAME` env | 调用方有 dedupe 需求时用 |

> **教训**：「单例」是设计选择，不是物理事实。打破它只需让 name 区分开。

## 七、taskkill 的两副面孔

```sh
taskkill /PID 1234           # 软杀：发 WM_CLOSE，让 GUI 进程有机会保存退出
taskkill /F /PID 1234        # 硬杀：TerminateProcess，没回调
taskkill /T /PID 1234        # 树杀：连 child 一起杀
taskkill /T /F /PID 1234     # 树 + 硬：核选项
```

**陷阱**：

- 不加 `/T`，console-only 进程 + 后台 GUI 窗口的组合可能只杀掉一半
- 加 `/T`，可能误伤同一 console 下的兄弟进程（罕见）
- 「停一个看起来关了全部」**多数时候是 UI 错觉**：另外几个本来就在 dead 状态，listProcesses 刷新一遍才暴露出来

## 八、常见失败模式速查

| 症状 | 99% 原因 | 第一动作 |
|---|---|---|
| child 启动 → 几秒后死 | pipe EOF 级联 / 父退出 / Job 连坐 | 看父进程是不是已经 exit |
| 启动时多出一个黑窗 | 用了 DETACHED 但走 `.cmd` 链路 | 换 `CREATE_NO_WINDOW + HideWindow:true` |
| 同一命令第二次启动「成功」但看不到效果 | 单例锁（状态文件 + name） | 看 `~/.<tool>/<name>.json` |
| 关一个连带关全部 | 单例锁导致只有一个真活着；其余在 list 里就是 dead | 真去检查每个 pid 的 `isProcessRunning` |
| Ctrl+C 没反应 | Windows console signal 路由复杂；child 没用 SetConsoleCtrlHandler | 走 pipe EOF 而不是 signal |
| Service Worker 30s 之后 child 死 | MV3 SW idle 收割 → port disconnect → stdin EOF 级联 | 父端「不要因 stdin EOF 退出」 |
| 加了 BREAKAWAY 仍连坐 | 父 Job 没允许 breakaway | 中间再 fork 一次（PowerShell `Start-Process`） |

## 九、诊断 Checklist

按顺序问自己：

1. **谁是父，谁是子？画一棵 `Get-Process | where parent_pid` 树**
2. **child 的 stdin/stdout/stderr 各连到哪？** 管道？文件？null？
3. **如果父被强杀，child 会怎么知道？** EOF？Job kill？无任何通知？
4. **child 自己有没有「父走我走」逻辑？** `process.on('exit')`、`unref()`、socket close 监听
5. **是不是有个状态文件在背后拦阻第二实例？** 找 `~/`、`%LOCALAPPDATA%`、`%TEMP%`
6. **CreateProcess 标志组合是否正确？** 对照第三节翻译表
7. **是否在 Job Object 里？** PowerShell：`Get-Process <name> | %{ $_.HandleCount, $_.PriorityClass }` 看不到 Job——只能信任 breakaway 是否生效（拔了 native_host 看 child 还在不在）

## 十、本仓库相关代码索引

- `native_host/internal/executor/executor.go` — pipe writer 模式 + CreationFlags + `HasActiveChildren()`
- `native_host/main.go` — stdin EOF 后等 child 死光再退
- `.claude/repo/nx-sx/src/cli.js` — instance name 多开方案（cwdHash + nonce + env override）
- `.claude/repo/nx-sx/src/web-control/git-bash-window-controller.js` — `Start-Process -WindowStyle Normal` 拉显式窗口；stopSync 走 `taskkill /T /F`

## 错误案例

| 错误操作 | 实际后果 | 正确做法 |
|---|---|---|
| 假设 `DETACHED_PROCESS` = 无窗口 | npm.cmd 仍弹黑窗 | `CREATE_NO_WINDOW + HideWindow:true` |
| 在父 (Go) 收到 stdin EOF 就 `return main` | 所有 child 的 pipe writer 被 OS 关，全连坐 | 父守活 `for HasActiveChildren()` 轮询 |
| 把 child 的 `process.on('exit') → stopSync()` 当无害 | child 任何意外退出都会反过来杀掉 UI 窗口 | 区分「主动 stop」「被动死」两条退出路径 |
| 第一反应：改 child 源码不让它自杀 | 破坏了 child 的清晰自治边界 | 优先在父这一侧解决（pipe writer 不关 / breakaway） |
| 用 cwd 哈希做单例锁的「修复」 | 同目录第二次启动仍 noop | nonce / env 双层：默认多开，env 显式 dedupe |
| 修测试时把 `deepEqual` 弱化为 `ok(name.includes(...))` | 失去对结构的保护 | 改成 `assert.match(regex)` + `assert.startsWith(prefix)` 多重锚定 |

## 成功标准检查清单

- [x] 创建独立目录 `.claude/skills/windows-process-ipc-pitfalls/`
- [x] SKILL.md 含 YAML frontmatter
- [x] `description` 是触发词清单，不是内容总结
- [x] 含心智模型（POSIX signal ≠ Windows）
- [x] 含 CreationFlags 翻译表
- [x] 含 pipe 生命线模式（含 Go 代码）
- [x] 含 Job Object 连坐 + breakaway 解释
- [x] 含单例锁多开方案
- [x] 含失败模式速查表
- [x] 含诊断 Checklist
- [x] 含本仓库代码索引
- [x] 含错误案例记录
