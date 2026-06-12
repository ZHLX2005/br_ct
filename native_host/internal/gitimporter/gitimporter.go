package gitimporter

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"brochat_native_host/internal/protocol"
)

const maxDiscoverDepth = 5

// CleanupOrphanTempDirs 启动时清理上一次残留的临时 clone 目录
func CleanupOrphanTempDirs() {
	tmpDir := os.TempDir()
	entries, err := os.ReadDir(tmpDir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		if strings.HasPrefix(entry.Name(), "brochat-git-import-") {
			fullPath := filepath.Join(tmpDir, entry.Name())
			if err := os.RemoveAll(fullPath); err == nil {
				fmt.Fprintf(os.Stderr, "[GitImporter] 清理残留临时目录: %s\n", fullPath)
			}
		}
	}
}

var skipDirs = map[string]bool{
	"node_modules": true,
	".git":         true,
	"dist":         true,
	"build":        true,
	"__pycache__":  true,
}

// ─── 公共类型 ───

// GitSkillInfo 描述从远程仓库发现的单个 skill
type GitSkillInfo struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	SkillDir    string `json:"skillDir"`    // 本地临时路径（clone 模式）或相对路径（API 模式）
	SkillMd5    string `json:"skillMd5"`
	RepoPath    string `json:"repoPath"`    // 仓库内相对路径，如 "skills/foo/SKILL.md"
}

// DiscoverResult 返回发现的 skills 与临时目录路径
type DiscoverResult struct {
	Skills  []GitSkillInfo `json:"skills"`
	TempDir string         `json:"tempDir"`
	Source  string         `json:"source"` // "github-api" 或 "git-clone"
	// GitHub API 快速路径需要保留仓库信息用于后续下载
	OwnerRepo string `json:"ownerRepo,omitempty"`
	Branch    string `json:"branch,omitempty"`
}

// ImportResult 描述导入结果
type ImportResult struct {
	Copied  []string `json:"copied"`
	Skipped []string `json:"skipped"`
}

// ─── GitHub API 类型 ───

// GitHubTreeEntry 对应 GitHub Trees API 的一条记录
type GitHubTreeEntry struct {
	Path string `json:"path"`
	Type string `json:"type"` // "blob" | "tree"
	SHA  string `json:"sha"`
}

type githubTreeResp struct {
	SHA       string             `json:"sha"`
	Tree      []GitHubTreeEntry  `json:"tree"`
	Truncated bool               `json:"truncated"`
}

var httpClient = &http.Client{Timeout: 15 * time.Second}

// ─── 解析 URL ───

type parsedGitHub struct {
	Owner    string
	Repo     string
	Ref      string // 可能为空，后续解析
	Subpath  string
}

// parseGitHubURL 从各种 GitHub 格式中提取 owner/repo、分支、子路径
// 支持：
//
//	owner/repo
//	https://github.com/owner/repo
//	https://github.com/owner/repo/tree/branch
//	https://github.com/owner/repo/tree/branch/path/to/skill
//	git@github.com:owner/repo.git
func parseGitHubURL(raw string) *parsedGitHub {
	// SSH 格式: git@github.com:owner/repo.git
	if m := regexp.MustCompile(`^git@github\.com:([^/]+)/([^/]+?)(?:\.git)?$`).FindStringSubmatch(raw); len(m) == 3 {
		return &parsedGitHub{Owner: m[1], Repo: m[2]}
	}
	// HTTPS 带 tree/path: https://github.com/owner/repo/tree/branch/path
	if m := regexp.MustCompile(`github\.com/([^/]+)/([^/]+)/tree/([^/]+)/(.+)`).FindStringSubmatch(raw); len(m) == 5 {
		return &parsedGitHub{Owner: m[1], Repo: m[2], Ref: m[3], Subpath: m[4]}
	}
	// HTTPS 带 tree 无 path: https://github.com/owner/repo/tree/branch
	if m := regexp.MustCompile(`github\.com/([^/]+)/([^/]+)/tree/([^/]+)$`).FindStringSubmatch(raw); len(m) == 4 {
		return &parsedGitHub{Owner: m[1], Repo: m[2], Ref: m[3]}
	}
	// HTTPS 基本: https://github.com/owner/repo
	if m := regexp.MustCompile(`github\.com/([^/]+)/([^/]+?)(?:\.git)?/?$`).FindStringSubmatch(raw); len(m) == 3 {
		return &parsedGitHub{Owner: m[1], Repo: m[2]}
	}
	// owner/repo 简写
	if m := regexp.MustCompile(`^([^/]+)/([^/]+)$`).FindStringSubmatch(raw); len(m) == 3 {
		if !strings.Contains(raw, ":") && !strings.HasPrefix(raw, ".") && !strings.HasPrefix(raw, "/") {
			return &parsedGitHub{Owner: m[1], Repo: m[2]}
		}
	}
	return nil
}

