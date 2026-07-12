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
	dir := req.Path
	result := GitOperationResult{Dir: dir}

	status := gitStatusForDir(dir)
	if status.Error != "" {
		result.Error = "无法读取状态: " + status.Error
		return protocol.Response{Status: "ok", Data: result}
	}

	// 1. 本地有未提交变更 → 拒绝
	if !status.Clean && status.Ahead == 0 && status.Behind == 0 {
		result.Error = "本地有未提交的变更，请先提交或丢弃后再推送"
		result.Output = formatStatusForUser(status)
		return protocol.Response{Status: "ok", Data: result}
	}

	// 2. 本地 ahead > 0 且 behind == 0 → 直接 push
	if status.Ahead > 0 {
		if status.Behind > 0 {
			// 双方都有提交：拒绝，要求手动处理
			result.Error = "本地和远程都有未同步的提交，请手动处理分歧后再推送"
			result.Output = formatStatusForUser(status)
			return protocol.Response{Status: "ok", Data: result}
		}
		out, err := runGitCombined(dir, "push")
		result.Output = out
		if err != nil {
			result.Error = err.Error()
		} else {
			result.Success = true
		}
		return protocol.Response{Status: "ok", Data: result}
	}

	// 3. ahead == 0 && behind == 0 → 无事可做
	if status.Behind == 0 {
		result.Output = "工作区干净，无需推送"
		result.Success = true
		return protocol.Response{Status: "ok", Data: result}
	}

	// 4. 远程有新 commit（behind > 0）→ 先 fetch + pull 自动合并，再 push
	fetchOut, fetchErr := runGitCombined(dir, "fetch")
	if fetchErr != nil {
		result.Error = "git fetch 失败: " + fetchErr.Error() + "\n" + fetchOut
		return protocol.Response{Status: "ok", Data: result}
	}

	pullOut, pullErr := runGitCombined(dir, "pull", "--no-edit")
	if pullErr != nil {
		// merge 冲突：abort 还原
		runGit(dir, "merge", "--abort")
		result.Error = "自动合并远程更新失败（可能存在冲突），已放弃合并。请手动处理后重试。\n" + pullOut
		return protocol.Response{Status: "ok", Data: result}
	}

	pushOut, pushErr := runGitCombined(dir, "push")
	result.Output = "已自动同步远程更新：\n" + pullOut + "\n\n推送结果：\n" + pushOut
	if pushErr != nil {
		result.Error = pushErr.Error()
	} else {
		result.Success = true
	}
	return protocol.Response{Status: "ok", Data: result}
}

// formatStatusForUser 把 gitStatus 格式化为用户友好的字符串
func formatStatusForUser(status GitStatusInfo) string {
	lines := []string{
		fmt.Sprintf("分支：%s", status.Branch),
		fmt.Sprintf("领先远程：%d，落后远程：%d", status.Ahead, status.Behind),
	}
	if len(status.Staged) > 0 {
		lines = append(lines, fmt.Sprintf("已暂存 (%d)：%s", len(status.Staged), strings.Join(status.Staged, ", ")))
	}
	if len(status.Modified) > 0 {
		lines = append(lines, fmt.Sprintf("已修改 (%d)：%s", len(status.Modified), strings.Join(status.Modified, ", ")))
	}
	if len(status.Untracked) > 0 {
		lines = append(lines, fmt.Sprintf("未跟踪 (%d)：%s", len(status.Untracked), strings.Join(status.Untracked, ", ")))
	}
	return strings.Join(lines, "\n")
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
			// 复用 GitPush 逻辑（单目录智能 push：干净 → push；远程落后 → 自动合并）
			subReq := protocol.Request{Command: "gitPush", Path: d}
			resp := GitPush(subReq)
			result := GitOperationResult{Dir: d}
			if data, ok := resp.Data.(GitOperationResult); ok {
				result = data
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
	case <-time.After(120 * time.Second):
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
