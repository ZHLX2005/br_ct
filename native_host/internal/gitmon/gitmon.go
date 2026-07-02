package gitmon

import (
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"

	"brochat_native_host/internal/protocol"
)

type GitStatusInfo struct {
	Dir          string   `json:"dir"`
	Branch       string   `json:"branch"`
	Ahead        int      `json:"ahead"`
	Behind       int      `json:"behind"`
	Staged       []string `json:"staged"`
	Modified     []string `json:"modified"`
	Untracked    []string `json:"untracked"`
	StagedCount  int      `json:"stagedCount"`
	ModCount     int      `json:"modCount"`
	UntrackCount int      `json:"untrackCount"`
	Clean        bool     `json:"clean"`
	Error        string   `json:"error,omitempty"`
}

type GitOperationResult struct {
	Dir     string `json:"dir"`
	Output  string `json:"output"`
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

func runGit(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.Output()
	return strings.TrimSpace(string(out)), err
}

func runGitCombined(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

func GitStatus(req protocol.Request) protocol.Response {
	info := gitStatusForDir(req.Path)
	if info.Error != "" {
		return protocol.Response{Status: "error", Message: info.Error}
	}
	return protocol.Response{Status: "ok", Data: info}
}

func GitPull(req protocol.Request) protocol.Response {
	out, err := runGitCombined(req.Path, "pull")
	result := GitOperationResult{Dir: req.Path, Output: out}
	if err != nil {
		result.Error = err.Error()
	} else {
		result.Success = true
	}
	return protocol.Response{Status: "ok", Data: result}
}

func GitPush(req protocol.Request) protocol.Response {
	out, err := runGitCombined(req.Path, "push")
	result := GitOperationResult{Dir: req.Path, Output: out}
	if err != nil {
		result.Error = err.Error()
	} else {
		result.Success = true
	}
	return protocol.Response{Status: "ok", Data: result}
}

func GitBatchStatus(req protocol.Request) protocol.Response {
	results := make([]GitStatusInfo, len(req.Dirs))
	var wg sync.WaitGroup
	var mu sync.Mutex

	for i, dir := range req.Dirs {
		wg.Add(1)
		go func(idx int, d string) {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil {
					mu.Lock()
					results[idx] = GitStatusInfo{Dir: d, Error: fmt.Sprintf("panic: %v", r)}
					mu.Unlock()
				}
			}()
			status := gitStatusForDir(d)
			mu.Lock()
			results[idx] = status
			mu.Unlock()
		}(i, dir)
	}

	// 超时保护
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(30 * time.Second):
		// 超时后返回已收集的结果
	}
	return protocol.Response{Status: "ok", Data: results}
}

func GitBatchPull(req protocol.Request) protocol.Response {
	results := make([]GitOperationResult, len(req.Dirs))
	var wg sync.WaitGroup
	var mu sync.Mutex

	for i, dir := range req.Dirs {
		wg.Add(1)
		go func(idx int, d string) {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil {
					mu.Lock()
					results[idx] = GitOperationResult{Dir: d, Error: fmt.Sprintf("panic: %v", r)}
					mu.Unlock()
				}
			}()
			out, err := runGitCombined(d, "pull")
			result := GitOperationResult{Dir: d, Output: out}
			if err != nil {
				result.Error = err.Error()
			} else {
				result.Success = true
			}
			mu.Lock()
			results[idx] = result
			mu.Unlock()
		}(i, dir)
	}

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(60 * time.Second):
	}
	return protocol.Response{Status: "ok", Data: results}
}

func GitBatchPush(req protocol.Request) protocol.Response {
	results := make([]GitOperationResult, len(req.Dirs))
	var wg sync.WaitGroup
	var mu sync.Mutex

	for i, dir := range req.Dirs {
		wg.Add(1)
		go func(idx int, d string) {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil {
					mu.Lock()
					results[idx] = GitOperationResult{Dir: d, Error: fmt.Sprintf("panic: %v", r)}
					mu.Unlock()
				}
			}()
			out, err := runGitCombined(d, "push")
			result := GitOperationResult{Dir: d, Output: out}
			if err != nil {
				result.Error = err.Error()
			} else {
				result.Success = true
			}
			mu.Lock()
			results[idx] = result
			mu.Unlock()
		}(i, dir)
	}

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(60 * time.Second):
	}
	return protocol.Response{Status: "ok", Data: results}
}

// GitBatchFetch fetch 所有目录后返回最新 status
func GitBatchFetch(req protocol.Request) protocol.Response {
	results := make([]GitStatusInfo, len(req.Dirs))
	var wg sync.WaitGroup
	var mu sync.Mutex

	for i, dir := range req.Dirs {
		wg.Add(1)
		go func(idx int, d string) {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil {
					mu.Lock()
					results[idx] = GitStatusInfo{Dir: d, Error: fmt.Sprintf("panic: %v", r)}
					mu.Unlock()
				}
			}()
			runGit(d, "fetch")
			status := gitStatusForDir(d)
			mu.Lock()
			results[idx] = status
			mu.Unlock()
		}(i, dir)
	}

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(30 * time.Second):
	}
	return protocol.Response{Status: "ok", Data: results}
}