// ─── GitHub API 快速路径（零 clone） ───

// fetchGitHubTree 用 GitHub Trees API 获取完整文件树
func fetchGitHubTree(owner, repo, ref string) (*githubTreeResp, error) {
	branch := ref
	if branch == "" {
		branch = "HEAD"
	}
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/git/trees/%s?recursive=1",
		owner, repo, branch)

	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("User-Agent", "brochat-native-host")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("GitHub API %d: %s", resp.StatusCode, string(body))
	}

	var tree githubTreeResp
	if err := json.NewDecoder(resp.Body).Decode(&tree); err != nil {
		return nil, err
	}
	if tree.Truncated {
		return nil, fmt.Errorf("仓库太大，文件树被截断，将回退到 git clone")
	}
	return &tree, nil
}

// findSkillMdPaths 在 GitHub 文件树中寻找 SKILL.md
func findSkillMdPaths(tree *githubTreeResp, subpath string) []string {
	var allSkillMds []string
	prefix := ""
	if subpath != "" {
		prefix = strings.TrimSuffix(subpath, "/") + "/"
	}

	for _, entry := range tree.Tree {
		if entry.Type != "blob" {
			continue
		}
		if !strings.HasSuffix(strings.ToLower(entry.Path), "skill.md") {
			continue
		}
		if prefix != "" && !strings.HasPrefix(entry.Path, prefix) && entry.Path != strings.TrimSuffix(prefix, "/")+"/SKILL.md" {
			continue
		}
		allSkillMds = append(allSkillMds, entry.Path)
	}

	// 按优先级排序：skills/ > .claude/skills/ > 根目录 > 其他
	priority := []string{"skills/", ".claude/skills/", ".agents/skills/"}
	var ranked []string
	seen := make(map[string]bool)

	// 优先目录
	for _, p := range priority {
		for _, md := range allSkillMds {
			fullPrefix := prefix + p
			if strings.HasPrefix(md, fullPrefix) && !seen[md] {
				parts := strings.Split(strings.TrimPrefix(md, fullPrefix), "/")
				// 直接子目录下的 SKILL.md（depth=1 或 depth=2）
				if len(parts) == 1 || (len(parts) == 2 && strings.EqualFold(parts[1], "SKILL.md")) {
					ranked = append(ranked, md)
					seen[md] = true
				}
			}
		}
	}
	// 其余
	for _, md := range allSkillMds {
		if !seen[md] {
			depth := strings.Count(md, "/")
			if depth <= maxDiscoverDepth {
				ranked = append(ranked, md)
			}
		}
	}

	return ranked
}

