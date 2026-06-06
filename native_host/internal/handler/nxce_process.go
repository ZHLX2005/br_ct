// Package handler — nx-ce serve 进程管理
//
// 两个 handler:
//   - claudeStartServe:  启动 `npx nx-ce serve`（复用 executor.StartProcess 持 stdin pipe）
//   - claudeServeStatus: 读 ~/.nx-ce/instances/{name}.json，返回 lifecycle 状态
//
// 设计要点：
//   - nx-ce serve 是长寿命子进程，必须复用 executor 的 pipe writer 持锁机制，
//     否则 Chrome 断开 stdin → main.go 退出 → OS 关 pipe → nx-ce 误收 EOF 自杀。
//   - executor.StartProcess 已经会写日志到 ~/.bro_chat_native_host/logs/，
//     排错时直接看那里。
//   - 状态文件 ~/.nx-ce/instances/{key}.json 由 nx-ce 自身维护，
//     浏览器侧可读 lifecycleState 决定是否需要重启。
package handler

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"brochat_native_host/internal/executor"
	"brochat_native_host/internal/protocol"
)

// ClaudeStartServe 启动 npx nx-ce serve，复用 executor.StartProcess 持 pipe。
// 返回 { pid, name, cmd, args, logFile }。
//
// 入参：
//   - req.Name:    nx-ce 实例名（默认 "default"），对应 ~/.nx-ce/instances/{name}.json
//   - req.Port:    端口（默认 3100；0 = 默认）
//   - req.Model:   模型 ID（可选；空 = nx-ce 默认）
//   - req.Cwd:     nx-ce 启动时的默认 cwd（可选；运行时每个 query 可覆盖）
//   - req.WorkDir: native_host 视角的工作目录（npx 启动位置）
func ClaudeStartServe(req protocol.Request) protocol.Response {
	name := req.Name
	if name == "" {
		name = "default"
	}
	port := req.Port
	if port == 0 {
		port = 3100
	}

	args := []string{
		"nx-ce", "serve",
		"--name", name,
		"--port", fmt.Sprintf("%d", port),
	}
	if req.Model != "" {
		args = append(args, "--model", req.Model)
	}
	if req.Cwd != "" {
		args = append(args, "--cwd", req.Cwd)
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

// ClaudeServeStatus 读 ~/.nx-ce/instances/{name}.json。
// 浏览器侧依据 lifecycleState 决定是否需要重启。
// 文件不存在 → { exists: false, lifecycleState: "stopped" }。
//
// 入参：req.Name — nx-ce 实例名（默认 "default"）
func ClaudeServeStatus(req protocol.Request) protocol.Response {
	name := req.Name
	if name == "" {
		name = "default"
	}

	homeDir, _ := os.UserHomeDir()
	statePath := filepath.Join(homeDir, ".nx-ce", "instances", name+".json")

	data, err := os.ReadFile(statePath)
	if err != nil {
		if os.IsNotExist(err) {
			return protocol.Response{
				Status: "ok",
				Data: map[string]interface{}{
					"exists":         false,
					"name":           name,
					"lifecycleState": "stopped",
				},
			}
		}
		return protocol.Response{Status: "error", Message: "read state: " + err.Error()}
	}

	var state map[string]interface{}
	if err := json.Unmarshal(data, &state); err != nil {
		return protocol.Response{Status: "error", Message: "parse state: " + err.Error()}
	}
	state["exists"] = true
	state["name"] = name

	return protocol.Response{Status: "ok", Data: state}
}
