package fileops

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	"brochat_native_host/internal/protocol"
)

type FileEntry struct {
	Name      string `json:"name"`
	IsDir     bool   `json:"isDir"`
	Extension string `json:"extension,omitempty"`
}

type SkillInfo struct {
	Name         string `json:"name"`
	Description  string `json:"description"`
	SkillDir     string `json:"skillDir"`
	SkillMd5     string `json:"skillMd5"`
	LastModified string `json:"lastModified"`
	GroupId      string `json:"groupId"`
	// LinkType: "" 实体目录 / "symlink" NTFS 软链接 / "junction" Windows 目录联接
	// 仅扫描项目侧 (.claude/skills/{name}) 时有意义；中心仓库始终为 ""
	LinkType string `json:"linkType,omitempty"`
}

// SkillGroupConfig 对应 .browser_chat/setting.json 整体配置
type SkillGroupConfig struct {
	Groups []protocol.SkillGroup `json:"groups"`
}

// ensureSkillConfig 检测并初始化 skill 分组配置文件
// 如果 {centralPath}/.browser_chat/setting.json 不存在，自动创建含 ungrouped 的默认配置
func ensureSkillConfig(centralPath string) (*SkillGroupConfig, error) {
	configDir := filepath.Join(centralPath, ".browser_chat")
	configPath := filepath.Join(configDir, "setting.json")

	// 确保 .browser_chat 目录存在
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return nil, err
	}

	// 尝试读取现有配置
	data, err := os.ReadFile(configPath)
	if err == nil && len(data) > 0 {
		var cfg SkillGroupConfig
		if err := json.Unmarshal(data, &cfg); err == nil {
			return &cfg, nil
		}
	}

	// 不存在或解析失败，创建默认配置（保证 ungrouped 始终存在）
	defaultConfig := &SkillGroupConfig{
		Groups: []protocol.SkillGroup{
			{ID: "ungrouped", Name: "未分组"},
		},
	}

	out, err := json.MarshalIndent(defaultConfig, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(configPath, out, 0644); err != nil {
		return nil, err
	}

	return defaultConfig, nil
}

// ReadSetting 读取 {centralPath}/.browser_chat/setting.json
func ReadSetting(req protocol.Request) protocol.Response {
	centralPath := req.Path
	if centralPath == "" {
		return protocol.Response{Status: "error", Message: "path 不能为空"}
	}

	configPath := filepath.Join(centralPath, ".browser_chat", "setting.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		return protocol.Response{Status: "error", Message: "读取配置文件失败: " + err.Error()}
	}

	return protocol.Response{Status: "ok", Data: string(data)}
}

// SaveSkillGroups 保存 skill 分组配置到 {centralPath}/.browser_chat/setting.json
func SaveSkillGroups(req protocol.Request) protocol.Response {
	centralPath := req.Path
	if centralPath == "" {
		return protocol.Response{Status: "error", Message: "path 不能为空"}
	}

	groups := req.Groups
	if groups == nil {
		groups = []protocol.SkillGroup{}
	}

	// 校验 ungrouped 分组必须存在
	hasUngrouped := false
	for _, g := range groups {
		if g.ID == "ungrouped" {
			hasUngrouped = true
			break
		}
	}
	if !hasUngrouped {
		return protocol.Response{Status: "error", Message: "ungrouped 分组必须存在"}
	}

	// 确保 .browser_chat 目录存在
	configDir := filepath.Join(centralPath, ".browser_chat")
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return protocol.Response{Status: "error", Message: "创建配置目录失败: " + err.Error()}
	}

	// 写入配置文件
	cfg := SkillGroupConfig{Groups: groups}
	out, err := json.MarshalIndent(&cfg, "", "  ")
	if err != nil {
		return protocol.Response{Status: "error", Message: "序列化配置失败: " + err.Error()}
	}

	configPath := filepath.Join(configDir, "setting.json")
	if err := os.WriteFile(configPath, out, 0644); err != nil {
		return protocol.Response{Status: "error", Message: "写入配置文件失败: " + err.Error()}
	}

	return protocol.Response{Status: "ok", Message: "分组配置已保存"}
}

