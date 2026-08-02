package bot

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	tg "github.com/go-telegram/bot"
	"github.com/go-telegram/bot/models"
)

// App — телеграм-бот целиком: polling, команды, LLM-цикл, лимиты.
type App struct {
	cfg     *Config
	store   *Store
	mcp     *MCP
	llm     *LLM
	history *history
	tg      *tg.Bot

	// Последний обработанный update_id. Источник правды — память
	// (сравнение на каждом апдейте), sqlite — чтобы пережить рестарт.
	lastUpdate atomic.Int64

	mu     sync.Mutex
	queues map[int64]chan *models.Message // FIFO-очередь на чат
}

func New(cfg *Config, store *Store) (*App, error) {
	a := &App{
		cfg:     cfg,
		store:   store,
		mcp:     NewMCP(cfg.MCPURL),
		llm:     NewLLM(cfg.LLMBaseURL, cfg.LLMAPIKey, cfg.LLMModel),
		history: newHistory(),
		queues:  map[int64]chan *models.Message{},
	}

	a.lastUpdate.Store(store.LastUpdateID())

	opts := []tg.Option{
		// Приём строго последовательный — иначе дедуп по update_id гоняется
		// сам с собой. Тяжёлая работа уходит в очереди чатов, intake быстрый.
		tg.WithNotAsyncHandlers(),
		tg.WithDefaultHandler(a.handleUpdate),
		tg.WithAllowedUpdates(tg.AllowedUpdates{"message"}),
		tg.WithInitialOffset(store.LastUpdateID()),
	}
	if cfg.TelegramAPI != "" {
		opts = append(opts, tg.WithServerURL(cfg.TelegramAPI))
	}
	b, err := tg.New(cfg.TelegramToken, opts...)
	if err != nil {
		return nil, fmt.Errorf("telegram: %w", err)
	}
	a.tg = b
	return a, nil
}

// Run — блокируется до отмены ctx.
func (a *App) Run(ctx context.Context) {
	_, err := a.tg.SetMyCommands(ctx, &tg.SetMyCommandsParams{Commands: []models.BotCommand{
		{Command: "today", Description: "Агенда на сегодня"},
		{Command: "tz", Description: "Часовой пояс, напр. /tz Europe/Moscow"},
		{Command: "reset", Description: "Забыть контекст разговора"},
		{Command: "unlink", Description: "Отвязать аккаунт"},
		{Command: "help", Description: "Что умеет бот"},
	}})
	if err != nil {
		log.Printf("setMyCommands: %v", err)
	}
	log.Printf("bot: polling started (llm=%v)", a.llm.Enabled())
	a.tg.Start(ctx)
}

// ── intake ─────────────────────────────────────────────────────────

// handleUpdate — быстрый последовательный приём: дедуп, персист offset,
// раскладка по очередям чатов.
func (a *App) handleUpdate(ctx context.Context, _ *tg.Bot, u *models.Update) {
	if u.ID != 0 {
		if u.ID <= a.lastUpdate.Load() {
			return // уже обрабатывали (передоставка после рестарта)
		}
		a.lastUpdate.Store(u.ID)
		if err := a.store.SetLastUpdateID(u.ID); err != nil {
			log.Printf("persist update_id: %v", err)
		}
	}
	msg := u.Message
	if msg == nil || msg.Text == "" || msg.Chat.Type != models.ChatTypePrivate {
		return // группы и не-текст — не в этой версии
	}

	a.mu.Lock()
	q, ok := a.queues[msg.Chat.ID]
	if !ok {
		q = make(chan *models.Message, 8)
		a.queues[msg.Chat.ID] = q
		go a.chatWorker(q)
	}
	a.mu.Unlock()

	select {
	case q <- msg:
	default:
		a.reply(msg.Chat.ID, "Не успеваю за тобой — подожди, пока отвечу на предыдущее.")
	}
}

// chatWorker разбирает сообщения одного чата по одному (замок на чат).
func (a *App) chatWorker(q chan *models.Message) {
	for msg := range q {
		func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("panic chat=%d: %v", msg.Chat.ID, r)
					a.reply(msg.Chat.ID, "Что-то сломалось. Попробуй ещё раз.")
				}
			}()
			a.handleMessage(context.Background(), msg)
		}()
	}
}

// ── маршрутизация ──────────────────────────────────────────────────

