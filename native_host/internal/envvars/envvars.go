package envvars

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"brochat_native_host/internal/protocol"

	"golang.org/x/sys/windows/registry"
)

// PathEntry 单条 PATH 记录
type PathEntry struct {
	Index int    `json:"index"`
	Path  string `json:"path"`
}

// EnvVar 单个环境变量
type EnvVar struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// Snapshot 完整环境变量快照
type Snapshot struct {
	Timestamp   string      `json:"timestamp"`
	UserPath    []PathEntry `json:"userPath"`
	SystemPath  []PathEntry `json:"systemPath"`
	UserVars    []EnvVar    `json:"userVars"`
	SystemVars  []EnvVar    `json:"systemVars"`
	ProcessEnv  []EnvVar    `json:"processEnv"`
}

func notifyChange() {
	user32 := syscall.NewLazyDLL("user32.dll")
	sendMsg := user32.NewProc("SendMessageTimeoutW")
	var result uintptr
	sendMsg.Call(
		uintptr(0xffff),       // HWND_BROADCAST
		uintptr(0x001A),       // WM_SETTINGCHANGE
		0,
		uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr("Environment"))),
		uintptr(0x0002),       // SMTO_ABORTIFHUNG
		5000,
		result,
	)
}

func snapDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".bro_chat_native_host")
}

func ensureSnapDir() error {
	dir := snapDir()
	return os.MkdirAll(dir, 0755)
}

// ===== 快照 =====

func SaveSnapshot(req protocol.Request) protocol.Response {
	if err := ensureSnapDir(); err != nil {
		return protocol.Response{Status: "error", Message: "创建快照目录失败: " + err.Error()}
	}

	userKey, err := registry.OpenKey(registry.CURRENT_USER, `Environment`, registry.QUERY_VALUE)
	if err != nil {
		return protocol.Response{Status: "error", Message: "打开用户注册表失败: " + err.Error()}
	}
	defer userKey.Close()

	snap := Snapshot{
		Timestamp:  time.Now().Format(time.RFC3339),
		UserPath:   getPathEntries(userKey),
		UserVars:   getEnvVars(userKey),
		ProcessEnv: getProcessEnv(),
	}

	systemKey, err := registry.OpenKey(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Control\Session Manager\Environment`, registry.QUERY_VALUE)
	if err == nil {
		snap.SystemPath = getPathEntries(systemKey)
		snap.SystemVars = getEnvVars(systemKey)
		systemKey.Close()
	}

	data, _ := json.MarshalIndent(snap, "", "  ")
	filename := filepath.Join(snapDir(), "env_snapshot_"+time.Now().Format("20060102_150405")+".json")
	if err := os.WriteFile(filename, data, 0644); err != nil {
		return protocol.Response{Status: "error", Message: "写入快照失败: " + err.Error()}
	}

	return protocol.Response{Status: "ok", Data: map[string]string{"file": filename}}
}

func ListSnapshots(req protocol.Request) protocol.Response {
	if err := ensureSnapDir(); err != nil {
		return protocol.Response{Status: "error", Message: err.Error()}
	}
	entries, err := os.ReadDir(snapDir())
	if err != nil {
		return protocol.Response{Status: "error", Message: err.Error()}
	}
	var files []string
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "env_snapshot_") && strings.HasSuffix(e.Name(), ".json") {
			files = append(files, filepath.Join(snapDir(), e.Name()))
		}
	}
	return protocol.Response{Status: "ok", Data: files}
}

// ===== 用户 PATH =====

func GetUserPath(req protocol.Request) protocol.Response {
	key, err := registry.OpenKey(registry.CURRENT_USER, `Environment`, registry.QUERY_VALUE)
	if err != nil {
		return protocol.Response{Status: "error", Message: err.Error()}
	}
	defer key.Close()
	return protocol.Response{Status: "ok", Data: getPathEntries(key)}
}

func AddUserPath(req protocol.Request) protocol.Response {
	if req.Path == "" {
		return protocol.Response{Status: "error", Message: "path 不能为空"}
	}
	key, err := registry.OpenKey(registry.CURRENT_USER, `Environment`, registry.ALL_ACCESS)
	if err != nil {
		return protocol.Response{Status: "error", Message: err.Error()}
	}
	defer key.Close()

	current, _, _ := key.GetStringValue("Path")
	paths := parsePaths(current)
	for _, p := range paths {
		if strings.EqualFold(p, req.Path) {
			return protocol.Response{Status: "error", Message: "路径已存在"}
		}
	}

	newPath := req.Path
	if current != "" {
		newPath = req.Path + ";" + current
	}
	if err := key.SetStringValue("Path", newPath); err != nil {
		return protocol.Response{Status: "error", Message: err.Error()}
	}
	notifyChange()
	return protocol.Response{Status: "ok", Data: getPathEntries(key)}
}

func RemoveUserPath(req protocol.Request) protocol.Response {
	if req.Path == "" {
		return protocol.Response{Status: "error", Message: "path 不能为空"}
	}
	key, err := registry.OpenKey(registry.CURRENT_USER, `Environment`, registry.ALL_ACCESS)
	if err != nil {
		return protocol.Response{Status: "error", Message: err.Error()}
	}
	defer key.Close()

	current, _, _ := key.GetStringValue("Path")
	paths := parsePaths(current)
	var kept []string
	for _, p := range paths {
		if strings.EqualFold(p, req.Path) {
			continue
		}
		kept = append(kept, p)
	}
	if err := key.SetStringValue("Path", strings.Join(kept, ";")); err != nil {
		return protocol.Response{Status: "error", Message: err.Error()}
	}
	notifyChange()
	return protocol.Response{Status: "ok", Data: getPathEntries(key)}
}

// ===== 系统 PATH =====

func GetSystemPath(req protocol.Request) protocol.Response {
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Control\Session Manager\Environment`, registry.QUERY_VALUE)
	if err != nil {
		return protocol.Response{Status: "error", Message: "需要管理员权限: " + err.Error()}
	}
	defer key.Close()
	return protocol.Response{Status: "ok", Data: getPathEntries(key)}
}

