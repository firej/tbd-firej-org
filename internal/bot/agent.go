package bot

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	maxToolIters   = 6  // кап tool-итераций на одно сообщение
	historyLimit   = 20 // реплик user/assistant в памяти на чат
	historyTTL     = 30 * time.Minute
	agentTimeout   = 3 * time.Minute
	maxHistoryRune = 2000 // длинные реплики в истории обрезаем
)

// ── история чатов (в памяти) ───────────────────────────────────────
//
// Только текстовые реплики user/assistant: tool-внутренности живут в рамках
// одного сообщения и в историю не попадают — дешёвой модели лишний контекст
// только мешает.

type history struct {
	mu    sync.Mutex
	chats map[int64]*chatHistory
}

type chatHistory struct {
	msgs    []ChatMessage
	updated time.Time
}

func newHistory() *history {
	return &history{chats: map[int64]*chatHistory{}}
}

func (h *history) get(chatID int64) []ChatMessage {
	h.mu.Lock()
	defer h.mu.Unlock()
	ch, ok := h.chats[chatID]
	if !ok || time.Since(ch.updated) > historyTTL {
		return nil
	}
	return append([]ChatMessage(nil), ch.msgs...)
}

func (h *history) add(chatID int64, msgs ...ChatMessage) {
	h.mu.Lock()
	defer h.mu.Unlock()
	ch, ok := h.chats[chatID]
	if !ok || time.Since(ch.updated) > historyTTL {
		ch = &chatHistory{}
		h.chats[chatID] = ch
	}
	for _, m := range msgs {
		if r := []rune(m.Content); len(r) > maxHistoryRune {
			m.Content = string(r[:maxHistoryRune]) + "…"
		}
		ch.msgs = append(ch.msgs, m)
	}
	if len(ch.msgs) > historyLimit {
		ch.msgs = ch.msgs[len(ch.msgs)-historyLimit:]
	}
	ch.updated = time.Now()
}

func (h *history) reset(chatID int64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.chats, chatID)
}

// ── конвертация инструментов MCP → OpenAI function calling ─────────

func toolDefs(tools []*mcp.Tool) ([]ToolDef, error) {
	out := make([]ToolDef, 0, len(tools))
	for _, t := range tools {
		var d ToolDef
		d.Type = "function"
		d.Function.Name = t.Name
		d.Function.Description = t.Description
		if t.InputSchema != nil {
			raw, err := json.Marshal(t.InputSchema)
			if err != nil {
				return nil, fmt.Errorf("schema %s: %w", t.Name, err)
			}
			d.Function.Parameters = raw
		}
		out = append(out, d)
	}
	return out, nil
}

// ── агентный цикл ──────────────────────────────────────────────────

func (a *App) systemPrompt(link *Link, instructions string) string {
	now := time.Now().In(a.userLoc(link))
	wd := [...]string{"воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"}
	return fmt.Sprintf(`Ты — ассистент менеджера задач tobedone в Telegram. Пользователь: %s.
Сейчас %s, %s (%s).

%s

Правила:
- Отвечай по-русски, коротко, обычным текстом без markdown.
- После действия — одна строка подтверждения, без пересказа всего списка.
- Если инструмент вернул ошибку с подсказкой — поправь аргументы и попробуй ещё раз.
- Не выдумывай задачи, id и содержимое досок: всё бери из инструментов.
- Если просьба не про задачи — вежливо скажи, что ты только про задачи.`,
		link.DisplayName, wd[now.Weekday()], now.Format("02.01.2006 15:04"), now.Location(),
		instructions)
}

// runAgent гоняет LLM с MCP-инструментами до текстового ответа.
func (a *App) runAgent(ctx context.Context, link *Link, userText string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, agentTimeout)
	defer cancel()

	tools, instructions, err := a.mcp.Tools(ctx, link.Token)
	if err != nil {
		return "", fmt.Errorf("mcp tools: %w", err)
	}
	defs, err := toolDefs(tools)
	if err != nil {
		return "", err
	}

	messages := []ChatMessage{{Role: "system", Content: a.systemPrompt(link, instructions)}}
	messages = append(messages, a.history.get(link.ChatID)...)
	messages = append(messages, ChatMessage{Role: "user", Content: userText})

	var finalText string
	for i := 0; ; i++ {
		msg, err := a.llm.Chat(ctx, messages, defs)
		if err != nil {
			return "", err
		}
		if len(msg.ToolCalls) == 0 || i >= maxToolIters {
			finalText = strings.TrimSpace(msg.Content)
			break
		}

		messages = append(messages, *msg)
		for _, tc := range msg.ToolCalls {
			var args map[string]any
			if err := json.Unmarshal([]byte(tc.Function.Arguments), &args); err != nil {
				args = map[string]any{}
			}
			text, isToolErr, err := a.mcp.CallTool(ctx, link.Token, tc.Function.Name, args)
			status := "ok"
			switch {
			case err != nil:
				text = "ошибка вызова: " + err.Error()
				status = "fail"
			case isToolErr:
				status = "tool-error"
			}
			log.Printf("agent chat=%d tool=%s args=%s → %s", link.ChatID, tc.Function.Name, tc.Function.Arguments, status)
			messages = append(messages, ChatMessage{Role: "tool", ToolCallID: tc.ID, Content: text})
			if err != nil && IsUnauthorized(err) {
				return "", err
			}
		}
	}

	if finalText == "" {
		finalText = "Сделал, но модель не оставила комментария. Проверь /today."
	}
	a.history.add(link.ChatID,
		ChatMessage{Role: "user", Content: userText},
		ChatMessage{Role: "assistant", Content: finalText},
	)
	return finalText, nil
}