// fetchRawGitHub 从 raw.githubusercontent.com 获取文件内容
func fetchRawGitHub(owner, repo, branch, path string) (string, error) {
	url := fmt.Sprintf("https://raw.githubusercontent.com/%s/%s/%s/%s", owner, repo, branch, path)
	resp, err := httpClient.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// ─── 入口命令 ───

// CloneAndDiscoverSkills 发现远程仓库中的 skills
// 优先使用 GitHub API（零 clone），失败则回退 git clone --depth 1
func CloneAndDiscoverSkills(req protocol.Request) protocol.Response {
	url := req.Url
	if url == "" {
		return protocol.Response{Status: "error", Message: "url 不能为空"}
	}

	// 合并请求中的 ref 和 subpath
	subpath := req.Subpath

	// 尝试 GitHub API 快速路径
	if gh := parseGitHubURL(url); gh != nil {
		ref := req.Ref
		if gh.Ref != "" {
			ref = gh.Ref
		}
		if gh.Subpath != "" && subpath == "" {
			subpath = gh.Subpath
		}

		result, err := discoverViaGitHubAPI(gh.Owner, gh.Repo, ref, subpath)
		if err == nil && len(result.Skills) > 0 {
			return protocol.Response{Status: "ok", Data: result}
		}
		// API 失败，日志但继续回退
		fmt.Fprintf(os.Stderr, "[GitImporter] GitHub API 快速路径失败 (%v)，回退 git clone\n", err)
	}

	// 回退：浅 clone
	return discoverViaGitClone(normalizeGitURL(url), req.Ref, subpath)
}

// discoverViaGitHubAPI 零 clone 发现 skills
func discoverViaGitHubAPI(owner, repo, ref, subpath string) (*DiscoverResult, error) {
	tree, err := fetchGitHubTree(owner, repo, ref)
	if err != nil {
		return nil, err
	}

	skillMdPaths := findSkillMdPaths(tree, subpath)
	if len(skillMdPaths) == 0 {
		return nil, fmt.Errorf("未发现 SKILL.md")
	}

	// 确定 branch 名（用于后续下载）
	branch := ref
	if branch == "" {
		// 尝试从 tree response 推断（默认 main）
		branch = "main"
	}

	// 并发获取 SKILL.md 内容解析 frontmatter
	type skillResult struct {
		info GitSkillInfo
		err  error
	}

	ch := make(chan skillResult, len(skillMdPaths))
	for _, mdPath := range skillMdPaths {
		go func(p string) {
			content, err := fetchRawGitHub(owner, repo, branch, p)
			if err != nil {
				ch <- skillResult{err: err}
				return
			}
			name, desc := parseFrontmatter(content)
			if name == "" {
				// 用目录名作为 name
				parts := strings.Split(strings.TrimSuffix(p, "/SKILL.md"), "/")
				name = parts[len(parts)-1]
			}
			if desc == "" {
				desc = "(无描述)"
			}
			hash := md5.Sum([]byte(content))
			// repoPath 是去掉 SKILL.md 后的目录路径
			dirPath := p
			if strings.HasSuffix(strings.ToLower(p), "/skill.md") {
				dirPath = p[:len(p)-len("/SKILL.md")]
			} else if strings.EqualFold(p, "SKILL.md") {
				dirPath = ""
			}

			ch <- skillResult{
				info: GitSkillInfo{
					Name:        name,
					Description: desc,
					SkillDir:    dirPath,
					SkillMd5:    hex.EncodeToString(hash[:]),
					RepoPath:    p,
				},
			}
		}(mdPath)
	}

	var skills []GitSkillInfo
	for range skillMdPaths {
		r := <-ch
		if r.err == nil {
			skills = append(skills, r.info)
		}
	}

	if len(skills) == 0 {
		return nil, fmt.Errorf("无法解析任何 SKILL.md")
	}

	return &DiscoverResult{
		Skills:    skills,
		Source:    "github-api",
		OwnerRepo: owner + "/" + repo,
		Branch:    branch,
	}, nil
}

// discoverViaGitClone 浅 clone 回退方案
func discoverViaGitClone(url, ref, subpath string) protocol.Response {
	tempDir, err := os.MkdirTemp("", "brochat-git-import-")
	if err != nil {
		return protocol.Response{Status: "error", Message: "创建临时目录失败: " + err.Error()}
	}

	args := []string{"clone", "--depth", "1"}
	if ref != "" {
		args = append(args, "--branch", ref)
	}
	args = append(args, url, tempDir)

	cmd := exec.Command("git", args...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	out, err := cmd.CombinedOutput()
	if err != nil {
		os.RemoveAll(tempDir)
		return protocol.Response{Status: "error", Message: fmt.Sprintf("git clone 失败: %v\n%s", err, string(out))}
	}

	searchRoot := tempDir
	if subpath != "" {
		safeSubpath := sanitizeSubpath(subpath)
		searchRoot = filepath.Join(tempDir, safeSubpath)
		if _, err := os.Stat(searchRoot); err != nil {
			os.RemoveAll(tempDir)
			return protocol.Response{Status: "error", Message: "subpath 不存在: " + safeSubpath}
		}
	}

	skills := discoverSkillsFromDisk(searchRoot)

	return protocol.Response{Status: "ok", Data: DiscoverResult{
		Skills:  skills,
		TempDir: tempDir,
		Source:  "git-clone",
	}}
}

// ImportGitSkills 导入选中的 skills 到中心仓库
// 对于 GitHub API 模式：从 raw.githubusercontent.com 下载文件
// 对于 clone 模式：从临时目录复制
func ImportGitSkills(req protocol.Request) protocol.Response {
	if req.DstParent == "" {
		return protocol.Response{Status: "error", Message: "dstParent 不能为空"}
	}
	if len(req.Names) == 0 {
		return protocol.Response{Status: "error", Message: "names 不能为空"}
	}

	result := ImportResult{
		Copied:  []string{},
		Skipped: []string{},
	}

	// GitHub API 模式
	if req.OwnerRepo != "" && req.Branch != "" {
		return importFromGitHubAPI(req, result)
	}

	// Git clone 模式
	if req.TempDir == "" {
		return protocol.Response{Status: "error", Message: "tempDir 或 ownerRepo+branch 不能为空"}
	}
	return importFromCloneDir(req, result)
}

// importFromGitHubAPI 通过 GitHub API 下载指定 skills 的文件
func importFromGitHubAPI(req protocol.Request, result ImportResult) protocol.Response {
	parts := strings.SplitN(req.OwnerRepo, "/", 2)
	if len(parts) != 2 {
		return protocol.Response{Status: "error", Message: "无效的 ownerRepo: " + req.OwnerRepo}
	}
	owner, repo := parts[0], parts[1]

	// 获取完整文件树
	tree, err := fetchGitHubTree(owner, repo, req.Branch)
	if err != nil {
		return protocol.Response{Status: "error", Message: "获取文件树失败: " + err.Error()}
	}

	// 构建 path→entry 映射
	treeMap := make(map[string]GitHubTreeEntry)
	for _, entry := range tree.Tree {
		treeMap[entry.Path] = entry
	}

	// req.Skills 包含 DiscoverResult 中的完整 skills 列表（JSON 序列化通过 Data 传递）
	// 我们用 Names 匹配 SkillDir（repo 相对路径）
	for _, skillDir := range req.Names {
		// Names 里存的是 SkillDir（即仓库内相对路径）
		// 找到该目录下所有 blob 文件
		prefix := skillDir
		if prefix != "" {
			prefix += "/"
		}

		dstDir := filepath.Join(req.DstParent, filepath.Base(skillDir))
		if skillDir == "" {
			dstDir = filepath.Join(req.DstParent, repo)
		}

		// 检查是否已存在（MD5 比对）
		dstMd5 := skillDirMd5(dstDir)
		// 需要找到对应的 SKILL.md 的 MD5
		skillMdPath := prefix + "SKILL.md"
		if entry, ok := treeMap[skillMdPath]; ok {
			content, err := fetchRawGitHub(owner, repo, req.Branch, entry.Path)
			if err == nil {
				srcHash := md5.Sum([]byte(content))
				srcMd5 := hex.EncodeToString(srcHash[:])
				if dstMd5 == srcMd5 {
					result.Skipped = append(result.Skipped, filepath.Base(skillDir))
					continue
				}
			}
		}

		// 下载该 skill 目录下的所有文件
		var filesToDownload []string
		for _, entry := range tree.Tree {
			if entry.Type != "blob" {
				continue
			}
			if skillDir == "" {
				// 根目录 skill，只下载根目录的文件
				if strings.Contains(entry.Path, "/") {
					continue
				}
			} else {
				if !strings.HasPrefix(entry.Path, prefix) {
					continue
				}
			}
			filesToDownload = append(filesToDownload, entry.Path)
		}

		if len(filesToDownload) == 0 {
			continue
		}

		// 创建目标目录
		if err := os.MkdirAll(dstDir, 0755); err != nil {
			return protocol.Response{Status: "error", Message: fmt.Sprintf("创建目录失败: %v", err)}
		}

		// 下载所有文件
		for _, filePath := range filesToDownload {
			content, err := fetchRawGitHub(owner, repo, req.Branch, filePath)
			if err != nil {
				fmt.Fprintf(os.Stderr, "[GitImporter] 下载 %s 失败: %v\n", filePath, err)
				continue
			}
			// 本地路径：去掉 skill 前缀
			relPath := strings.TrimPrefix(filePath, prefix)
			localPath := filepath.Join(dstDir, relPath)
			localDir := filepath.Dir(localPath)
			os.MkdirAll(localDir, 0755)
			if err := os.WriteFile(localPath, []byte(content), 0644); err != nil {
				return protocol.Response{Status: "error", Message: fmt.Sprintf("写入 %s 失败: %v", relPath, err)}
			}
		}

		result.Copied = append(result.Copied, filepath.Base(skillDir))
	}

	return protocol.Response{Status: "ok", Data: result}
}

// importFromCloneDir 从 clone 的临时目录导入
func importFromCloneDir(req protocol.Request, result ImportResult) protocol.Response {
	for _, name := range req.Names {
		src := filepath.Join(req.TempDir, name)
		if _, err := os.Stat(src); err != nil {
			src = filepath.Join(req.TempDir, "skills", name)
			if _, err := os.Stat(src); err != nil {
				continue
			}
		}

		dst := filepath.Join(req.DstParent, filepath.Base(src))
		srcMd5 := skillDirMd5(src)
		dstMd5 := skillDirMd5(dst)

		if dstMd5 != "" && srcMd5 == dstMd5 {
			result.Skipped = append(result.Skipped, filepath.Base(src))
			continue
		}

		if err := copyDirRecursive(src, dst); err != nil {
			return protocol.Response{Status: "error", Message: fmt.Sprintf("复制 %s 失败: %v", name, err)}
		}
		result.Copied = append(result.Copied, filepath.Base(src))
	}

	os.RemoveAll(req.TempDir)
	return protocol.Response{Status: "ok", Data: result}
}

// CleanupTempDir 清理残留的临时 clone 目录
func CleanupTempDir(req protocol.Request) protocol.Response {
	if req.TempDir == "" {
		return protocol.Response{Status: "error", Message: "tempDir 不能为空"}
	}
	// 安全校验：只允许删除系统临时目录下的 brochat-git-import- 前缀目录
	base := filepath.Base(req.TempDir)
	if !strings.HasPrefix(base, "brochat-git-import-") {
		return protocol.Response{Status: "error", Message: "非法的临时目录路径"}
	}
	if err := os.RemoveAll(req.TempDir); err != nil {
		return protocol.Response{Status: "error", Message: "清理失败: " + err.Error()}
	}
	return protocol.Response{Status: "ok", Message: "已清理"}
}

// ─── 磁盘扫描（clone 回退用） ───

func discoverSkillsFromDisk(root string) []GitSkillInfo {
	seen := make(map[string]bool)
	var skills []GitSkillInfo

	priorityDirs := []string{
		root,
		filepath.Join(root, "skills"),
		filepath.Join(root, ".claude", "skills"),
		filepath.Join(root, ".agents", "skills"),
	}

	for _, dir := range priorityDirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if !entry.IsDir() || skipDirs[entry.Name()] {
				continue
			}
			skillDir := filepath.Join(dir, entry.Name())
			if seen[skillDir] {
				continue
			}
			seen[skillDir] = true
			if info := parseSkillDirFromDisk(skillDir); info != nil {
				skills = append(skills, *info)
			}
		}
	}

	if len(skills) == 0 {
		_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
			if err != nil || !d.IsDir() {
				return nil
			}
			depth := strings.Count(strings.TrimPrefix(path, root), string(filepath.Separator))
			if depth > maxDiscoverDepth || skipDirs[d.Name()] {
				return filepath.SkipDir
			}
			if seen[path] {
				return nil
			}
			seen[path] = true
			if info := parseSkillDirFromDisk(path); info != nil {
				skills = append(skills, *info)
			}
			return nil
		})
	}

	if skills == nil {
		return []GitSkillInfo{}
	}
	return skills
}