func AddSystemPath(req protocol.Request) protocol.Response {
	if req.Path == "" {
		return protocol.Response{Status: "error", Message: "path 不能为空"}
	}
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Control\Session Manager\Environment`, registry.ALL_ACCESS)
	if err != nil {
		return protocol.Response{Status: "error", Message: "需要管理员权限: " + err.Error()}
	}
	defer key.Close()

	current, _, _ := key.GetStringValue("Path")
	paths := parsePaths(current)
	for _, p := range paths {
		if strings.EqualFold(p, req.Path) {
			return protocol.Response{Status: "error", Message: "路径已存在"}
		}
	}

	newPath := req.Path
	if current != "" {
		newPath = req.Path + ";" + current
	}
	if err := key.SetStringValue("Path", newPath); err != nil {
		return protocol.Response{Status: "error", Message: err.Error()}
	}
	notifyChange()
	return protocol.Response{Status: "ok", Data: getPathEntries(key)}
}

func RemoveSystemPath(req protocol.Request) protocol.Response {
	if req.Path == "" {
		return protocol.Response{Status: "error", Message: "path 不能为空"}
	}
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Control\Session Manager\Environment`, registry.ALL_ACCESS)
	if err != nil {
		return protocol.Response{Status: "error", Message: "需要管理员权限: " + err.Error()}
	}
	defer key.Close()

	current, _, _ := key.GetStringValue("Path")
	paths := parsePaths(current)
	var kept []string
	for _, p := range paths {
		if strings.EqualFold(p, req.Path) {
			continue
		}
		kept = append(kept, p)
	}
	if err := key.SetStringValue("Path", strings.Join(kept, ";")); err != nil {
		return protocol.Response{Status: "error", Message: err.Error()}
	}
	notifyChange()
	return protocol.Response{Status: "ok", Data: getPathEntries(key)}
}

// ===== 用户环境变量 =====

func GetUserEnvVars(req protocol.Request) protocol.Response {
	key, err := registry.OpenKey(registry.CURRENT_USER, `Environment`, registry.QUERY_VALUE)
	if err != nil {
		return protocol.Response{Status: "error", Message: err.Error()}
	}
	defer key.Close()
	return protocol.Response{Status: "ok", Data: getEnvVars(key)}
}

func SetUserEnvVar(req protocol.Request) protocol.Response {
	if req.Name == "" {
		return protocol.Response{Status: "error", Message: "name 不能为空"}
	}
	key, err := registry.OpenKey(registry.CURRENT_USER, `Environment`, registry.ALL_ACCESS)
	if err != nil {
		return protocol.Response{Status: "error", Message: err.Error()}
	}
	defer key.Close()

	if err := key.SetStringValue(req.Name, req.Path); err != nil {
		return protocol.Response{Status: "error", Message: err.Error()}
	}
	notifyChange()
	return protocol.Response{Status: "ok"}
}

