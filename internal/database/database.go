package database

import (
	"database/sql"
	"fmt"

	"github.com/google/uuid"
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

		`CREATE TABLE IF NOT EXISTS boards (
			id CHAR(36) PRIMARY KEY,
			owner_id BIGINT NOT NULL,
			name VARCHAR(120) NOT NULL,
			color VARCHAR(16),
			position DOUBLE NOT NULL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

		`CREATE TABLE IF NOT EXISTS board_members (
			board_id CHAR(36) NOT NULL,
			user_id BIGINT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (board_id, user_id),
			FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
			deleted_at DATETIME NULL,
			sub JSON NULL,
			recurrence VARCHAR(16) NULL,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
	}

	for _, sqlStmt := range tables {
		if _, err := db.Exec(sqlStmt); err != nil {
			return fmt.Errorf("create table: %w", err)
		}
	}

	// Миграции для уже существующих БД (MariaDB поддерживает IF NOT EXISTS).
	// Колонка называется recurrence — `repeat` в MariaDB зарезервированное слово.
	migrations := []string{
		`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence VARCHAR(16) NULL AFTER sub`,
		`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS board_id CHAR(36) NULL AFTER user_id`,
		// мягкое удаление: карточка не стирается, а архивируется — на случай восстановления
		`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL AFTER completed_at`,
	}
	for _, m := range migrations {
		if _, err := db.Exec(m); err != nil {
			return fmt.Errorf("migrate: %w", err)
		}
	}

	if err := migrateDefaultBoards(db); err != nil {
		return fmt.Errorf("migrate boards: %w", err)
	}

	indexes := []string{
		`CREATE INDEX IF NOT EXISTS idx_tasks_user_pos ON tasks (user_id, position)`,
		`CREATE INDEX IF NOT EXISTS idx_tasks_user_updated ON tasks (user_id, updated_at)`,
		`CREATE INDEX IF NOT EXISTS idx_tasks_board_pos ON tasks (board_id, position)`,
		`CREATE INDEX IF NOT EXISTS idx_tasks_board_updated ON tasks (board_id, updated_at)`,
	}
	for _, idx := range indexes {
		db.Exec(idx) // игнорируем ошибки — индекс уже мог существовать
	}

	return nil
}

// migrateDefaultBoards заводит у каждого пользователя без собственной доски
// дефолтную доску «Личное» и переносит туда все его «бездомные» задачи
// (board_id IS NULL). Идемпотентна — повторный вызов ничего не делает.
func migrateDefaultBoards(db *sql.DB) error {
	rows, err := db.Query(`
		SELECT u.id FROM users u
		WHERE NOT EXISTS (SELECT 1 FROM boards b WHERE b.owner_id = u.id)`)
	if err != nil {
		return err
	}
	defer rows.Close()

	var userIDs []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return err
		}
		userIDs = append(userIDs, id)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, uid := range userIDs {
		boardID := uuid.NewString()
		if _, err := db.Exec(
			`INSERT INTO boards (id, owner_id, name, color, position) VALUES (?, ?, 'Личное', 'indigo', 1024)`,
			boardID, uid,
		); err != nil {
			return err
		}
		if _, err := db.Exec(
			`INSERT INTO board_members (board_id, user_id) VALUES (?, ?)`, boardID, uid,
		); err != nil {
			return err
		}
		if _, err := db.Exec(
			`UPDATE tasks SET board_id = ? WHERE user_id = ? AND board_id IS NULL`, boardID, uid,
		); err != nil {
			return err
		}
	}
	return nil
}
