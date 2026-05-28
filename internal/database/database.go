package database

import (
	"database/sql"
	"fmt"
)

// InitDB создаёт таблицы users и tasks, добавляет индексы.
// MariaDB не любит несколько CREATE TABLE в одном Exec — выполняем по одному.
func InitDB(db *sql.DB) error {
	tables := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id BIGINT PRIMARY KEY AUTO_INCREMENT,
			email VARCHAR(255) UNIQUE NOT NULL,
			password_hash VARCHAR(255) NOT NULL,
			display_name VARCHAR(255) NOT NULL,
			avatar_color VARCHAR(16),
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

		`CREATE TABLE IF NOT EXISTS tasks (
			id CHAR(36) PRIMARY KEY,
			user_id BIGINT NOT NULL,
			title VARCHAR(500) NOT NULL,
			note TEXT,
			color VARCHAR(16) NOT NULL DEFAULT 'indigo',
			size VARCHAR(8) NOT NULL DEFAULT 's',
			tag VARCHAR(64),
			done TINYINT NOT NULL DEFAULT 0,
			position DOUBLE NOT NULL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			due_at DATETIME NULL,
			completed_at DATETIME NULL,
			sub JSON NULL,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
	}

	for _, sqlStmt := range tables {
		if _, err := db.Exec(sqlStmt); err != nil {
			return fmt.Errorf("create table: %w", err)
		}
	}

	indexes := []string{
		`CREATE INDEX IF NOT EXISTS idx_tasks_user_pos ON tasks (user_id, position)`,
		`CREATE INDEX IF NOT EXISTS idx_tasks_user_updated ON tasks (user_id, updated_at)`,
	}
	for _, idx := range indexes {
		db.Exec(idx) // игнорируем ошибки — индекс уже мог существовать
	}

	return nil
}