func RemoveUserEnvVar(req protocol.Request) protocol.Response {
	if req.Name == "" {
		return protocol.Response{Status: "error", Message: "name 不能为空"}
	}
	key, err := registry.OpenKey(registry.CURRENT_USER, `Environment`, registry.ALL_ACCESS)
	if err != nil {
		return protocol.Response{Status: "error", Message: err.Error()}
	}
	defer key.Close()

	if err := key.DeleteValue(req.Name); err != nil {
		return protocol.Response{Status: "error", Message: err.Error()}
	}
	notifyChange()
	return protocol.Response{Status: "ok"}
}

// ===== 系统环境变量 =====

func GetSystemEnvVars(req protocol.Request) protocol.Response {
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Control\Session Manager\Environment`, registry.QUERY_VALUE)
	if err != nil {
		return protocol.Response{Status: "error", Message: "需要管理员权限: " + err.Error()}
	}
	defer key.Close()
	return protocol.Response{Status: "ok", Data: getEnvVars(key)}
}

func SetSystemEnvVar(req protocol.Request) protocol.Response {
	if req.Name == "" {
		return protocol.Response{Status: "error", Message: "name 不能为空"}
	}
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Control\Session Manager\Environment`, registry.ALL_ACCESS)
	if err != nil {
		return protocol.Response{Status: "error", Message: "需要管理员权限: " + err.Error()}
	}
	defer key.Close()

	if err := key.SetStringValue(req.Name, req.Path); err != nil {
		return protocol.Response{Status: "error", Message: err.Error()}
	}
	notifyChange()
	return protocol.Response{Status: "ok"}
}

func RemoveSystemEnvVar(req protocol.Request) protocol.Response {
	if req.Name == "" {
		return protocol.Response{Status: "error", Message: "name 不能为空"}
	}
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Control\Session Manager\Environment`, registry.ALL_ACCESS)
	if err != nil {
		return protocol.Response{Status: "error", Message: "需要管理员权限: " + err.Error()}
	}
	defer key.Close()

	if err := key.DeleteValue(req.Name); err != nil {
		return protocol.Response{Status: "error", Message: err.Error()}
	}
	notifyChange()
	return protocol.Response{Status: "ok"}
}

// ===== 辅助函数 =====

func getPathEntries(key registry.Key) []PathEntry {
	val, _, err := key.GetStringValue("Path")
	if err != nil {
		return []PathEntry{}
	}
	paths := parsePaths(val)
	entries := make([]PathEntry, len(paths))
	for i, p := range paths {
		entries[i] = PathEntry{Index: i, Path: p}
	}
	return entries
}

func getEnvVars(key registry.Key) []EnvVar {
	names, err := key.ReadValueNames(-1)
	if err != nil {
		return []EnvVar{}
	}
	var vars []EnvVar
	for _, name := range names {
		if strings.EqualFold(name, "Path") {
			continue
		}
		val, _, err := key.GetStringValue(name)
		if err == nil {
			vars = append(vars, EnvVar{Name: name, Value: val})
		}
	}
	return vars
}

func getProcessEnv() []EnvVar {
	var vars []EnvVar
	for _, e := range os.Environ() {
		parts := strings.SplitN(e, "=", 2)
		if len(parts) == 2 {
			vars = append(vars, EnvVar{Name: parts[0], Value: parts[1]})
		}
	}
	return vars
}

func parsePaths(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ";") {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// ===== 批量操作 =====

func BatchRemoveUserPath(req protocol.Request) protocol.Response {
	if len(req.Dirs) == 0 {
		return protocol.Response{Status: "error", Message: "dirs 不能为空"}
	}
	key, err := registry.OpenKey(registry.CURRENT_USER, `Environment`, registry.ALL_ACCESS)
	if err != nil {
		return protocol.Response{Status: "error", Message: err.Error()}
	}
	defer key.Close()

	current, _, _ := key.GetStringValue("Path")
	paths := parsePaths(current)
	removed := 0
	var kept []string
	for _, p := range paths {
		shouldRemove := false
		for _, target := range req.Dirs {
			if strings.EqualFold(p, target) {
				shouldRemove = true
				break
			}
		}
		if shouldRemove {
			removed++
		} else {
			kept = append(kept, p)
		}
	}
	if err := key.SetStringValue("Path", strings.Join(kept, ";")); err != nil {
		return protocol.Response{Status: "error", Message: err.Error()}
	}
	notifyChange()
	return protocol.Response{Status: "ok", Data: map[string]int{"removed": removed}}
}

func BatchRemoveSystemPath(req protocol.Request) protocol.Response {
	if len(req.Dirs) == 0 {
		return protocol.Response{Status: "error", Message: "dirs 不能为空"}
	}
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Control\Session Manager\Environment`, registry.ALL_ACCESS)
	if err != nil {
		return protocol.Response{Status: "error", Message: "需要管理员权限: " + err.Error()}
	}
	defer key.Close()

	current, _, _ := key.GetStringValue("Path")
	paths := parsePaths(current)
	removed := 0
	var kept []string
	for _, p := range paths {
		shouldRemove := false
		for _, target := range req.Dirs {
			if strings.EqualFold(p, target) {
				shouldRemove = true
				break
			}
		}
		if shouldRemove {
			removed++
		} else {
			kept = append(kept, p)
		}
	}
	if err := key.SetStringValue("Path", strings.Join(kept, ";")); err != nil {
		return protocol.Response{Status: "error", Message: err.Error()}
	}
	notifyChange()
	return protocol.Response{Status: "ok", Data: map[string]int{"removed": removed}}
}