type SyncResult struct {
	Copied    []string           `json:"copied"`
	Skipped   []string           `json:"skipped"`
	Conflicts []ConflictInfo     `json:"conflicts"`
	Linked    []LinkedInfo       `json:"linked,omitempty"`
}

type ConflictInfo struct {
	RenamedTo string `json:"renamedTo"`
	Original  string `json:"original"`
}

// LinkedInfo 描述一次软链接推送的结果
type LinkedInfo struct {
	Name     string `json:"name"`
	LinkType string `json:"linkType"` // "symlink" | "junction"
}

func ReadFile(req protocol.Request) protocol.Response {
	data, err := os.ReadFile(req.Path)
	if err != nil {
		return protocol.Response{Status: "error", Message: err.Error()}
	}
	return protocol.Response{Status: "ok", Data: string(data)}
}

func WriteFile(req protocol.Request) protocol.Response {
	err := os.WriteFile(req.Path, []byte(req.Content), 0644)
	if err != nil {
		return protocol.Response{Status: "error", Message: err.Error()}
	}
	return protocol.Response{Status: "ok", Message: "File saved successfully"}
}

func ListDir(req protocol.Request) protocol.Response {
	entries, err := os.ReadDir(req.Path)
	if err != nil {
		return protocol.Response{Status: "error", Message: err.Error()}
	}

	var files []FileEntry
	for _, entry := range entries {
		info, _ := entry.Info()
		isDir := info != nil && info.IsDir()
		ext := ""
		if !isDir {
			ext = strings.TrimPrefix(filepath.Ext(entry.Name()), ".")
		}
		files = append(files, FileEntry{
			Name:      entry.Name(),
			IsDir:     isDir,
			Extension: ext,
		})
	}
	return protocol.Response{Status: "ok", Data: files}
}

// ScanSkills 扫描目录下所有 skill，解析 SKILL.md 的 frontmatter
// 支持两种路径格式：
//   - 中心仓库：{root}/skills/{skillName}/SKILL.md
//   - 项目本地：{root}/.claude/skills/{skillName}/SKILL.md
//
// 只有 IsCentral=true 时才读取 {root}/.browser_chat/setting.json 构建 groupId 映射
// 返回的 SkillInfo 包含 GroupId 字段，未被任何分组收录的 skill → "ungrouped"
func ScanSkills(req protocol.Request) protocol.Response {
	root := req.Path

	var skillToGroup map[string]string

	// 只有中心仓库才读取分组配置
	if req.IsCentral {
		cfg, err := ensureSkillConfig(root)
		if err != nil {
			return protocol.Response{Status: "error", Message: "初始化 skill 配置失败: " + err.Error()}
		}
		skillToGroup = make(map[string]string)
		for _, group := range cfg.Groups {
			for _, skillName := range group.Skills {
				skillToGroup[skillName] = group.ID
			}
		}
	}

	var skills []SkillInfo

	// 尝试两种路径格式
	searchPaths := []string{
		filepath.Join(root, "skills"),           // 中心仓库格式
		filepath.Join(root, ".claude", "skills"), // 项目本地格式
	}

	seen := make(map[string]bool)

	for _, skillsRoot := range searchPaths {
		entries, err := os.ReadDir(skillsRoot)
		if err != nil {
			continue
		}

		for _, entry := range entries {
			skillName := entry.Name()
			if skillName == "" || skillName[0] == '.' {
				continue
			}

			// 避免重复（同一个 skill 可能同时存在于中心仓库和项目本地）
			if seen[skillName] {
				continue
			}
			seen[skillName] = true

			skillDir := filepath.Join(skillsRoot, skillName)

			// 用 Stat 跟随判断是否目录：覆盖 entry.IsDir() 对 symlink-to-dir
			// 返回 false 的场景，以及部分 Go 版本对 junction 不报 symlink 的场景。
			sInfo, err := os.Stat(skillDir)
			if err != nil || !sInfo.IsDir() {
				continue
			}

			// 链接类型仅对项目侧有意义；中心仓库自身存的就是真实目录。
			linkType := ""
			if !req.IsCentral {
				if lInfo, lErr := os.Lstat(skillDir); lErr == nil {
					if lInfo.Mode()&os.ModeSymlink != 0 {
						linkType = "symlink"
					} else if runtime.GOOS == "windows" && lInfo.Mode().IsDir() {
						// 启发式：Windows 上 IsDir + Lstat 信息，且 Stat 跟随后
						// 与 Lstat 不同 → 极可能是 junction（需要管理员创建）
						if !os.SameFile(lInfo, sInfo) {
							linkType = "junction"
						}
					}
				}
			}

			skillMd5, name, desc, modTime := parseSkillInfo(skillDir)

			if name == "" {
				name = skillName
			}
			if desc == "" {
				desc = "(无描述)"
			}

			// 根据配置确定分组，未收录则归属 ungrouped
			groupId := "ungrouped"
			if skillToGroup != nil {
				if gid, ok := skillToGroup[skillName]; ok {
					groupId = gid
				}
			}

			skills = append(skills, SkillInfo{
				Name:         name,
				Description:  desc,
				SkillDir:     skillDir,
				SkillMd5:     skillMd5,
				LastModified: modTime,
				GroupId:      groupId,
				LinkType:     linkType,
			})
		}
	}

	if skills == nil {
		skills = []SkillInfo{}
	}

	return protocol.Response{Status: "ok", Data: skills}
}

