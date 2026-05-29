// main.go
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type AliasConfig struct {
	Aliases map[string]string `json:"aliases"`
}

type EnvGroupsConfig struct {
	Groups map[string]map[string]string `json:"groups"`
}

var (
	configFile    string
	envGroupsFile string
	groupFlag     string
)

// 初始化配置文件路径 —— 程序所在目录
func init() {
	exePath, err := os.Executable()
	if err != nil {
		fmt.Println("Error: cannot determine executable path:", err)
		os.Exit(1)
	}

	exeDir := filepath.Dir(exePath)
	configFile = filepath.Join(exeDir, "aliases.json")
	envGroupsFile = filepath.Join(exeDir, "env_groups.json")
}

func loadConfig() (*AliasConfig, error) {
	if _, err := os.Stat(configFile); os.IsNotExist(err) {
		return &AliasConfig{Aliases: make(map[string]string)}, nil
	}
	data, err := os.ReadFile(configFile)
	if err != nil {
		return nil, err
	}
	var cfg AliasConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	if cfg.Aliases == nil {
		cfg.Aliases = make(map[string]string)
	}
	return &cfg, nil
}

func saveConfig(cfg *AliasConfig) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(configFile, data, 0644)
}

func loadEnvGroups() (*EnvGroupsConfig, error) {
	if _, err := os.Stat(envGroupsFile); os.IsNotExist(err) {
		return &EnvGroupsConfig{Groups: make(map[string]map[string]string)}, nil
	}
	data, err := os.ReadFile(envGroupsFile)
	if err != nil {
		return nil, err
	}
	var cfg EnvGroupsConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	if cfg.Groups == nil {
		cfg.Groups = make(map[string]map[string]string)
	}
	return &cfg, nil
}

func saveEnvGroups(cfg *EnvGroupsConfig) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(envGroupsFile, data, 0644)
}

// 判断是否是 Windows 系统
func isWindows() bool {
	return strings.Contains(strings.ToLower(os.Getenv("OS")), "windows") ||
		(os.PathSeparator == '\\')
}

