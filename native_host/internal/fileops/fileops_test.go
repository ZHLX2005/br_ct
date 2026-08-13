package fileops

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"

	"brochat_native_host/internal/protocol"
)

// createTestLink 创建指向 src 的链接（优先 symlink，失败降级 junction）
func createTestLink(t *testing.T, src, linkPath string) {
	t.Helper()
	err := os.Symlink(src, linkPath)
	if err == nil {
		return
	}
	if runtime.GOOS == "windows" {
		out, cerr := exec.Command("cmd", "/c", "mklink", "/J", linkPath, src).CombinedOutput()
		if cerr == nil {
			return
		}
		t.Fatalf("无法创建测试链接: %s", string(out))
	}
	t.Fatalf("无法创建测试链接: %v", err)
}

func TestMaterializeSkill_ConvertsLinkToFile(t *testing.T) {
	base := t.TempDir()
	src := filepath.Join(base, "center", "skills", "demo")
	if err := os.MkdirAll(src, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "SKILL.md"), []byte("---\nname: demo\n---"), 0644); err != nil {
		t.Fatal(err)
	}

	proj := filepath.Join(base, "project", ".claude", "skills")
	if err := os.MkdirAll(proj, 0755); err != nil {
		t.Fatal(err)
	}
	linkPath := filepath.Join(proj, "demo")
	createTestLink(t, src, linkPath)

	resp := MaterializeSkill(protocol.Request{Path: filepath.Join(base, "project"), Name: "demo"})
	if resp.Status != "ok" {
		t.Fatalf("status=%s message=%s", resp.Status, resp.Message)
	}
	data, ok := resp.Data.(map[string]interface{})
	if !ok || data["converted"] != true {
		t.Fatalf("期望 converted=true, 得到 %#v", resp.Data)
	}

	// 项目里不再是链接
	if _, err := os.Readlink(linkPath); err == nil {
		t.Fatalf("仍是链接，未物化")
	}
	content, err := os.ReadFile(filepath.Join(linkPath, "SKILL.md"))
	if err != nil {
		t.Fatalf("读取实体文件失败: %v", err)
	}
	if string(content) != "---\nname: demo\n---" {
		t.Fatalf("内容不符: %s", content)
	}
	// 源未被误删
	if _, err := os.Stat(filepath.Join(src, "SKILL.md")); err != nil {
		t.Fatalf("源目录被误删: %v", err)
	}
}

func TestMaterializeSkill_AlreadyRealFile(t *testing.T) {
	proj := filepath.Join(t.TempDir(), "project", ".claude", "skills", "demo")
	if err := os.MkdirAll(proj, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(proj, "SKILL.md"), []byte("real"), 0644); err != nil {
		t.Fatal(err)
	}

	resp := MaterializeSkill(protocol.Request{Path: filepath.Dir(filepath.Dir(filepath.Dir(proj))), Name: "demo"})
	if resp.Status != "ok" {
		t.Fatalf("status=%s message=%s", resp.Status, resp.Message)
	}
	data, ok := resp.Data.(map[string]interface{})
	if !ok || data["converted"] != false {
		t.Fatalf("期望 converted=false, 得到 %#v", resp.Data)
	}
	if _, err := os.ReadFile(filepath.Join(proj, "SKILL.md")); err != nil {
		t.Fatalf("实体文件被改动: %v", err)
	}
}