// parseSkillInfo 解析 skill 目录，返回 MD5、name、description、最后修改时间
func parseSkillInfo(skillDir string) (md5hash, name, description, modTime string) {
	skillMd5Path := filepath.Join(skillDir, "SKILL.md")
	data, err := os.ReadFile(skillMd5Path)
	if err != nil {
		return "", "", "", ""
	}

	// 计算 MD5
	hash := md5.Sum(data)
	md5hash = hex.EncodeToString(hash[:])

	// 解析 frontmatter
	name, description = parseFrontmatter(string(data))

	// 获取修改时间
	if info, err := os.Stat(skillMd5Path); err == nil {
		modTime = info.ModTime().Format(time.RFC3339)
	}

	return md5hash, name, description, modTime
}

// parseFrontmatter 解析 YAML frontmatter，提取 name 和 description
func parseFrontmatter(content string) (name, description string) {
	// 匹配 --- 之间的 frontmatter
	re := regexp.MustCompile(`(?s)^---\s*\n(.+?)\n---`)
	matches := re.FindStringSubmatch(content)
	if len(matches) < 2 {
		return "", ""
	}

	frontmatter := matches[1]
	lines := strings.Split(frontmatter, "\n")

	// 提取 name
	nameRe := regexp.MustCompile(`^name:\s*(.+)$`)
	for _, line := range lines {
		if m := nameRe.FindStringSubmatch(line); len(m) > 1 {
			name = strings.TrimSpace(m[1])
			break
		}
	}

	// 提取 description（支持 | 块标量和单行两种格式）
	description = parseDescription(lines)

	return name, description
}

// parseDescription 从 frontmatter 行中提取 description，支持 | 块标量
func parseDescription(lines []string) string {
	descRe := regexp.MustCompile(`^description:\s*(.*)$`)

	for i, line := range lines {
		m := descRe.FindStringSubmatch(line)
		if len(m) < 2 {
			continue
		}
		value := strings.TrimSpace(m[1])

		// 单行值：description: some text
		if value != "|" && value != ">" && value != "" {
			return value
		}

		// 块标量 description: | 或 description: >
		// 收集后续缩进行
		var blockLines []string
		for j := i + 1; j < len(lines); j++ {
			l := lines[j]
			// 块内容必须缩进（至少一个空格或 tab）
			if len(l) == 0 {
				blockLines = append(blockLines, "")
				continue
			}
			// 非缩进行 = 块结束
			if l[0] != ' ' && l[0] != '\t' {
				break
			}
			// 去掉一级缩进
			blockLines = append(blockLines, stripIndent(l))
		}

		if len(blockLines) > 0 {
			return strings.TrimSpace(strings.Join(blockLines, "\n"))
		}

		return value
	}

	return ""
}