func windowsShell() string {
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

// parseEnvArgs 解析 KEY=VAL 格式的参数
func parseEnvArgs(args []string) (map[string]string, error) {
	env := make(map[string]string)
	for _, arg := range args {
		parts := strings.SplitN(arg, "=", 2)
		if len(parts) != 2 {
			return nil, fmt.Errorf("invalid env format: %s (expected KEY=VALUE)", arg)
		}
		env[parts[0]] = parts[1]
	}
	return env, nil
}

// mergeEnv 将组变量合并到当前环境变量中（组变量优先覆盖）
func mergeEnv(groupVars map[string]string) []string {
	env := make(map[string]string)
	for _, e := range os.Environ() {
		parts := strings.SplitN(e, "=", 2)
		if len(parts) == 2 {
			env[parts[0]] = parts[1]
		}
	}
	for k, v := range groupVars {
		env[k] = v
	}
	result := make([]string, 0, len(env))
	for k, v := range env {
		result = append(result, fmt.Sprintf("%s=%s", k, v))
	}
	return result
}

func main() {
	flag.StringVar(&groupFlag, "g", "", "environment variable group to inject")
	flag.StringVar(&groupFlag, "group", "", "environment variable group to inject")
	flag.Parse()

	args := flag.Args()

	if len(args) < 1 {
		fmt.Println("Usage:")
		fmt.Println("  ali add <alias> <command>          Add an alias")
		fmt.Println("  ali rm <alias>                     Remove an alias")
		fmt.Println("  ali list                           List all aliases")
		fmt.Println("  ali env add <group> KEY=VAL ...    Add/update env group")
		fmt.Println("  ali env rm <group>                 Remove env group")
		fmt.Println("  ali env list                       List env groups")
		fmt.Println("  ali env show <group>               Show env group details")
		fmt.Println("  ali [-g <group>] <alias> [args...] Run alias with optional env group")
		fmt.Println("\nConfig files:")
		fmt.Println("  Aliases:   ", configFile)
		fmt.Println("  Env Groups:", envGroupsFile)
		return
	}

	cfg, err := loadConfig()
	if err != nil {
		fmt.Println("Error loading config:", err)
		os.Exit(1)
	}

	envCfg, err := loadEnvGroups()
	if err != nil {
		fmt.Println("Error loading env groups:", err)
		os.Exit(1)
	}

	cmd := args[0]

	// ==== env 子命令：环境变量组管理 ====
	if cmd == "env" {
		if len(args) < 2 {
			fmt.Println("Usage: ali env [add|rm|list|show] ...")
			return
		}
		envCmd := args[1]
		switch envCmd {
		case "add":
			if len(args) < 4 {
				fmt.Println("Usage: ali env add <group> KEY=VALUE [KEY2=VALUE2 ...]")
				return
			}
			groupName := args[2]
			envVars, err := parseEnvArgs(args[3:])
			if err != nil {
				fmt.Println("Error:", err)
				return
			}
			if envCfg.Groups[groupName] == nil {
				envCfg.Groups[groupName] = make(map[string]string)
			}
			for k, v := range envVars {
				envCfg.Groups[groupName][k] = v
			}
			if err := saveEnvGroups(envCfg); err != nil {
				fmt.Println("Error saving env groups:", err)
				return
			}
			fmt.Printf("Env group '%s' updated.\n", groupName)

		case "rm":
			if len(args) < 3 {
				fmt.Println("Usage: ali env rm <group>")
				return
			}
			groupName := args[2]
			delete(envCfg.Groups, groupName)
			if err := saveEnvGroups(envCfg); err != nil {
				fmt.Println("Error saving env groups:", err)
				return
			}
			fmt.Printf("Env group '%s' removed.\n", groupName)

		case "list":
			if len(envCfg.Groups) == 0 {
				fmt.Println("No env groups defined.")
				return
			}
			fmt.Println("Defined env groups:")
			for name := range envCfg.Groups {
				fmt.Printf("  %s\n", name)
			}

		case "show":
			if len(args) < 3 {
				fmt.Println("Usage: ali env show <group>")
				return
			}
			groupName := args[2]
			group, ok := envCfg.Groups[groupName]
			if !ok {
				fmt.Printf("Env group '%s' not found.\n", groupName)
				return
			}
			fmt.Printf("Env group '%s':\n", groupName)
			for k, v := range group {
				fmt.Printf("  %s=%s\n", k, v)
			}

		default:
			fmt.Printf("Unknown env command: %s\n", envCmd)
		}
		return
	}

	// ==== 原有的 add/rm/list 别名管理 ====
	switch cmd {
	case "add":
		if len(args) < 3 {
			fmt.Println("Usage: ali add <alias> <command>")
			return
		}
		name := args[1]
		command := strings.Join(args[2:], " ")
		cfg.Aliases[name] = command
		if err := saveConfig(cfg); err != nil {
			fmt.Println("Error saving config:", err)
			return
		}
		fmt.Printf("Alias added: %s → %s\n", name, command)
		return

	case "rm":
		if len(args) < 2 {
			fmt.Println("Usage: ali rm <alias>")
			return
		}
		name := args[1]
		delete(cfg.Aliases, name)
		if err := saveConfig(cfg); err != nil {
			fmt.Println("Error saving config:", err)
			return
		}
		fmt.Printf("Alias removed: %s\n", name)
		return

	case "list":
		if len(cfg.Aliases) == 0 {
			fmt.Println("No aliases defined.")
			return
		}
		fmt.Println("Defined aliases:")
		for k, v := range cfg.Aliases {
			fmt.Printf("  %-10s → %s\n", k, v)
		}
		return
	}

	// ==== 执行别名 ====
	aliasCmd, ok := cfg.Aliases[cmd]
	if !ok {
		fmt.Printf("Unknown command or alias: %s\n", cmd)
		return
	}

	fullCmd := aliasCmd
	if len(args) > 1 {
		fullCmd += " " + strings.Join(args[1:], " ")
	}

	var execCmd *exec.Cmd

	if isWindows() {
		// Windows 使用 cmd /C 执行
		execCmd = exec.Command(windowsShell(), "/C", fullCmd)
	} else {
		// Linux/macOS 使用 sh -c 执行
		execCmd = exec.Command("sh", "-c", fullCmd)
	}

	// 注入环境变量组
	if groupFlag != "" {
		groupVars, ok := envCfg.Groups[groupFlag]
		if !ok {
			fmt.Printf("Env group '%s' not found.\n", groupFlag)
			return
		}
		execCmd.Env = mergeEnv(groupVars)
	}

	execCmd.Stdout = os.Stdout
	execCmd.Stderr = os.Stderr
	execCmd.Stdin = os.Stdin
	execCmd.Dir, _ = filepath.Abs(".")
	if err := execCmd.Run(); err != nil {
		fmt.Println("Error executing alias:", err)
	}
}