// GitAutoCommitAndPush 执行 git add . && git commit -m "msg" && git push
func GitAutoCommitAndPush(req protocol.Request) protocol.Response {
	dir := req.Path
	message := req.Message
	if message == "" {
		message = "extension pull"
	}

	result := GitOperationResult{Dir: dir}

	// 1. git add .
	addOut, err := runGitCombined(dir, "add", ".")
	if err != nil {
		result.Error = fmt.Sprintf("git add 失败: %v\n%v", err, addOut)
		return protocol.Response{Status: "ok", Data: result}
	}

	// 2. 检查是否有变更需要提交
	statusOut, _ := runGit(dir, "status", "--porcelain")
	if strings.TrimSpace(statusOut) == "" {
		result.Output = "No changes to commit"
		result.Success = true
		return protocol.Response{Status: "ok", Data: result}
	}

	// 3. git commit
	commitOut, err := runGitCombined(dir, "commit", "-m", message)
	if err != nil {
		result.Error = fmt.Sprintf("git commit 失败: %v\n%v", err, commitOut)
		return protocol.Response{Status: "ok", Data: result}
	}
	result.Output = commitOut + "\n"

	// 4. git push
	pushOut, err := runGitCombined(dir, "push")
	if err != nil {
		result.Error = result.Output + fmt.Sprintf("git push 失败: %v\n%v", err, pushOut)
		return protocol.Response{Status: "ok", Data: result}
	}
	result.Output += pushOut
	result.Success = true
	return protocol.Response{Status: "ok", Data: result}
}

// GitClean 清理未跟踪文件和目录 (git clean -fd)
func GitClean(req protocol.Request) protocol.Response {
	dir := req.Path
	result := GitOperationResult{Dir: dir}

	// 先检查是否有未跟踪文件
	statusOut, _ := runGit(dir, "status", "--porcelain", "-uall")
	if strings.TrimSpace(statusOut) == "" {
		result.Output = "没有需要清理的文件"
		result.Success = true
		return protocol.Response{Status: "ok", Data: result}
	}

	// 执行 git clean -fd 清理未跟踪文件和目录
	out, err := runGitCombined(dir, "clean", "-fd")
	result.Output = out
	if err != nil {
		result.Error = err.Error()
	} else {
		result.Success = true
	}
	return protocol.Response{Status: "ok", Data: result}
}

// GitDiscard 丢弃所有暂存区的更改 (git reset HEAD)
func GitDiscard(req protocol.Request) protocol.Response {
	dir := req.Path
	result := GitOperationResult{Dir: dir}

	// 检查是否有暂存的内容
	statusOut, _ := runGit(dir, "status", "--porcelain", "-uall")
	hasStaged := false
	for _, line := range strings.Split(statusOut, "\n") {
		if len(line) >= 4 {
			x := line[0]
			if x != ' ' && x != '?' {
				hasStaged = true
				break
			}
		}
	}

	if !hasStaged {
		result.Output = "暂存区没有需要丢弃的更改"
		result.Success = true
		return protocol.Response{Status: "ok", Data: result}
	}

	// 执行 git reset HEAD 丢弃所有暂存区的更改
	out, err := runGitCombined(dir, "reset", "HEAD")
	result.Output = out
	if err != nil {
		result.Error = err.Error()
	} else {
		result.Success = true
	}
	return protocol.Response{Status: "ok", Data: result}
}

func gitStatusForDir(dir string) GitStatusInfo {
	info := GitStatusInfo{Dir: dir}

	if out, err := runGit(dir, "rev-parse", "--abbrev-ref", "HEAD"); err == nil {
		info.Branch = out
	} else {
		info.Error = fmt.Sprintf("无法读取分支: %v", err)
		return info
	}

	if out, err := runGit(dir, "rev-list", "--left-right", "--count", "@{upstream}...HEAD"); err == nil {
		parts := strings.Split(out, "\t")
		if len(parts) == 2 {
			fmt.Sscanf(parts[0], "%d", &info.Behind)
			fmt.Sscanf(parts[1], "%d", &info.Ahead)
		}
	}

	// -uall: 列出所有未跟踪文件（不折叠为目录）
	if out, err := runGit(dir, "status", "--porcelain", "-uall"); err == nil {
		lines := strings.Split(out, "\n")
		for _, line := range lines {
			if len(line) < 4 {
				continue
			}
			x := line[0] // index 状态
			y := line[1] // worktree 状态
			file := line[3:]

			if x == '?' && y == '?' {
				info.Untracked = append(info.Untracked, file)
			} else if x != ' ' && x != '?' {
				info.Staged = append(info.Staged, file)
			}
			if y != ' ' && y != '?' {
				info.Modified = append(info.Modified, file)
			}
		}
	}

	info.StagedCount = len(info.Staged)
	info.ModCount = len(info.Modified)
	info.UntrackCount = len(info.Untracked)
	info.Clean = info.StagedCount == 0 && info.ModCount == 0 && info.UntrackCount == 0 && info.Ahead == 0 && info.Behind == 0
	return info
}