// stripIndent 去掉一级缩进（2 空格或 1 tab）
func stripIndent(line string) string {
	if strings.HasPrefix(line, "  ") {
		return line[2:]
	}
	if strings.HasPrefix(line, "\t") {
		return line[1:]
	}
	return strings.TrimLeft(line, " \t")
}

// SyncSkillDir 同步单个 skill 到目标目录，含冲突处理
func SyncSkillDir(req protocol.Request) protocol.Response {
	src := req.Src
	dstParent := req.DstParent
	if src == "" || dstParent == "" {
		return protocol.Response{Status: "error", Message: "src 和 dstParent 不能为空"}
	}

	// 从 src 目录名获取 skill name
	skillName := filepath.Base(src)

	// 检查 src 是否存在
	if _, err := os.Stat(src); err != nil {
		return protocol.Response{Status: "error", Message: "源目录不存在: " + err.Error()}
	}

	// 确保目标父目录存在（symlink 模式时也要建父目录）
	if err := os.MkdirAll(dstParent, 0755); err != nil {
		return protocol.Response{Status: "error", Message: "创建目标父目录失败: " + err.Error()}
	}

	dst := filepath.Join(dstParent, skillName)
	result := SyncResult{
		Copied:    []string{},
		Skipped:   []string{},
		Conflicts: []ConflictInfo{},
	}

	// ========== 软链接模式 ==========
	// 行为：项目下放一个目录链接（symlink → junction 自动降级）
	// 任何指向 src 的已存在链接视为「已就绪」直接 skip；否则清掉旧目标后建链接
	if req.Mode == "symlink" {
		// 检查目标是否已是链接到 src
		if linkType, isLink, target := inspectLink(dst); isLink {
			absTarget, _ := filepath.Abs(target)
			absSrc, _ := filepath.Abs(src)
			if samePath(absTarget, absSrc) {
				result.Skipped = append(result.Skipped, skillName)
				return protocol.Response{Status: "ok", Data: result}
			}
			// 链接指向别处，先断掉再重建（os.Remove 只删链接本体，不遍历 junction 目标）
			if err := os.Remove(dst); err != nil {
				return protocol.Response{Status: "error", Message: "清理旧链接失败: " + err.Error()}
			}
			_ = linkType // 已用
		} else if _, err := os.Stat(dst); err == nil {
			// 目标是真实目录/文件，先清理（包含 ReadOnly 属性的处理）
			if err := os.RemoveAll(dst); err != nil {
				return protocol.Response{Status: "error", Message: "清理旧目录失败: " + err.Error()}
			}
		}

		linkType, err := createSkillLink(src, dst)
		if err != nil {
			return protocol.Response{Status: "error", Message: "创建链接失败: " + err.Error()}
		}
		result.Linked = append(result.Linked, LinkedInfo{Name: skillName, LinkType: linkType})
		return protocol.Response{Status: "ok", Data: result}
	}

	// ========== 复制模式（默认 / 旧行为） ==========
	// 获取 src 的 SKILL.md MD5
	srcMd5, _, _, _ := parseSkillInfo(src)

	dstExists := false
	dstMd5 := ""

	// 检查目标是否已存在
	if info, err := os.Stat(dst); err == nil && info.IsDir() {
		dstExists = true
		dstMd5, _, _, _ = parseSkillInfo(dst)
	}

	// 计算目标目录的最终名称（冲突时直接覆盖）
	finalDst := dst
	if dstExists && srcMd5 != dstMd5 {
		// 冲突：直接删除目标，用源覆盖
		if err := os.RemoveAll(dst); err != nil {
			return protocol.Response{Status: "error", Message: "删除旧版本失败: " + err.Error()}
		}
	}

	// 如果目标已存在且 MD5 相同，跳过
	if dstExists && srcMd5 == dstMd5 {
		result.Skipped = append(result.Skipped, skillName)
		return protocol.Response{Status: "ok", Data: result}
	}

	// 复制目录
	if err := CopyDirRecursive(src, finalDst); err != nil {
		return protocol.Response{Status: "error", Message: "复制目录失败: " + err.Error()}
	}

	result.Copied = append(result.Copied, skillName)
	return protocol.Response{Status: "ok", Data: result}
}