func (a *App) handleMessage(ctx context.Context, msg *models.Message) {
	chatID := msg.Chat.ID
	text := strings.TrimSpace(msg.Text)
	cmd, arg := splitCommand(text)
	// Текст сообщений не логируем (приватность) — только команду.
	log.Printf("msg chat=%d cmd=%q len=%d", chatID, cmd, len(text))

	switch cmd {
	case "/start":
		a.cmdStart(ctx, msg, arg)
	case "/link":
		a.cmdLink(ctx, msg, arg)
	case "/unlink":
		a.cmdUnlink(ctx, chatID)
	case "/today":
		a.cmdToday(ctx, chatID)
	case "/tz":
		a.cmdTZ(ctx, chatID, arg)
	case "/reset":
		a.history.reset(chatID)
		a.reply(chatID, "Контекст забыт.")
	case "/help":
		a.reply(chatID, a.helpText())
	case "/stats":
		a.cmdStats(chatID)
	default:
		a.freeText(ctx, msg)
	}
}

func splitCommand(text string) (cmd, arg string) {
	if !strings.HasPrefix(text, "/") {
		return "", text
	}
	cmd, arg, _ = strings.Cut(text, " ")
	// команды вида /today@my_bot
	cmd, _, _ = strings.Cut(cmd, "@")
	return cmd, strings.TrimSpace(arg)
}

// ── команды ────────────────────────────────────────────────────────

func (a *App) cmdStart(ctx context.Context, msg *models.Message, code string) {
	if code != "" {
		a.linkByCode(ctx, msg, code)
		return
	}
	if l, err := a.store.GetLink(msg.Chat.ID); err == nil && l != nil {
		a.reply(msg.Chat.ID, "Аккаунт уже привязан. Пиши задачу текстом или смотри /today.")
		return
	}
	a.reply(msg.Chat.ID, "Привет! Я бот менеджера задач tobedone.\n\n"+
		"Чтобы привязать аккаунт: открой tobedone в браузере → меню профиля → "+
		"«Подключить Telegram» и перейди по ссылке. Или пришли код командой /link <код>.")
}

func (a *App) cmdLink(ctx context.Context, msg *models.Message, arg string) {
	if arg == "" {
		a.reply(msg.Chat.ID, "Формат: /link <код из веб-интерфейса или API-токен tbd_...>")
		return
	}
	if strings.HasPrefix(arg, "tbd_") {
		// токен напрямую: проверяем его живым вызовом
		if _, _, err := a.mcp.CallTool(ctx, arg, "list_boards", nil); err != nil {
			a.reply(msg.Chat.ID, "Токен не подошёл: "+shortErr(err))
			return
		}
		name := strings.TrimSpace(msg.From.FirstName)
		if err := a.store.SaveLink(Link{ChatID: msg.Chat.ID, Token: arg, DisplayName: name, TZ: ""}); err != nil {
			a.reply(msg.Chat.ID, "Не смог сохранить привязку, попробуй позже.")
			return
		}
		a.afterLink(msg.Chat.ID, name)
		return
	}
	a.linkByCode(ctx, msg, arg)
}

func (a *App) linkByCode(ctx context.Context, msg *models.Message, code string) {
	token, name, err := a.exchange(ctx, code)
	if err != nil {
		a.reply(msg.Chat.ID, "Не получилось: "+shortErr(err))
		return
	}
	if err := a.store.SaveLink(Link{ChatID: msg.Chat.ID, Token: token, DisplayName: name, TZ: ""}); err != nil {
		a.reply(msg.Chat.ID, "Не смог сохранить привязку, попробуй позже.")
		return
	}
	a.afterLink(msg.Chat.ID, name)
}

func (a *App) afterLink(chatID int64, name string) {
	hello := "Готово"
	if name != "" {
		hello += ", " + name
	}
	a.reply(chatID, hello+"! Аккаунт привязан.\n\n"+
		"Попробуй:\n"+
		"• «добавь купить молоко на завтра»\n"+
		"• «что у меня на сегодня?» или /today\n"+
		"• «сделал зарядку»\n\n"+
		"Часовой пояс по умолчанию — "+a.cfg.DefaultTZ+", сменить: /tz Europe/Berlin")
}