// ─── 公共工具函数 ───

func parseFrontmatter(content string) (name, description string) {
	re := regexp.MustCompile(`(?s)^---\s*\n(.+?)\n---`)
	matches := re.FindStringSubmatch(content)
	if len(matches) < 2 {
		return "", ""
	}
	lines := strings.Split(matches[1], "\n")
	nameRe := regexp.MustCompile(`^name:\s*(.+)$`)
	for _, line := range lines {
		if m := nameRe.FindStringSubmatch(line); len(m) > 1 {
			name = strings.TrimSpace(m[1])
			break
		}
	}
	description = parseDescriptionFromLines(lines)
	return name, description
}

func parseDescriptionFromLines(lines []string) string {
	descRe := regexp.MustCompile(`^description:\s*(.*)$`)
	for i, line := range lines {
		m := descRe.FindStringSubmatch(line)
		if len(m) < 2 {
			continue
		}
		value := strings.TrimSpace(m[1])
		if value != "" && value != "|" && value != ">" {
			return value
		}
		if value == "" {
			return ""
		}
		var block []string
		for j := i + 1; j < len(lines); j++ {
			l := lines[j]
			if len(l) == 0 {
				block = append(block, "")
				continue
			}
			if l[0] != ' ' && l[0] != '\t' {
				break
			}
			block = append(block, stripIndent(l))
		}
		if len(block) > 0 {
			return strings.TrimSpace(strings.Join(block, "\n"))
		}
		return value
	}
	return ""
}