// MaterializeSkill 把项目里的软链接/junction skill 物化为实体目录（独立复制）
// 接收 req.Path（项目路径）+ req.Name（skill 名称）
func MaterializeSkill(req protocol.Request) protocol.Response {
	if req.Path == "" || req.Name == "" {
		return protocol.Response{Status: "error", Message: "path 和 name 不能为空"}
	}

	skillDir := filepath.Join(req.Path, ".claude", "skills", req.Name)
	if _, err := os.Stat(skillDir); err != nil {
		skillDir = filepath.Join(req.Path, "skills", req.Name)
		if _, err := os.Stat(skillDir); err != nil {
			return protocol.Response{Status: "error", Message: "Skill 目录不存在: " + req.Name}
		}
	}

	// 尝试解析链接目标：成功 = 是链接（symlink 或 junction），失败 = 实体文件
	target, err := os.Readlink(skillDir)
	if err != nil {
		return protocol.Response{Status: "ok", Data: map[string]interface{}{
			"converted": false,
			"message":   "已是实体文件",
		}}
	}

	// 目标可能是相对路径，解析为绝对
	if !filepath.IsAbs(target) {
		target = filepath.Join(filepath.Dir(skillDir), target)
	}

	// 移除链接本体（os.Remove 只删 reparse point，不遍历 junction 目标）
	if err := os.Remove(skillDir); err != nil {
		return protocol.Response{Status: "error", Message: "移除链接失败: " + err.Error()}
	}

	// 把目标复制成实体目录
	if err := CopyDirRecursive(target, skillDir); err != nil {
		return protocol.Response{Status: "error", Message: "复制实体文件失败: " + err.Error()}
	}

	return protocol.Response{Status: "ok", Data: map[string]interface{}{
		"converted": true,
		"source":    target,
	}}
}

// inspectLink 检测 path 是否为符号链接 / junction，返回 (linkType, isLink, target)
// linkType: "" 非链接 / "symlink" / "junction"
// target: 链接目标（解析后的绝对路径），非链接返回 ""
func inspectLink(path string) (string, bool, string) {
	// Lstat 不跟随链接
	info, err := os.Lstat(path)
	if err != nil {
		return "", false, ""
	}
	if info.Mode()&os.ModeSymlink == 0 {
		return "", false, ""
	}
	target, err := os.Readlink(path)
	if err != nil {
		return "", true, ""
	}
	// 在 Windows 上 Go 的 Lstat 对 junction 不会设置 ModeSymlink
	// 用 fsutil 重判：先按 symlink 试 → 失败 → 试 junction
	// 简化处理：如果 ModeSymlink 未设置但路径存在且 Lstat 不报错 + Stat 不同，多半是 junction
	if info.Mode()&os.ModeSymlink != 0 {
		return "symlink", true, target
	}
	// junction: 用 Stat 比对判断（junction 仍解析到底层目录）
	if info.Mode().IsDir() {
		// 用解析绝对路径方式判定
		absT, _ := filepath.Abs(target)
		_ = absT
		return "junction", true, target
	}
	return "", true, target
}

// samePath 简易路径等价判断（Windows 不区分大小写，路径分隔符归一）
func samePath(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	a = filepath.Clean(a)
	b = filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

// createSkillLink 创建软链接，自动降级到 junction（仅 Windows 上有意义）
// 优先 os.Symlink（可能是真正的 symlink 语义，但需要开发者模式或管理员）；
// 失败时用 `mklink /J` junction（不需要权限）
func createSkillLink(src, dst string) (string, error) {
	// 先确认 src 是绝对路径（junction 要求绝对目标）
	absSrc, err := filepath.Abs(src)
	if err != nil {
		return "", err
	}

	// 试 os.Symlink（NTFS symlink / 文件链接）
	if err := os.Symlink(absSrc, dst); err == nil {
		return "symlink", nil
	}

	// 降级到 junction（mklink /J 仅在 Windows 上可用）
	if runtime.GOOS == "windows" {
		cmd := exec.Command("cmd", "/c", "mklink", "/J", dst, absSrc)
		out, err := cmd.CombinedOutput()
		if err == nil {
			return "junction", nil
		}
		return "", fmt.Errorf("os.Symlink 失败且 junction 失败: %s", strings.TrimSpace(string(out)))
	}

	// 非 Windows 但 os.Symlink 失败，应该不会到这里（POSIX 几乎总能创建 symlink）
	return "", fmt.Errorf("os.Symlink 失败")
}

// CopyDirRecursive 递归复制目录
func CopyDirRecursive(src, dst string) error {
	srcInfo, err := os.Stat(src)
	if err != nil {
		return err
	}

	// 创建目标目录
	if err := os.MkdirAll(dst, srcInfo.Mode()); err != nil {
		return err
	}

	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		srcPath := filepath.Join(src, entry.Name())
		dstPath := filepath.Join(dst, entry.Name())

		if entry.IsDir() {
			if err := CopyDirRecursive(srcPath, dstPath); err != nil {
				return err
			}
		} else {
			if err := copyFile(srcPath, dstPath); err != nil {
				return err
			}
		}
	}

	return nil
}