func (a *App) cmdUnlink(ctx context.Context, chatID int64) {
	if l, err := a.store.GetLink(chatID); err == nil && l == nil {
		a.reply(chatID, "Аккаунт и так не привязан.")
		return
	}
	_ = a.store.DeleteLink(chatID)
	a.history.reset(chatID)
	a.reply(chatID, "Отвязал. Токен «telegram» можно отозвать в веб-интерфейсе (меню профиля).")
}

func (a *App) cmdToday(ctx context.Context, chatID int64) {
	link := a.requireLink(chatID)
	if link == nil {
		return
	}
	date := time.Now().In(a.userLoc(link)).Format("2006-01-02")
	text, _, err := a.mcp.CallTool(ctx, link.Token, "today_agenda", map[string]any{"date": date})
	if err != nil {
		a.replyMCPError(chatID, err)
		return
	}
	a.reply(chatID, text)
}

func (a *App) cmdTZ(ctx context.Context, chatID int64, arg string) {
	link := a.requireLink(chatID)
	if link == nil {
		return
	}
	if arg == "" {
		a.reply(chatID, "Текущий пояс: "+a.userLoc(link).String()+"\nСменить: /tz Europe/Berlin")
		return
	}
	if _, err := time.LoadLocation(arg); err != nil {
		a.reply(chatID, "Не знаю такой пояс. Нужно IANA-имя, например Europe/Moscow или Asia/Nicosia.")
		return
	}
	_ = a.store.SetTZ(chatID, arg)
	a.reply(chatID, "Пояс сохранён: "+arg)
}

func (a *App) cmdStats(chatID int64) {
	if a.cfg.OwnerChatID == 0 || chatID != a.cfg.OwnerChatID {
		a.reply(chatID, "Эта команда только для владельца бота.")
		return
	}
	day := time.Now().Format("2006-01-02")
	a.reply(chatID, fmt.Sprintf("Привязано чатов: %d\nLLM-запросов сегодня: %d (глобальный лимит %d)",
		a.store.CountLinks(), a.store.UsageTotal(day), a.cfg.GlobalLimit))
}

func (a *App) helpText() string {
	s := "Я — бот менеджера задач tobedone.\n\n" +
		"Пиши обычным текстом:\n" +
		"• «добавь позвонить в банк в пятницу 12:00»\n" +
		"• «что у меня на сегодня?»\n" +
		"• «сделал зарядку», «перенеси налоги на завтра»\n\n" +
		"Команды:\n" +
		"/today — агенда на сегодня\n" +
		"/tz — часовой пояс\n" +
		"/reset — забыть контекст\n" +
		"/unlink — отвязать аккаунт\n\n" +
		"Удалять задачи я не умею принципиально — только в веб-интерфейсе."
	if a.llm.Enabled() {
		s += "\n\nСвободный текст обрабатывает модель " + a.cfg.LLMModel + " — учитывай это в плане приватности."
	}
	return s
}

// ── свободный текст → LLM ──────────────────────────────────────────

func (a *App) freeText(ctx context.Context, msg *models.Message) {
	chatID := msg.Chat.ID
	link := a.requireLink(chatID)
	if link == nil {
		return
	}
	if !a.llm.Enabled() {
		a.reply(chatID, "LLM у бота не настроена — доступны команды, например /today.")
		return
	}

	day := time.Now().Format("2006-01-02")
	if total := a.store.UsageTotal(day); total >= a.cfg.GlobalLimit {
		a.alertOwnerOnce("global-cap:"+day, "Глобальный дневной лимит LLM исчерпан: "+day)
		a.reply(chatID, "Дневной лимит бота исчерпан, попробуй завтра. Команда /today работает всегда.")
		return
	}
	n, err := a.store.IncUsage(chatID, day)
	if err == nil && n > a.cfg.DailyLimit {
		a.reply(chatID, "Твой дневной лимит сообщений исчерпан. /today работает без лимита.")
		return
	}

	stopTyping := a.typing(ctx, chatID)
	defer stopTyping()

	answer, err := a.runAgent(ctx, link, msg.Text)
	if err != nil {
		if IsUnauthorized(err) {
			a.replyMCPError(chatID, err)
			return
		}
		log.Printf("agent chat=%d: %v", chatID, err)
		a.reply(chatID, "Не получилось обработать — попробуй ещё раз или воспользуйся /today.")
		return
	}
	a.reply(chatID, answer)
}

