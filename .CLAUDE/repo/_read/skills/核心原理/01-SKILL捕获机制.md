# SKILL 捕获机制原理

## 1. 概述

`npx skills add <source>` 的核心流程分为三个阶段：

```
输入解析 (parseSource)
    ↓
获取仓库 (clone / blob download)
    ↓
发现技能 (discoverSkills)
    ↓
解析 frontmatter (parseFrontmatter)
    ↓
安装到目标 Agent (installSkillForAgent)
```

---

## 2. 输入解析：`source-parser.ts`

`skills` 支持多种输入格式，统一由 `parseSource()` 解析为 `ParsedSource` 结构：

```typescript
// 来源: src/source-parser.ts:240-408
export function parseSource(input: string): ParsedSource
```

### 2.1 支持的输入格式

| 格式 | 示例 | 类型 |
|------|------|------|
| GitHub 简写 | `vercel-labs/agent-skills` | `github` |
| GitHub URL | `https://github.com/vercel-labs/agent-skills` | `github` |
| GitHub tree URL | `https://github.com/owner/repo/tree/branch/path/to/skill` | `github` |
| `@` 选择技能 | `owner/repo@skill-name` | `github` |
| `#` 指定分支 | `owner/repo#main` | `github` |
| GitLab URL | `https://gitlab.com/owner/repo` | `gitlab` |
| 本地路径 | `./my-local-skills` | `local` |
| 任意 git URL | `git@github.com:owner/repo.git` | `git` |
| 任意 HTTP(S) URL | `https://skills.company.com/...` | `well-known` |

**路径遍历防护**：`sanitizeSubpath()` 拒绝包含 `..` 的子路径，防止恶意仓库逃逸到目标目录之外：

```typescript
// 来源: src/source-parser.ts:105-121
export function sanitizeSubpath(subpath: string): string {
  const segments = normalized.split('/');
  for (const segment of segments) {
    if (segment === '..') {
      throw new Error(`Unsafe subpath: "${subpath}" contains path traversal segments.`);
    }
  }
  return subpath;
}
```

---

## 3. 获取仓库内容

### 3.1 普通 Clone：`git.ts`

对于非白名单仓库，走完整的 git clone 流程：

```typescript
// 来源: src/git.ts:191-249
export async function cloneRepo(url: string, ref?: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'skills-'));
  const cloneOptions = ref ? ['--depth', '1', '--branch', ref] : ['--depth', '1'];

  try {
    await createGitClient().clone(url, tempDir, cloneOptions);
    return tempDir;
  } catch (error) {
    // HTTPS 认证失败 → 尝试 gh CLI → 回退到 SSH
    if (isAuthError && isGitHubHttpsCloneUrl(url)) {
      if (await tryGhClone(repo, tempDir, ref)) return tempDir;
      await createGitClient({ GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' }).clone(repo.sshUrl, tempDir, cloneOptions);
    }
  }
}
```

**关键配置**：
- `GIT_TERMINAL_PROMPT=0`：禁止 git 交互式认证提示
- `GIT_LFS_SKIP_SMUDGE=1`：跳过 LFS 文件下载（skill 文件均为纯文本）
- `--depth=1`：浅克隆，减小体积
- 5 分钟超时，可通过 `SKILLS_CLONE_TIMEOUT_MS` 环境变量覆盖

### 3.2 Blob 快速下载：`blob.ts`

对于 Vercel 官方白名单仓库，跳过 clone，直接通过 GitHub Trees API 下载文件：

```typescript
// 来源: src/add.ts:1054-1071
const BLOB_ALLOWED_OWNERS = ['vercel', 'vercel-labs', 'heygen-com'];
if (ownerRepo && owner && (isSelfHostedRepo || BLOB_ALLOWED_OWNERS.includes(owner))) {
  blobResult = await tryBlobInstall(ownerRepo, { subpath, skillFilter, ref, getToken, includeInternal });
}
```

`tryBlobInstall()` 内部通过 GitHub REST API 获取仓库文件树，再逐个文件抓取内容，写入临时目录。完全避免了 `git clone`，速度更快。

---

