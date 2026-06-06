package protocol

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
)

// SkillGroup 对应 setting.json 中单个分组配置
type SkillGroup struct {
	ID     string   `json:"id"`
	Name   string   `json:"name"`
	Skills []string `json:"skills,omitempty"`
}

type Request struct {
	Command   string   `json:"command"`
	Path      string   `json:"path,omitempty"`
	Content   string   `json:"content,omitempty"`
	Prompt    string   `json:"prompt,omitempty"`
	FileName  string   `json:"fileName,omitempty"`
	WorkDir   string   `json:"workDir,omitempty"`
	Cmd       string   `json:"cmd,omitempty"`
	Args      []string `json:"args,omitempty"`
	Pid       int      `json:"pid,omitempty"`
	Dirs      []string `json:"dirs,omitempty"`
	Name      string   `json:"name,omitempty"`
	Src       string   `json:"src,omitempty"`
	DstParent string   `json:"dstParent,omitempty"`
	Message   string   `json:"message,omitempty"`
	Groups    []SkillGroup `json:"groups,omitempty"`
	IsCentral bool     `json:"isCentral,omitempty"`

	// Claude Query 字段
	SessionId string `json:"sessionId,omitempty"`
	Action    string `json:"action,omitempty"`
	Skills    string `json:"skills,omitempty"`

	// nx-ce serve 字段（claudeStartServe / claudeServeStatus 共用）
	Port  int    `json:"port,omitempty"`
	Model string `json:"model,omitempty"`
	Cwd   string `json:"cwd,omitempty"`
}

type Response struct {
	Status  string      `json:"status"`
	Data    interface{} `json:"data,omitempty"`
	Message string      `json:"message,omitempty"`
}

func ReadMessage(r io.Reader) (Request, error) {
	reader := bufio.NewReader(r)
	var length uint32
	if err := binary.Read(reader, binary.LittleEndian, &length); err != nil {
		return Request{}, err
	}
	if length > 10*1024*1024 {
		return Request{}, fmt.Errorf("message too large: %d", length)
	}
	buf := make([]byte, length)
	if _, err := io.ReadFull(reader, buf); err != nil {
		return Request{}, fmt.Errorf("read message: %v", err)
	}
	var req Request
	if err := json.Unmarshal(buf, &req); err != nil {
		return Request{}, err
	}
	return req, nil
}

func SendResponse(w io.Writer, resp Response) {
	data, err := json.Marshal(resp)
	if err != nil {
		return
	}
	binary.Write(w, binary.LittleEndian, uint32(len(data)))
	w.Write(data)
}
