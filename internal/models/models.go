package models

import "time"

// User — пользователь.
type User struct {
	ID           int64     `json:"id"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	DisplayName  string    `json:"display_name"`
	AvatarColor  string    `json:"avatar_color"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// Board — доска (пространство). Задачи принадлежат доске, доступ — через board_members.
type Board struct {
	ID        string        `json:"id"`
	OwnerID   int64         `json:"-"`
	Name      string        `json:"name"`
	Color     string        `json:"color"`
	Position  float64       `json:"position"`
	CreatedAt time.Time     `json:"created_at"`
	UpdatedAt time.Time     `json:"updated_at"`
	IsOwner   bool          `json:"is_owner"`          // вычисляемое: текущий юзер — владелец
	Members   []BoardMember `json:"members,omitempty"` // заполняется по запросу
}

// BoardMember — участник доски (для UI шаринга).
type BoardMember struct {
	UserID      int64  `json:"user_id"`
	Email       string `json:"email"`
	DisplayName string `json:"display_name"`
	AvatarColor string `json:"avatar_color"`
	IsOwner     bool   `json:"is_owner"`
}

// Task — задача.
// Поля Color/Size — enum-строки; валидация в хендлерах.
// Sub хранится в БД как JSON-колонка, в Go — []SubTask.
type Task struct {
	ID          string     `json:"id"`
	UserID      int64      `json:"-"`
	BoardID     string     `json:"board_id"`
	Title       string     `json:"title"`
	Note        string     `json:"note,omitempty"`
	Color       string     `json:"color"`
	Size        string     `json:"size"`
	Tag         string     `json:"tag,omitempty"`
	Done        bool       `json:"done"`
	Position    float64    `json:"position"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	DueAt       *time.Time `json:"due_at"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
	Sub         []SubTask  `json:"sub,omitempty"`
	Repeat      string     `json:"repeat,omitempty"` // '' | daily | weekly | monthly | yearly
}

type SubTask struct {
	ID   string `json:"id"`
	Text string `json:"text"`
	Done bool   `json:"done"`
}

// APIToken — токен программного доступа (MCP, боты). Хэш наружу не отдаём;
// поле Token заполняется только в ответе на создание.
type APIToken struct {
	ID         int64      `json:"id"`
	UserID     int64      `json:"-"`
	Name       string     `json:"name"`
	Token      string     `json:"token,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	LastUsedAt *time.Time `json:"last_used_at"`
}

// AllowedColors / AllowedSizes — для валидации входящих данных.
var AllowedColors = map[string]bool{
	"terra": true, "indigo": true, "olive": true, "mustard": true, "rose": true, "clay": true,
}

var AllowedSizes = map[string]bool{
	"s": true, "m": true, "wide": true, "l": true,
}

var AllowedRepeats = map[string]bool{
	"daily": true, "weekly": true, "monthly": true, "yearly": true,
}