// RestoreSnapshot 从快照文件恢复用户环境变量和 PATH（仅限用户级别）
func RestoreSnapshot(req protocol.Request) protocol.Response {
	if req.Path == "" {
		return protocol.Response{Status: "error", Message: "path 不能为空（快照文件路径）"}
	}
	data, err := os.ReadFile(req.Path)
	if err != nil {
		return protocol.Response{Status: "error", Message: "读取快照失败: " + err.Error()}
	}
	var snap Snapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		return protocol.Response{Status: "error", Message: "解析快照失败: " + err.Error()}
	}

	key, err := registry.OpenKey(registry.CURRENT_USER, `Environment`, registry.ALL_ACCESS)
	if err != nil {
		return protocol.Response{Status: "error", Message: err.Error()}
	}
	defer key.Close()

	// 恢复 PATH
	var paths []string
	for _, p := range snap.UserPath {
		paths = append(paths, p.Path)
	}
	if err := key.SetStringValue("Path", strings.Join(paths, ";")); err != nil {
		return protocol.Response{Status: "error", Message: "恢复 PATH 失败: " + err.Error()}
	}

	// 恢复环境变量（先清理现有非 PATH 变量，再写入快照中的）
	existingNames, _ := key.ReadValueNames(-1)
	for _, name := range existingNames {
		if !strings.EqualFold(name, "Path") {
			key.DeleteValue(name)
		}
	}
	for _, v := range snap.UserVars {
		if err := key.SetStringValue(v.Name, v.Value); err != nil {
			return protocol.Response{Status: "error", Message: fmt.Sprintf("恢复变量 %s 失败: %v", v.Name, err)}
		}
	}

	notifyChange()
	return protocol.Response{Status: "ok", Message: "已恢复快照"}
}

// ===== 路径探查：三种解析器取同名执行器全部路径，跨解析器去重 =====

// LocationSource 标识一个解析器来源及其返回的命中路径列表。
type LocationSource struct {
	Parser  string   `json:"parser"`  // "cmd-where" / "git-bash-which" / "powershell-getcommand"
	Ok      bool     `json:"ok"`      // 子命令是否成功
	Output  string   `json:"output"`  // 子命令原始输出（trim 后的字符串）
	Paths   []string `json:"paths"`   // 解析后归一化前的命中
	Error   string   `json:"error,omitempty"`
}

// WhereAllResult 对外返回结构。
type WhereAllResult struct {
	Name      string          `json:"name"`      // 查询名
	Sources   []LocationSource `json:"sources"`   // 三套解析器的原始结果
	Unique    []string         `json:"unique"`    // 跨源去重后的归一化路径
	UniqueWin []string         `json:"uniqueWin"` // 归一化为 Windows 风格的路径
	TotalHits int             `json:"totalHits"` // 去重前命中总数（三源合计）
}

