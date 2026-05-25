package envvars

import (
	"encoding/json"
	"fmt"
	"os"
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
