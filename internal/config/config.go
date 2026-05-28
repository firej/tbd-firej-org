package config

import "os"

// Config — конфигурация приложения, читается из ENV.
type Config struct {
	Port          string
	DatabaseDSN   string
	SessionSecret string
	SecureCookie  bool
}

func Load() *Config {
	return &Config{
		Port:          getEnv("PORT", "8080"),
		DatabaseDSN:   getEnv("DATABASE_DSN", "tobedone:tobedone@tcp(localhost:3306)/tobedone?parseTime=true&charset=utf8mb4"),
		SessionSecret: getEnv("SESSION_SECRET", "change-me-in-production"),
		SecureCookie:  getEnv("SECURE_COOKIE", "false") == "true",
	}
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
