package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"

	"brochat_native_host/internal/envvars"
	"brochat_native_host/internal/executor"
	"brochat_native_host/internal/fileops"
	"brochat_native_host/internal/gitmon"
	"brochat_native_host/internal/handler"
	"brochat_native_host/internal/protocol"
	"brochat_native_host/internal/prompts"
	"brochat_native_host/internal/register"
)

func main() {
	register.EnsureRegistered()

	registry := handler.NewRegistry()

	// 文件操作
	registry.Register("readFile", fileops.ReadFile)
	registry.Register("writeFile", fileops.WriteFile)
	registry.Register("listDir", fileops.ListDir)
	registry.Register("scanSkills", fileops.ScanSkills)
	registry.Register("syncSkillDir", fileops.SyncSkillDir)
	registry.Register("deleteSkill", fileops.DeleteSkill)
	registry.Register("saveSkillGroups", fileops.SaveSkillGroups)
	registry.Register("readSetting", fileops.ReadSetting)

	// 提示词
	registry.Register("parsePrompts", prompts.ParsePromptsFile)
	registry.Register("savePrompts", prompts.SavePromptsFile)
	registry.Register("getPromptsDir", prompts.GetPromptsDir)
	registry.Register("createBackup", prompts.CreateBackup)

	// 命令执行与子进程管理
	registry.Register("startProcess", executor.StartProcess)
	registry.Register("stopProcess", executor.StopProcess)
	registry.Register("listProcesses", executor.ListProcesses)
	registry.Register("removeProcess", executor.RemoveProcess)

	// Git 监控
	registry.Register("gitStatus", gitmon.GitStatus)
	registry.Register("gitPull", gitmon.GitPull)
	registry.Register("gitPush", gitmon.GitPush)
	registry.Register("gitBatchStatus", gitmon.GitBatchStatus)
	registry.Register("gitBatchFetch", gitmon.GitBatchFetch)
	registry.Register("gitBatchPull", gitmon.GitBatchPull)
	registry.Register("gitBatchPush", gitmon.GitBatchPush)
	registry.Register("gitAutoCommitAndPush", gitmon.GitAutoCommitAndPush)

	// 环境变量管理
	registry.Register("saveEnvSnapshot", envvars.SaveSnapshot)
	registry.Register("listEnvSnapshots", envvars.ListSnapshots)
	registry.Register("restoreEnvSnapshot", envvars.RestoreSnapshot)
	registry.Register("getUserPath", envvars.GetUserPath)
	registry.Register("addUserPath", envvars.AddUserPath)
	registry.Register("removeUserPath", envvars.RemoveUserPath)
	registry.Register("batchRemoveUserPath", envvars.BatchRemoveUserPath)
	registry.Register("getSystemPath", envvars.GetSystemPath)
	registry.Register("addSystemPath", envvars.AddSystemPath)
	registry.Register("removeSystemPath", envvars.RemoveSystemPath)
	registry.Register("batchRemoveSystemPath", envvars.BatchRemoveSystemPath)
	registry.Register("getUserEnvVars", envvars.GetUserEnvVars)
	registry.Register("setUserEnvVar", envvars.SetUserEnvVar)
	registry.Register("removeUserEnvVar", envvars.RemoveUserEnvVar)
	registry.Register("getSystemEnvVars", envvars.GetSystemEnvVars)
	registry.Register("setSystemEnvVar", envvars.SetSystemEnvVar)
	registry.Register("removeSystemEnvVar", envvars.RemoveSystemEnvVar)

	// Claude Query
	registry.Register("claudeQuery", handleClaudeQuery)
	registry.Register("getClaudeSkills", handleGetClaudeSkills)

	// 消息循环：放在 goroutine 里，让 main 在 stdin EOF 后还能继续做 children
	// 的 pipe writer 持有者，避免 Chrome SW 断开时连坐杀死长寿命 child（如 nx-sx happy）。
	stdin := os.Stdin
	stdout := os.Stdout

	stdinDone := make(chan struct{})
	go func() {
		defer close(stdinDone)
		for {
			req, err := protocol.ReadMessage(stdin)
			if err != nil {
				if err != io.EOF {
					fmt.Fprintf(os.Stderr, "Error: %v\n", err)
				}
				return
			}
			resp := registry.Handle(req.Command, req)
			protocol.SendResponse(stdout, resp)
		}
	}()

	<-stdinDone

	// Chrome 已断开 stdin，但只要还有 active child 就不能退出——
	// 进程退出会导致 OS 关闭 processStdinWriters 里的 pipe writer，children 会读到
	// 意外 EOF 进而自毁。轮询等待所有 child 自然终止。
	for executor.HasActiveChildren() {
		time.Sleep(5 * time.Second)
	}
}

// handleClaudeQuery 将 Chrome 的 claudeQuery 请求转发给 npx nx-ce query。
// 输入: { command: "claudeQuery", sessionId, prompt, workDir, skills }
// 输出: { status: "ok", data: { text, sessionId } }
func handleClaudeQuery(req protocol.Request) protocol.Response {
	prompt := req.Prompt
	if prompt == "" {
		prompt = req.Content
	}
	args := []string{"nx-ce", "query", prompt}
	if req.SessionId != "" {
		args = append(args, "--resume", req.SessionId)
	}
	if req.Skills != "" {
		args = append(args, "--skill", strings.ReplaceAll(req.Skills, ",", ","))
	}
	if req.WorkDir != "" {
		args = append(args, "--cwd", req.WorkDir)
	}

	cmd := exec.Command("npx", args...)
	output, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return protocol.Response{Status: "error", Message: string(exitErr.Stderr)}
		}
		return protocol.Response{Status: "error", Message: err.Error()}
	}

	var result struct {
		Text      string `json:"text"`
		SessionId string `json:"sessionId"`
	}
	if err := json.Unmarshal(output, &result); err != nil {
		return protocol.Response{Status: "error", Message: "parse nx-ce output: " + err.Error()}
	}

	// 如果没有返回 sessionId（首次对话），使用传入的 sessionId
	if result.SessionId == "" {
		result.SessionId = req.SessionId
	}

	return protocol.Response{
		Status: "ok",
		Data: map[string]interface{}{
			"text":      result.Text,
			"sessionId": result.SessionId,
		},
	}
}

// handleGetClaudeSkills 通过 nx-ce 获取 SDK 可用的 skill 列表。
// 调用 npx nx-ce query "" --include-metadata 获取 metadata.skills。
func handleGetClaudeSkills(req protocol.Request) protocol.Response {
	cmd := exec.Command("npx", "nx-ce", "skills")
	output, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return protocol.Response{Status: "error", Message: string(exitErr.Stderr)}
		}
		return protocol.Response{Status: "error", Message: err.Error()}
	}

	var result map[string]interface{}
	if err := json.Unmarshal(output, &result); err != nil {
		return protocol.Response{Status: "error", Message: "parse nx-ce output: " + err.Error()}
	}

	return protocol.Response{
		Status: "ok",
		Data:   result,
	}
}