// WhereAllLocations 接收 req.Name，使用 cmd where / git-bash which -a / powershell
// Get-Command 三种方式获得该名字对应的全部解释器/可执行文件路径，再做跨源去重。
// 用途：定位「python 究竟指向了谁」这种执行器命名冲突问题。
func WhereAllLocations(req protocol.Request) protocol.Response {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return protocol.Response{Status: "error", Message: "name 不能为空"}
	}
	// 简单拒绝带引号/空格的输入，避免被拼到 cmd 命令行里逃逸。
	if strings.ContainsAny(name, " \t\r\n\"'`;&|<>$") {
		return protocol.Response{Status: "error", Message: "name 含非法字符"}
	}

	result := WhereAllResult{
		Name:    name,
		Sources: make([]LocationSource, 0, 3),
		Unique:  make([]string, 0),
	}

	totalHits := 0
	merged := make([]string, 0)

	// 1) cmd where
	if src, paths, err := probeCmdWhere(name); err == nil {
		src.Paths = paths
		result.Sources = append(result.Sources, src)
		totalHits += len(paths)
		merged = append(merged, paths...)
	} else {
		result.Sources = append(result.Sources, LocationSource{
			Parser: "cmd-where", Ok: false, Error: err.Error(),
		})
	}

	// 2) git-bash which -a
	if src, paths, err := probeGitBash(name); err == nil {
		src.Paths = paths
		result.Sources = append(result.Sources, src)
		totalHits += len(paths)
		merged = append(merged, paths...)
	} else {
		result.Sources = append(result.Sources, LocationSource{
			Parser: "git-bash-which", Ok: false, Error: err.Error(),
		})
	}

	// 3) powershell Get-Command
	if src, paths, err := probePowerShell(name); err == nil {
		src.Paths = paths
		result.Sources = append(result.Sources, src)
		totalHits += len(paths)
		merged = append(merged, paths...)
	} else {
		result.Sources = append(result.Sources, LocationSource{
			Parser: "powershell-getcommand", Ok: false, Error: err.Error(),
		})
	}

	result.TotalHits = totalHits
	// 跨源去重：归一化为小写 + 移除后缀分隔符 + 反斜杠统一
	result.Unique = dedupPaths(merged)
	// 把 posix 风格的 /c/Users/... 转换成 C:\Users\... 方便 Windows 用户直接复制
	result.UniqueWin = convertPosixToWindows(result.Unique)

	return protocol.Response{Status: "ok", Data: result}
}

func runShell(timeout time.Duration, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	var out, errb bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errb
	err := cmd.Run()
	if err != nil && out.Len() == 0 {
		msg := strings.TrimSpace(errb.String())
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("%s", msg)
	}
	return out.String(), nil
}

func probeCmdWhere(name string) (LocationSource, []string, error) {
	shell := windowsShellLocal()
	// chcp 65001 强制 UTF-8，避免中文 OEM 下乱码。
	raw, err := runShell(5*time.Second, shell, "/C", "chcp 65001 >nul & where "+name)
	src := LocationSource{Parser: "cmd-where", Ok: err == nil, Output: strings.TrimSpace(raw)}
	if err != nil {
		// where 找不到文件时仍返回非空输出（"INFO: Could not find files..."）
		if src.Output != "" {
			src.Ok = true
			return src, nil, nil
		}
		return src, nil, err
	}
	return src, parseLines(src.Output), nil
}

func probeGitBash(name string) (LocationSource, []string, error) {
	bash, err := findGitBash()
	if err != nil {
		return LocationSource{Parser: "git-bash-which", Ok: false}, nil, err
	}
	// which -a 列出所有命中后用 cygpath -w 转成 Windows 绝对路径，避免 bash 内部
	// 用相对路径（如 /mingw64/bin/git）和 cmd/powershell 的 C:\... 形式去重时漏判。
	shellCmd := "which -a " + name + " 2>/dev/null | while IFS= read -r p; do " +
		"if [ -n \"$p\" ]; then cygpath -w \"$p\" 2>/dev/null || echo \"$p\"; fi; done"
	raw, runErr := runShell(5*time.Second, bash, "-c", shellCmd)
	src := LocationSource{Parser: "git-bash-which", Ok: runErr == nil, Output: strings.TrimSpace(raw)}
	if src.Output == "" {
		if runErr != nil {
			return src, nil, runErr
		}
		// 没有命中 — 来源仍 ok=true（命令成功）
	}
	return src, parseLines(src.Output), nil
}

