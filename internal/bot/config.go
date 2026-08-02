package bot

import (
	"fmt"
	"os"
	"strconv"
)

// Config — конфигурация бота, читается из ENV. Персональные настройки юзеров
// (TZ, расписания) живут не здесь, а в sqlite.
type Config struct {
	TelegramToken string
	TelegramAPI   string // база Telegram API; переопределяется в тестах фейком

	MCPURL      string // MCP-эндпоинт tobedone
	ExchangeURL string // обмен кода привязки на токен

	DBPath string // sqlite-файл

	LLMBaseURL string // OpenAI-совместимый endpoint ('' = LLM выключена)
	LLMAPIKey  string
	LLMModel   string

	DailyLimit  int   // LLM-сообщений на юзера в день
	GlobalLimit int   // LLM-сообщений на всех в день (стоп-кран)
	OwnerChatID int64 // кому слать алерты; 0 = никому

	DefaultTZ string // пояс юзера, пока он не сделал /tz
}

func Load() (*Config, error) {
	c := &Config{
		TelegramToken: os.Getenv("TELEGRAM_TOKEN"),
		TelegramAPI:   getEnv("TELEGRAM_API_URL", ""),
		MCPURL:        getEnv("MCP_URL", "http://localhost:8080/mcp"),
		ExchangeURL:   getEnv("EXCHANGE_URL", "http://localhost:8080/api/telegram/exchange"),
		DBPath:        getEnv("BOT_DB", "bot.sqlite"),
		LLMBaseURL:    getEnv("LLM_BASE_URL", ""),
		LLMAPIKey:     os.Getenv("LLM_API_KEY"),
		LLMModel:      getEnv("LLM_MODEL", "deepseek-chat"),
		DailyLimit:    getEnvInt("DAILY_LIMIT", 50),
		GlobalLimit:   getEnvInt("GLOBAL_DAILY_LIMIT", 500),
		DefaultTZ:     getEnv("DEFAULT_TZ", "Europe/Moscow"),
	}
	if v := os.Getenv("OWNER_CHAT_ID"); v != "" {
		id, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("OWNER_CHAT_ID: %w", err)
		}
		c.OwnerChatID = id
	}
	if c.TelegramToken == "" {
		return nil, fmt.Errorf("TELEGRAM_TOKEN обязателен")
	}
	return c, nil
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getEnvInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