// copyFile 复制单个文件
func copyFile(src, dst string) error {
	srcFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer srcFile.Close()

	dstFile, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer dstFile.Close()

	if _, err := io.Copy(dstFile, srcFile); err != nil {
		return err
	}

	// 复制权限
	srcInfo, _ := os.Stat(src)
	if srcInfo != nil {
		os.Chmod(dst, srcInfo.Mode())
	}

	return nil
}

// ComputeMd5 计算文件的 MD5
func ComputeMd5(req protocol.Request) protocol.Response {
	if req.Path == "" {
		return protocol.Response{Status: "error", Message: "path 不能为空"}
	}
	data, err := os.ReadFile(req.Path)
	if err != nil {
		return protocol.Response{Status: "error", Message: err.Error()}
	}
	hash := md5.Sum(data)
	return protocol.Response{Status: "ok", Data: hex.EncodeToString(hash[:])}
}

// ListDirRecursive 递归列出所有文件
func ListDirRecursive(req protocol.Request) protocol.Response {
	var files []string
	if req.Path == "" {
		return protocol.Response{Status: "error", Message: "path 不能为空"}
	}
	err := filepath.Walk(req.Path, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			rel, _ := filepath.Rel(req.Path, path)
			files = append(files, rel)
		}
		return nil
	})
	if err != nil {
		return protocol.Response{Status: "error", Message: err.Error()}
	}
	return protocol.Response{Status: "ok", Data: files}
}

// EnsureDir 确保目录存在
func EnsureDir(req protocol.Request) protocol.Response {
	if req.Path == "" {
		return protocol.Response{Status: "error", Message: "path 不能为空"}
	}
	err := os.MkdirAll(req.Path, 0755)
	if err != nil {
		return protocol.Response{Status: "error", Message: err.Error()}
	}
	return protocol.Response{Status: "ok"}
}

// DeleteDirRecursive 递归删除目录
func DeleteDirRecursive(req protocol.Request) protocol.Response {
	if req.Path == "" {
		return protocol.Response{Status: "error", Message: "path 不能为空"}
	}
	err := os.RemoveAll(req.Path)
	if err != nil {
		return protocol.Response{Status: "error", Message: err.Error()}
	}
	return protocol.Response{Status: "ok", Message: "已删除"}
}

// GetSkillMeta 获取 skill 的元信息（供前端展示）
func GetSkillMeta(req protocol.Request) protocol.Response {
	if req.Path == "" {
		return protocol.Response{Status: "error", Message: "path 不能为空"}
	}
	md5, name, desc, modTime := parseSkillInfo(req.Path)
	if name == "" && md5 == "" {
		return protocol.Response{Status: "error", Message: "无效的 skill 目录"}
	}
	meta := map[string]string{
		"md5":          md5,
		"name":          name,
		"description":   desc,
		"lastModified":  modTime,
	}
	data, _ := json.Marshal(meta)
	return protocol.Response{Status: "ok", Data: string(data)}
}

