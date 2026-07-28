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

	// 1. fetch 获取最新远程状态
	_, fetchErr := runGitCombined(dir, "fetch")
	if fetchErr != nil {
		result.Error = "git fetch 失败: " + fetchErr.Error()
		return protocol.Response{Status: "ok", Data: result}
	}

	// 2. pull 同步远程（自动合并）
	pullOut, pullErr := runGitCombined(dir, "pull", "--no-edit")
	if pullErr != nil {
		runGit(dir, "merge", "--abort")
		result.Error = "同步远程更新失败（可能存在冲突），已放弃合并。请手动处理后重试。\n" + pullOut
		return protocol.Response{Status: "ok", Data: result}
	}
	if pullOut != "" {
		result.Output = "已同步远程更新:\n" + pullOut + "\n"
	}

	// 3. add . 暂存所有变更
	addOut, addErr := runGitCombined(dir, "add", ".")
	if addErr != nil {
		result.Error = fmt.Sprintf("git add 失败: %v\n%v", addErr, addOut)
		return protocol.Response{Status: "ok", Data: result}
	}

	// 4. 检查是否有变更需要提交
	statusOut, _ := runGit(dir, "status", "--porcelain")
	if strings.TrimSpace(statusOut) == "" {
		// 没有变更，直接 push
		pushOut, pushErr := runGitCombined(dir, "push")
		result.Output += "无变更，已推送最新远程状态\n推送结果:\n" + pushOut
		if pushErr != nil {
			result.Error = pushErr.Error()
		} else {
			result.Success = true
		}
		return protocol.Response{Status: "ok", Data: result}
	}

	// 5. commit（无消息，自动生成）
	commitOut, commitErr := runGitCombined(dir, "commit", "-m", "auto sync")
	if commitErr != nil {
		result.Error = fmt.Sprintf("git commit 失败: %v\n%v", commitErr, commitOut)
		return protocol.Response{Status: "ok", Data: result}
	}
	result.Output += "已提交本地变更\n"

	// 6. push
	pushOut, pushErr := runGitCombined(dir, "push")
	result.Output += "推送结果:\n" + pushOut
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

// GitAutoCommitAndPush 先 pull 同步远程，再 add . && commit && push
func GitAutoCommitAndPush(req protocol.Request) protocol.Response {
	dir := req.Path
	message := req.Message
	if message == "" {
		message = "extension pull"
	}

	result := GitOperationResult{Dir: dir}

	// 1. 先 fetch 获取最新远程状态
	_, fetchErr := runGitCombined(dir, "fetch")
	if fetchErr != nil {
		result.Error = "git fetch 失败: " + fetchErr.Error()
		return protocol.Response{Status: "ok", Data: result}
	}

	// 2. 检查并自动合并远程更新
	status := gitStatusForDir(dir)
	if status.Behind > 0 {
		pullOut, pullErr := runGitCombined(dir, "pull", "--no-edit")
		if pullErr != nil {
			runGit(dir, "merge", "--abort")
			result.Error = "同步远程更新失败（可能存在冲突），已放弃合并。请手动处理后重试。\n" + pullOut
			return protocol.Response{Status: "ok", Data: result}
		}
		result.Output = "已同步远程更新:\n" + pullOut + "\n"
	}

	// 3. git add .
	addOut, addErr := runGitCombined(dir, "add", ".")
	if addErr != nil {
		result.Error = fmt.Sprintf("git add 失败: %v\n%v", addErr, addOut)
		return protocol.Response{Status: "ok", Data: result}
	}

	// 4. 检查是否有变更需要提交
	statusOut, _ := runGit(dir, "status", "--porcelain")
	if strings.TrimSpace(statusOut) == "" {
		result.Output += "No changes to commit"
		result.Success = true
		return protocol.Response{Status: "ok", Data: result}
	}

	// 5. git commit
	commitOut, commitErr := runGitCombined(dir, "commit", "-m", message)
	if commitErr != nil {
		result.Error = fmt.Sprintf("git commit 失败: %v\n%v", commitErr, commitOut)
		return protocol.Response{Status: "ok", Data: result}
	}
	if result.Output != "" {
		result.Output += "\n"
	}
	result.Output += commitOut + "\n"

	// 6. git push
	pushOut, pushErr := runGitCombined(dir, "push")
	if pushErr != nil {
		result.Error = result.Output + fmt.Sprintf("git push 失败: %v\n%v", pushErr, pushOut)
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

// GitDiscard 完全回退整个仓库到 HEAD (git reset --hard HEAD)
//
// 语义：撤销所有 tracked 文件的任何修改，不区分 staged / unstaged，
// 工作树恢复到与 HEAD 完全一致。未跟踪文件（'??' 状态）不在此命令范围，
// 需配合 GitClean (`git clean -fd`) 一起使用才能达到「完全干净」的效果。
//
// 之前实现是 `git reset HEAD`（mixed reset，只把 index 挪到 unstaged，
// 工作区文件内容不变），导致用户点「丢弃」后仍能看到修改文件残留。
func GitDiscard(req protocol.Request) protocol.Response {
	dir := req.Path
	result := GitOperationResult{Dir: dir}

	// 检查是否有 tracked 文件的任何变化（staged 或 worktree 修改）
	// x/y 任意一位是非空且非 '?'，就说明有 tracked 变更需要 hard reset
	statusOut, _ := runGit(dir, "status", "--porcelain", "-uall")
	hasChanges := false
	for _, line := range strings.Split(statusOut, "\n") {
		if len(line) >= 4 {
			x := line[0]
			y := line[1]
			// tracked 且有变更：x/y 至少一位不是空格，且都不是 '?'
			if (x != ' ' && x != '?') || (y != ' ' && y != '?') {
				hasChanges = true
				break
			}
		}
	}

	if !hasChanges {
		result.Output = "工作区没有需要回退的更改"
		result.Success = true
		return protocol.Response{Status: "ok", Data: result}
	}

	// 执行 git reset --hard HEAD：让工作树、index 完全回到 HEAD
	// 已 tracked 文件的任何修改（staged/unstaged）都被撤销
	// 未跟踪文件不受影响，由前端串接 gitClean 处理
	out, err := runGitCombined(dir, "reset", "--hard", "HEAD")
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
