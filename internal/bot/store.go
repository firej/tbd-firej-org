package bot

import (
	"database/sql"
	"errors"
	"fmt"

	_ "modernc.org/sqlite"
)

// Store — sqlite-хранилище бота: привязки, offset апдейтов, счётчики лимитов.
// Драйвер modernc.org/sqlite — чистый Go, CGO не нужен.
type Store struct {
	db *sql.DB
}

func OpenStore(path string) (*Store, error) {
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		return nil, err
	}
	// sqlite не любит конкурентные писатели — сериализуем на уровне пула.
	db.SetMaxOpenConns(1)

	schema := []string{
		`CREATE TABLE IF NOT EXISTS links (
			chat_id INTEGER PRIMARY KEY,
			token TEXT NOT NULL,
			display_name TEXT NOT NULL DEFAULT '',
			tz TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		)`,
		`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS usage (
			chat_id INTEGER NOT NULL,
			day TEXT NOT NULL,
			n INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (chat_id, day)
		)`,
	}
	for _, q := range schema {
		if _, err := db.Exec(q); err != nil {
			return nil, fmt.Errorf("schema: %w", err)
		}
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

// ── привязки ───────────────────────────────────────────────────────

type Link struct {
	ChatID      int64
	Token       string
	DisplayName string
	TZ          string
}

func (s *Store) SaveLink(l Link) error {
	_, err := s.db.Exec(`
		INSERT INTO links (chat_id, token, display_name, tz) VALUES (?, ?, ?, ?)
		ON CONFLICT(chat_id) DO UPDATE SET token=excluded.token, display_name=excluded.display_name`,
		l.ChatID, l.Token, l.DisplayName, l.TZ)
	return err
}

// GetLink возвращает привязку чата. nil без ошибки — чат не привязан;
// ошибка — база недоступна (это НЕ то же самое: путать их нельзя, иначе
// при блокировке sqlite бот скажет привязанному юзеру «привяжись заново»).
func (s *Store) GetLink(chatID int64) (*Link, error) {
	l := Link{ChatID: chatID}
	err := s.db.QueryRow(
		"SELECT token, display_name, tz FROM links WHERE chat_id = ?", chatID,
	).Scan(&l.Token, &l.DisplayName, &l.TZ)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &l, nil
}

func (s *Store) DeleteLink(chatID int64) error {
	_, err := s.db.Exec("DELETE FROM links WHERE chat_id = ?", chatID)
	return err
}

func (s *Store) SetTZ(chatID int64, tz string) error {
	_, err := s.db.Exec("UPDATE links SET tz = ? WHERE chat_id = ?", tz, chatID)
	return err
}

func (s *Store) CountLinks() int {
	var n int
	_ = s.db.QueryRow("SELECT COUNT(*) FROM links").Scan(&n)
	return n
}

// ── offset апдейтов (at-most-once) ─────────────────────────────────

func (s *Store) LastUpdateID() int64 {
	var v int64
	_ = s.db.QueryRow("SELECT v FROM meta WHERE k = 'last_update_id'").Scan(&v)
	return v
}

func (s *Store) SetLastUpdateID(id int64) error {
	_, err := s.db.Exec(
		"INSERT INTO meta (k, v) VALUES ('last_update_id', ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", id)
	return err
}

// ── лимиты LLM ─────────────────────────────────────────────────────

// IncUsage увеличивает дневной счётчик чата и возвращает новое значение.
func (s *Store) IncUsage(chatID int64, day string) (int, error) {
	_, err := s.db.Exec(`
		INSERT INTO usage (chat_id, day, n) VALUES (?, ?, 1)
		ON CONFLICT(chat_id, day) DO UPDATE SET n = n + 1`, chatID, day)
	if err != nil {
		return 0, err
	}
	var n int
	err = s.db.QueryRow("SELECT n FROM usage WHERE chat_id = ? AND day = ?", chatID, day).Scan(&n)
	return n, err
}

func (s *Store) UsageTotal(day string) int {
	var n int
	_ = s.db.QueryRow("SELECT COALESCE(SUM(n), 0) FROM usage WHERE day = ?", day).Scan(&n)
	return n
}

// MetaFlag — одноразовые отметки вида «алерт за сегодня уже отправлен».
func (s *Store) MetaFlag(key string) bool {
	var v string
	return s.db.QueryRow("SELECT v FROM meta WHERE k = ?", key).Scan(&v) == nil
}

func (s *Store) SetMetaFlag(key string) {
	_, _ = s.db.Exec("INSERT OR IGNORE INTO meta (k, v) VALUES (?, '1')", key)
}
