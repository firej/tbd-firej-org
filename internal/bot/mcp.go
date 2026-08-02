package bot

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// errUnauthorized — сервер отверг Bearer: токен отозван в вебе.
var errUnauthorized = errors.New("mcp: unauthorized")

// bearerTransport подставляет Authorization и превращает 401 в errUnauthorized,
// чтобы бот мог отличить «отвязали» от прочих ошибок.
type bearerTransport struct {
	token string
}

func (t *bearerTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	req = req.Clone(req.Context())
	req.Header.Set("Authorization", "Bearer "+t.token)
	resp, err := http.DefaultTransport.RoundTrip(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusUnauthorized {
		resp.Body.Close()
		return nil, errUnauthorized
	}
	return resp, nil
}

// MCP — клиент к MCP-эндпоинту tobedone. Сервер stateless, поэтому на каждый
// вызов создаётся свежая сессия (initialize + call — два запроса по локальной
// сети, дёшево и без инвалидации).
type MCP struct {
	url string

	mu           sync.Mutex
	tools        []*mcp.Tool
	instructions string
	fetchedAt    time.Time
}

func NewMCP(url string) *MCP {
	return &MCP{url: url}
}

func (m *MCP) session(ctx context.Context, token string) (*mcp.ClientSession, error) {
	client := mcp.NewClient(&mcp.Implementation{Name: "tobedone-bot", Version: "1.0.0"}, nil)
	return client.Connect(ctx, &mcp.StreamableClientTransport{
		Endpoint:             m.url,
		HTTPClient:           &http.Client{Transport: &bearerTransport{token: token}, Timeout: 30 * time.Second},
		DisableStandaloneSSE: true, // stateless-сервер, server push не нужен
		MaxRetries:           -1,
	}, nil)
}

// IsUnauthorized — был ли отказ по токену (пользователь отвязан).
func IsUnauthorized(err error) bool {
	return errors.Is(err, errUnauthorized) ||
		(err != nil && strings.Contains(err.Error(), errUnauthorized.Error()))
}

// CallTool зовёт инструмент и возвращает текст результата.
// isToolErr=true — инструмент вернул ошибку-подсказку (для LLM это не сбой,
// а материал для самокоррекции).
func (m *MCP) CallTool(ctx context.Context, token, name string, args map[string]any) (text string, isToolErr bool, err error) {
	cs, err := m.session(ctx, token)
	if err != nil {
		return "", false, err
	}
	defer cs.Close()

	res, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		return "", false, err
	}
	var b strings.Builder
	for _, c := range res.Content {
		if t, ok := c.(*mcp.TextContent); ok {
			b.WriteString(t.Text)
		}
	}
	out := strings.TrimSpace(b.String())
	if out == "" {
		out = "(пустой ответ)"
	}
	return out, res.IsError, nil
}

// Tools возвращает список инструментов и server instructions; кэш общий на
// всех юзеров (инструменты одинаковые), обновляется раз в час.
func (m *MCP) Tools(ctx context.Context, token string) ([]*mcp.Tool, string, error) {
	m.mu.Lock()
	if m.tools != nil && time.Since(m.fetchedAt) < time.Hour {
		tools, instr := m.tools, m.instructions
		m.mu.Unlock()
		return tools, instr, nil
	}
	m.mu.Unlock()

	cs, err := m.session(ctx, token)
	if err != nil {
		return nil, "", err
	}
	defer cs.Close()

	res, err := cs.ListTools(ctx, &mcp.ListToolsParams{})
	if err != nil {
		return nil, "", fmt.Errorf("tools/list: %w", err)
	}
	instr := ""
	if init := cs.InitializeResult(); init != nil {
		instr = init.Instructions
	}

	m.mu.Lock()
	m.tools, m.instructions, m.fetchedAt = res.Tools, instr, time.Now()
	m.mu.Unlock()
	return res.Tools, instr, nil
}