func probePowerShell(name string) (LocationSource, []string, error) {
	// [Console]::OutputEncoding = UTF8 让 stdout 走 UTF-8，避免 Go 端读到 UTF-16LE 字节。
	psCmd := "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::UTF8; " +
		"$ErrorActionPreference='SilentlyContinue'; " +
		"(Get-Command '" + name + "' -All | Select-Object -ExpandProperty Source)"
	raw, err := runShell(8*time.Second, "powershell.exe", "-NoProfile", "-Command", psCmd)
	src := LocationSource{Parser: "powershell-getcommand", Ok: err == nil, Output: strings.TrimSpace(raw)}
	if err != nil {
		if src.Output != "" {
			src.Ok = true
			return src, parseLines(src.Output), nil
		}
		return src, nil, err
	}
	return src, parseLines(src.Output), nil
}

func parseLines(s string) []string {
	var out []string
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(line)
		// 过滤掉 cmd where / Get-Command 的英文提示行
		if line == "" || strings.HasPrefix(strings.ToLower(line), "info:") {
			continue
		}
		out = append(out, line)
	}
	return out
}

// dedupPaths 跨源去重：归一化（去尾部反斜杠、统一为反斜杠、小写）后用 map 判重。
func dedupPaths(in []string) []string {
	seen := make(map[string]bool)
	unique := make([]string, 0)
	for _, p := range in {
		key := normalizePathKey(p)
		if key == "" {
			continue
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		// 保留原始大小写（第一个出现的形态），用 normalize 后的 path 显示。
		unique = append(unique, normalizeForDisplay(p))
	}
	return unique
}

func normalizePathKey(p string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return ""
	}
	// posix 风格转 windows 风格，便于和 cmd/powershell 结果对齐比较
	p = posixToWindows(p)
	p = strings.ReplaceAll(p, "/", `\`)
	p = strings.TrimRight(p, `\`)
	return strings.ToLower(p)
}

func normalizeForDisplay(p string) string {
	return strings.TrimRight(strings.ReplaceAll(posixToWindows(p), "/", `\`), `\`)
}

// posixToWindows 把 /c/Users/xxx 转成 C:\Users\xxx；/d/code 转成 D:\code。
func posixToWindows(p string) string {
	if !strings.HasPrefix(p, "/") {
		return p
	}
	// /c/Users/... → C:\Users\...
	parts := strings.SplitN(p, "/", 3)
	if len(parts) < 2 {
		return p
	}
	drive := strings.ToUpper(parts[1])
	if len(drive) != 1 {
		return p
	}
	rest := ""
	if len(parts) == 3 {
		rest = parts[2]
	}
	return drive + `:\` + rest
}

func convertPosixToWindows(paths []string) []string {
	out := make([]string, len(paths))
	for i, p := range paths {
		out[i] = normalizeForDisplay(p)
	}
	return out
}

// windowsShellLocal 与 env/main.go 同样的探测逻辑，envvars 不能 import env 包。
func windowsShellLocal() string {
	if comspec := os.Getenv("ComSpec"); comspec != "" {
		if _, err := os.Stat(comspec); err == nil {
			return comspec
		}
	}
	if systemRoot := os.Getenv("SystemRoot"); systemRoot != "" {
		cmdPath := filepath.Join(systemRoot, "System32", "cmd.exe")
		if _, err := os.Stat(cmdPath); err == nil {
			return cmdPath
		}
	}
	return "cmd.exe"
}

// findGitBash 在常见安装位 + PATH 中查找 bash.exe。
func findGitBash() (string, error) {
	candidates := []string{
		`C:\Program Files\Git\usr\bin\bash.exe`,
		`C:\Program Files\Git\bin\bash.exe`,
		`C:\Program Files (x86)\Git\usr\bin\bash.exe`,
	}
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	// 用 PATH 查 — 这里不能用 exec.LookPath（依赖 PATHEXT），改成手动扫 PATH 目录。
	if pathEnv := os.Getenv("PATH"); pathEnv != "" {
		for _, dir := range strings.Split(pathEnv, string(os.PathListSeparator)) {
			if dir == "" {
				continue
			}
			candidate := filepath.Join(dir, "bash.exe")
			if _, err := os.Stat(candidate); err == nil {
				return candidate, nil
			}
		}
	}
	return "", fmt.Errorf("git bash 未找到")
}