## 4. 发现 Skill：`skills.ts`

### 4.1 搜索目录优先级

`discoverSkills()` 按以下顺序扫描 SKILL.md 文件：

```typescript
// 来源: src/skills.ts:208-227
const prioritySearchDirs = [
  searchPath,                          // 仓库根目录
  join(searchPath, 'skills'),           // skills/
  join(searchPath, 'skills/.curated'), // skills/.curated/
  join(searchPath, 'skills/.experimental'),
  join(searchPath, 'skills/.system'),
  // Agent 特有目录（.claude/skills/、.cline/skills/ 等）
  ...AGENT_PROJECT_SKILL_DIRS.map(dir => join(searchPath, dir)),
];
```

### 4.2 目录遍历深度规则

skills 发现机制的核心设计是**分深度搜索**：

```typescript
// 来源: src/skills.ts:240-271
for (const dir of prioritySearchDirs) {
  const walkDeep = deepContainerDirs.has(dir);  // skills/ 类目录多搜一层

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const foundAtChild = await tryAddSkillAt(childDir);

    if (foundAtChild || !walkDeep) continue;
    // 对于 catalog 布局（skills/<category>/<skill>/SKILL.md），
    // 再往下走一层
    const grandEntries = await readdir(childDir, { withFileTypes: true });
    for (const grand of grandEntries) {
      await tryAddSkillAt(join(childDir, grand.name));
    }
  }
}
```

这使得两种常见布局都能被发现：

```
# 扁平布局
skills/
  frontend-design/SKILL.md
  code-review/SKILL.md

# Catalog 布局（多一层分类）
skills/
  document-skills/
    writing/SKILL.md
    review/SKILL.md
```

### 4.3 兜底递归搜索

若标准位置没找到任何 skill，且设置了 `--full-depth`，则进行全仓库递归搜索：

```typescript
// 来源: src/skills.ts:275-286
if (skills.length === 0 || options?.fullDepth) {
  const allSkillDirs = await findSkillDirs(searchPath, 0, 5);
  for (const skillDir of allSkillDirs) {
    let skill = await parseSkillMd(join(skillDir, 'SKILL.md'), options);
    if (skill && !seenNames.has(skill.name) && !isInstalledProjectSkill(skill)) {
      skills.push(skill);
    }
  }
}
```

### 4.4 Plugin Manifest 支持

支持 `.claude-plugin/marketplace.json` 和 `.claude-plugin/plugin.json` 中声明的 skill 路径：

```typescript
// 来源: src/plugin-manifest.ts:77-109
// marketplace.json 示例
{
  "metadata": { "pluginRoot": "./plugins" },
  "plugins": [{
    "name": "my-plugin",
    "source": "my-plugin",
    "skills": ["./skills/review", "./skills/test"]
  }]
}
```

---

## 5. Frontmatter 解析：`frontmatter.ts`

每个 SKILL.md 文件必须包含 YAML frontmatter，且必须有 `name` 和 `description`：

```typescript
// 来源: src/frontmatter.ts:8-16
export function parseFrontmatter(raw: string): { data: Record<string, unknown>; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, content: raw };
  const data = parseYaml(match[1]!) as Record<string, unknown>;
  return { data, content: match[2] ?? '' };
}

// 来源: src/skills.ts:64-99
export async function parseSkillMd(skillMdPath: string, options?): Promise<Skill | null> {
  const content = await readFile(skillMdPath, 'utf-8');
  const { data } = parseFrontmatter(content);

  if (!data.name || !data.description) return null;  // 缺少任一字段则跳过
  return {
    name: sanitizeMetadata(data.name),
    description: sanitizeMetadata(data.description),
    path: dirname(skillMdPath),
    rawContent: content,
    metadata: data.metadata,
  };
}
```

**最小有效 SKILL.md**：

```markdown
---
name: my-skill
description: What this skill does
---

# My Skill
...
```

**可选 `metadata.internal: true`** 标记内部 skill，默认不显示，除非设置 `INSTALL_INTERNAL_SKILLS=1`。

---

## 6. 安装到目标 Agent：`installer.ts`

