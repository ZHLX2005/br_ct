// Package handler — nx-ce serve 进程管理
//
// handler:
//   - claudeStartServe:  启动 `npx nx-ce serve`（复用 executor.StartProcess 持 stdin pipe）
//
// 设计要点：
//   - nx-ce serve 是长寿命子进程，必须复用 executor 的 pipe writer 持锁机制，
//     否则 Chrome 断开 stdin → main.go 退出 → OS 关 pipe → nx-ce 误收 EOF 自杀。
//   - executor.StartProcess 已经会写日志到 ~/.bro_chat_native_host/logs/，
//     排错时直接看那里。
package handler

import (
	"brochat_native_host/internal/executor"
	"brochat_native_host/internal/protocol"
)

// ClaudeStartServe 启动 npx nx-ce serve，复用 executor.StartProcess 持 pipe。
// 返回 { pid, name, cmd, args, logFile }。
//
// 入参：
//   - req.Name:    nx-ce 实例名（默认 "default"），对应 ~/.nx-ce/instances/{name}.json
//   - req.WorkDir: native_host 视角的工作目录（npx 启动位置；可选）
//
// 端口由 nx-ce serve 默认决定（43720），不在启动参数中硬编码。
func ClaudeStartServe(req protocol.Request) protocol.Response {
	name := req.Name
	if name == "" {
		name = "default"
	}

	args := []string{
		"nx-ce", "serve",
		"--name", name,
		"--port", "43720",
	}

	// 委托给 executor.StartProcess：它会持 stdin pipe writer、写进程状态、生成日志
	inner := protocol.Request{
		Command: "startProcess",
		Name:    "nxce-serve-" + name,
		Cmd:     "npx",
		Args:    args,
		WorkDir: req.WorkDir,
	}
	return executor.StartProcess(inner)
}
