package bot

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Мини-клиент OpenAI-совместимого chat completions API с tool calling.
// Ровно то подмножество, которое одинаково работает у DeepSeek, Qwen, GLM
// и OpenRouter; SDK ради этого не нужен.

type ChatMessage struct {
	Role       string     `json:"role"` // system | user | assistant | tool
	Content    string     `json:"content"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
}

type ToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"` // function
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"` // JSON-строка
	} `json:"function"`
}

type ToolDef struct {
	Type     string `json:"type"` // function
	Function struct {
		Name        string          `json:"name"`
		Description string          `json:"description,omitempty"`
		Parameters  json.RawMessage `json:"parameters,omitempty"`
	} `json:"function"`
}

type LLM struct {
	baseURL string
	apiKey  string
	model   string
	client  *http.Client
}

func NewLLM(baseURL, apiKey, model string) *LLM {
	return &LLM{
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  apiKey,
		model:   model,
		client:  &http.Client{Timeout: 120 * time.Second},
	}
}

// Enabled — настроена ли LLM (без неё бот работает в режиме команд).
func (l *LLM) Enabled() bool { return l != nil && l.baseURL != "" }

type chatRequest struct {
	Model    string        `json:"model"`
	Messages []ChatMessage `json:"messages"`
	Tools    []ToolDef     `json:"tools,omitempty"`
}

type chatResponse struct {
	Choices []struct {
		Message ChatMessage `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// Chat — один запрос к модели; вызывающий сам крутит агентный цикл.
func (l *LLM) Chat(ctx context.Context, messages []ChatMessage, tools []ToolDef) (*ChatMessage, error) {
	body, err := json.Marshal(chatRequest{Model: l.model, Messages: messages, Tools: tools})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", l.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+l.apiKey)

	resp, err := l.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}

	var out chatResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("llm: bad response (HTTP %d): %.200s", resp.StatusCode, raw)
	}
	if out.Error != nil {
		return nil, fmt.Errorf("llm: %s", out.Error.Message)
	}
	if resp.StatusCode != http.StatusOK || len(out.Choices) == 0 {
		return nil, fmt.Errorf("llm: HTTP %d, choices=%d", resp.StatusCode, len(out.Choices))
	}
	return &out.Choices[0].Message, nil
}