// ── обмен кода привязки ────────────────────────────────────────────

func (a *App) exchange(ctx context.Context, code string) (token, displayName string, err error) {
	body, _ := json.Marshal(map[string]string{"code": code})
	req, err := http.NewRequestWithContext(ctx, "POST", a.cfg.ExchangeURL, bytes.NewReader(body))
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))

	var out struct {
		Token       string `json:"token"`
		DisplayName string `json:"display_name"`
		Error       string `json:"error"`
	}
	_ = json.Unmarshal(raw, &out)
	if resp.StatusCode != http.StatusOK || out.Token == "" {
		if out.Error != "" {
			return "", "", fmt.Errorf("%s", out.Error)
		}
		return "", "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return out.Token, out.DisplayName, nil
}

// ── helpers ────────────────────────────────────────────────────────

func (a *App) userLoc(link *Link) *time.Location {
	for _, name := range []string{link.TZ, a.cfg.DefaultTZ} {
		if name == "" {
			continue
		}
		if loc, err := time.LoadLocation(name); err == nil {
			return loc
		}
	}
	return time.Local
}

// requireLink достаёт привязку; сам отвечает юзеру и возвращает nil, если
// чат не привязан или база недоступна (это разные сообщения — сбой БД не
// повод говорить привязанному человеку «привяжись заново»).
func (a *App) requireLink(chatID int64) *Link {
	link, err := a.store.GetLink(chatID)
	if err != nil {
		log.Printf("store chat=%d: %v", chatID, err)
		a.reply(chatID, "Не могу достучаться до своей базы, попробуй через минуту.")
		return nil
	}
	if link == nil {
		a.replyNotLinked(chatID)
		return nil
	}
	return link
}

func (a *App) replyNotLinked(chatID int64) {
	a.reply(chatID, "Сначала привяжи аккаунт: меню профиля в веб-интерфейсе tobedone → «Подключить Telegram». Подробнее — /start")
}

func (a *App) replyMCPError(chatID int64, err error) {
	if IsUnauthorized(err) {
		_ = a.store.DeleteLink(chatID)
		a.history.reset(chatID)
		a.reply(chatID, "Похоже, токен отозван — аккаунт отвязан. Привяжись заново через /start.")
		return
	}
	log.Printf("mcp chat=%d: %v", chatID, err)
	a.reply(chatID, "Сервер задач не отвечает, попробуй чуть позже.")
}

// typing показывает «печатает…», пока идёт LLM-цикл.
func (a *App) typing(ctx context.Context, chatID int64) (stop func()) {
	done := make(chan struct{})
	go func() {
		t := time.NewTicker(4 * time.Second)
		defer t.Stop()
		for {
			_, _ = a.tg.SendChatAction(ctx, &tg.SendChatActionParams{ChatID: chatID, Action: models.ChatActionTyping})
			select {
			case <-done:
				return
			case <-t.C:
			}
		}
	}()
	return func() { close(done) }
}

const tgMaxLen = 4096

// reply шлёт текст, длинное режет по строкам под лимит telegram.
func (a *App) reply(chatID int64, text string) {
	for _, chunk := range splitMessage(text, tgMaxLen) {
		_, err := a.tg.SendMessage(context.Background(), &tg.SendMessageParams{ChatID: chatID, Text: chunk})
		if err != nil {
			log.Printf("send chat=%d: %v", chatID, err)
			return
		}
	}
}

func splitMessage(text string, limit int) []string {
	if len(text) <= limit {
		return []string{text}
	}
	var out []string
	for len(text) > limit {
		cut := strings.LastIndex(text[:limit], "\n")
		if cut < limit/2 {
			cut = limit // нет удобного переноса — режем жёстко
		}
		out = append(out, strings.TrimRight(text[:cut], "\n"))
		text = strings.TrimLeft(text[cut:], "\n")
	}
	if text != "" {
		out = append(out, text)
	}
	return out
}

func (a *App) alertOwnerOnce(key, text string) {
	if a.cfg.OwnerChatID == 0 || a.store.MetaFlag(key) {
		return
	}
	a.store.SetMetaFlag(key)
	a.reply(a.cfg.OwnerChatID, "⚠️ "+text)
}

func shortErr(err error) string {
	s := err.Error()
	if r := []rune(s); len(r) > 200 {
		s = string(r[:200]) + "…"
	}
	return s
}
