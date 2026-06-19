package fileops

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"regexp"
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
}

type ConflictInfo struct {
	RenamedTo string `json:"renamedTo"`
	Original  string `json:"original"`
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
			if !entry.IsDir() {
				continue
			}
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

	// 获取 src 的 SKILL.md MD5
	srcMd5, _, _, _ := parseSkillInfo(src)

	// 目标路径
	dst := filepath.Join(dstParent, skillName)
	dstExists := false
	dstMd5 := ""

	// 检查目标是否已存在
	if info, err := os.Stat(dst); err == nil && info.IsDir() {
		dstExists = true
		dstMd5, _, _, _ = parseSkillInfo(dst)
	}

	result := SyncResult{
		Copied:    []string{},
		Skipped:   []string{},
		Conflicts: []ConflictInfo{},
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