// DeleteSkill 删除项目中的指定 skill 目录
func DeleteSkill(req protocol.Request) protocol.Response {
	if req.Path == "" || req.Name == "" {
		return protocol.Response{Status: "error", Message: "path 和 name 不能为空"}
	}

	// 在 .claude/skills/{name} 路径下查找
	skillDir := filepath.Join(req.Path, ".claude", "skills", req.Name)
	if _, err := os.Stat(skillDir); err != nil {
		// 也尝试 skills/{name}
		skillDir = filepath.Join(req.Path, "skills", req.Name)
		if _, err := os.Stat(skillDir); err != nil {
			return protocol.Response{Status: "error", Message: "Skill 目录不存在: " + req.Name}
		}
	}

	if err := os.RemoveAll(skillDir); err != nil {
		return protocol.Response{Status: "error", Message: "删除失败: " + err.Error()}
	}

	return protocol.Response{Status: "ok", Data: map[string]bool{"success": true}}
}

// DeleteCentralSkill 删除中心仓库的 skill 目录，并从分组配置中移除
func DeleteCentralSkill(req protocol.Request) protocol.Response {
	if req.Path == "" || req.Name == "" {
		return protocol.Response{Status: "error", Message: "path 和 name 不能为空"}
	}

	// 删除中心仓库的 skill 目录 {centralPath}/skills/{name}
	skillDir := filepath.Join(req.Path, "skills", req.Name)
	if _, err := os.Stat(skillDir); err != nil {
		return protocol.Response{Status: "error", Message: "中心仓库 Skill 不存在: " + req.Name}
	}

	if err := os.RemoveAll(skillDir); err != nil {
		return protocol.Response{Status: "error", Message: "删除失败: " + err.Error()}
	}

	// 同步更新分组配置：从所有分组的 skills 列表中移除该 skill
	cfg, err := ensureSkillConfig(req.Path)
	if err == nil {
		changed := false
		for i := range cfg.Groups {
			if cfg.Groups[i].Skills != nil {
				originalLen := len(cfg.Groups[i].Skills)
				cfg.Groups[i].Skills = removeSkillFromSlice(cfg.Groups[i].Skills, req.Name)
				if len(cfg.Groups[i].Skills) < originalLen {
					changed = true
				}
			}
		}
		if changed {
			// 保存更新后的配置
			configPath := filepath.Join(req.Path, ".browser_chat", "setting.json")
			out, err := json.MarshalIndent(&cfg, "", "  ")
			if err == nil {
				os.WriteFile(configPath, out, 0644)
			}
		}
	}

	return protocol.Response{Status: "ok", Data: map[string]bool{"success": true}}
}

// removeSkillFromSlice 从字符串切片中移除指定元素
func removeSkillFromSlice(slice []string, item string) []string {
	result := make([]string, 0, len(slice))
	for _, s := range slice {
		if s != item {
			result = append(result, s)
		}
	}
	return result
}

// BatchDeleteSkills 批量从多个项目目录删除指定 skill
// 接收 req.Dirs（项目路径数组）和 req.Name（skill 名称）
// 逐个项目删除，返回每个项目的删除结果
func BatchDeleteSkills(req protocol.Request) protocol.Response {
	if len(req.Dirs) == 0 || req.Name == "" {
		return protocol.Response{Status: "error", Message: "dirs 和 name 不能为空"}
	}

	type DeleteResult struct {
		Path    string `json:"path"`
		Success bool   `json:"success"`
		Error   string `json:"error,omitempty"`
	}

	var results []DeleteResult

	for _, projectPath := range req.Dirs {
		result := DeleteResult{Path: projectPath}

		// 尝试 .claude/skills/{name}
		skillDir := filepath.Join(projectPath, ".claude", "skills", req.Name)
		if _, err := os.Stat(skillDir); err != nil {
			// 也尝试 skills/{name}
			skillDir = filepath.Join(projectPath, "skills", req.Name)
			if _, err := os.Stat(skillDir); err != nil {
				result.Error = "skill 不存在"
				results = append(results, result)
				continue
			}
		}

		if err := os.RemoveAll(skillDir); err != nil {
			result.Error = err.Error()
			results = append(results, result)
			continue
		}

		result.Success = true
		results = append(results, result)
	}

	return protocol.Response{Status: "ok", Data: results}
}