func stripIndent(line string) string {
	if strings.HasPrefix(line, "  ") {
		return line[2:]
	}
	if strings.HasPrefix(line, "\t") {
		return line[1:]
	}
	return strings.TrimLeft(line, " \t")
}

func parseSkillDirFromDisk(skillDir string) *GitSkillInfo {
	mdPath := filepath.Join(skillDir, "SKILL.md")
	data, err := os.ReadFile(mdPath)
	if err != nil {
		return nil
	}
	name, desc := parseFrontmatter(string(data))
	if name == "" {
		name = filepath.Base(skillDir)
	}
	if desc == "" {
		desc = "(无描述)"
	}
	hash := md5.Sum(data)
	return &GitSkillInfo{
		Name:        name,
		Description: desc,
		SkillDir:    skillDir,
		SkillMd5:    hex.EncodeToString(hash[:]),
	}
}

func skillDirMd5(skillDir string) string {
	data, err := os.ReadFile(filepath.Join(skillDir, "SKILL.md"))
	if err != nil {
		return ""
	}
	hash := md5.Sum(data)
	return hex.EncodeToString(hash[:])
}

func sanitizeSubpath(subpath string) string {
	subpath = strings.ReplaceAll(subpath, "\\", "/")
	for _, s := range strings.Split(subpath, "/") {
		if s == ".." {
			return ""
		}
	}
	return subpath
}

func normalizeGitURL(url string) string {
	url = strings.TrimSuffix(url, ".git")
	url = regexp.MustCompile(`/tree/[^/]+(/.*)?$`).ReplaceAllString(url, "")
	return url
}

func copyDirRecursive(src, dst string) error {
	srcInfo, err := os.Stat(src)
	if err != nil {
		return err
	}
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
			if err := copyDirRecursive(srcPath, dstPath); err != nil {
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
	if info, err := os.Stat(src); err == nil {
		os.Chmod(dst, info.Mode())
	}
	return nil
}