发现的所有 skill 需要安装到目标 Agent 的 skills 目录。`installSkillForAgent()` 支持两种模式：

| 模式 | 行为 | 适用场景 |
|------|------|----------|
| `symlink`（推荐） | 符号链接到 canonical 副本目录 | 多 Agent 共用一个 skill 源，便于更新 |
| `copy` | 复制文件到各 Agent 目录 | Agent 不支持符号链接时（如部分 Windows 环境） |

```typescript
// 来源: src/installer.ts
export async function installSkillForAgent(
  skill: Skill,
  agent: AgentType,
  { global, mode }
): Promise<InstallResult>
```

**安装路径规则**（每个 Agent 独立配置）：

```typescript
// 来源: src/agents.ts（部分）
const AGENT_PROJECT_SKILL_DIRS = [
  '.claude/skills',   // Claude Code 项目级
  '.cline/skills',    // Cline
  '.agents/skills',   // 通用 Agent
  // ...
];
```

---

## 7. 完整数据流

```
用户输入: npx skills add owner/repo@skill-name
                    │
                    ▼
            parseSource() ──→ ParsedSource { type: 'github', url, ref, skillFilter }
                    │
                    ▼
        ┌───────────────────────────────────────┐
        │  白名单仓库？                            │
        │  owner ∈ {vercel, vercel-labs}         │
        └───────────────────────────────────────┘
                    │                    │
                   是                   否
                    ▼                   ▼
        tryBlobInstall()          cloneRepo() ──→ 临时目录 tempDir
        (GitHub API 下载)                    │
                    │                        ▼
                    └─────────── discoverSkills(tempDir, subpath)
                                       │
                                       ▼
                            ┌─ 遍历 prioritySearchDirs
                            │  ├─ 根目录 / skills/ / skills/.curated/ 等
                            │  └─ Agent 特有目录 (.claude/skills/ 等)
                            │
                            ▼
                       find SKILL.md
                            │
                            ▼
                   parseFrontmatter() + parseSkillMd()
                            │
                            ▼
                     Skill { name, description, path, rawContent }
                            │
                            ▼
              过滤: options.skill 指定的名字, internal 等
                            │
                            ▼
                 installSkillForAgent(skill, agent, { mode })
                            │
                            ▼
                 创建 symlink / copy 到目标 Agent 目录
                            │
                            ▼
                   addSkillToLock() / addSkillToLocalLock()
                            │
                            ▼
                      清理 tempDir
```

---

## 8. 安全设计

| 威胁 | 防护机制 | 源码位置 |
|------|----------|----------|
| 路径遍历（`..` 逃逸） | `sanitizeSubpath()` 拒绝包含 `..` 的路径 | `source-parser.ts:105-121` |
| 路径遍历（resolve 后逃逸） | `isSubpathSafe()` 验证 normalize 后的路径 | `skills.ts:137-142` |
| 任意文件删除 | `cleanupTempDir()` 只允许删除 `tmpdir()` 内的目录 | `git.ts:251-261` |
| LFS 大文件下载 | `GIT_LFS_SKIP_SMUDGE=1` 跳过 LFS | `git.ts:109` |
| 恶意 Skill 注入 | `internal: true` 默认隐藏；OpenClaw 需要 `--dangerouslyAcceptOpenclawRisks` | `skills.ts:84-87`, `add.ts:994-1011` |
| 交互式 git 认证 | `GIT_TERMINAL_PROMPT=0` 禁用 | `git.ts:106` |
| YAML RCE | 仅解析 `---` 分隔的 YAML，不支持 `---js`/`---javascript` | `frontmatter.ts:7-16` |

---

## 9. 性能优化

- **Blob 下载**：白名单仓库跳过 git clone，直接 API 下载，延迟从秒级降至百毫秒级
- **并行文件读取**：`findSkillDirs()` 用 `Promise.all()` 并行遍历子目录
- **GitHub API 缓存**：克隆安装时，一次性获取仓库文件树缓存，用于计算所有 skill 的 `skillFolderHash`（避免 N 次单独 API 调用）
- **提前隐私检查**：仓库是否私有的检查与 clone/install 并行执行，不阻塞 UI
