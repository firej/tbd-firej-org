package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/evbogdanov/tobedone/internal/models"
	"github.com/google/uuid"
	"github.com/gorilla/mux"
)

// ── helpers ────────────────────────────────────────────────────────

// scanTask читает строку tasks в models.Task. Колонка sub лежит как JSON.
func scanTask(scanner interface {
	Scan(dest ...interface{}) error
}) (*models.Task, error) {
	var (
		t       models.Task
		boardID sql.NullString
		note    sql.NullString
		tag     sql.NullString
		dueAt   sql.NullTime
		compAt  sql.NullTime
		subRaw  sql.NullString
		recur   sql.NullString
		doneInt int
	)
	err := scanner.Scan(
		&t.ID, &t.UserID, &boardID, &t.Title, &note, &t.Color, &t.Size, &tag,
		&doneInt, &t.Position, &t.CreatedAt, &t.UpdatedAt, &dueAt, &compAt, &subRaw, &recur,
	)
	if err != nil {
		return nil, err
	}
	if boardID.Valid {
		t.BoardID = boardID.String
	}
	if note.Valid {
		t.Note = note.String
	}
	if tag.Valid {
		t.Tag = tag.String
	}
	t.Done = doneInt != 0
	if dueAt.Valid {
		t.DueAt = &dueAt.Time
	}
	if compAt.Valid {
		t.CompletedAt = &compAt.Time
	}
	if subRaw.Valid && subRaw.String != "" {
		_ = json.Unmarshal([]byte(subRaw.String), &t.Sub)
	}
	if recur.Valid {
		t.Repeat = recur.String
	}
	return &t, nil
}

const taskSelectCols = `
	id, user_id, board_id, title, note, color, size, tag,
	done, position, created_at, updated_at, due_at, completed_at, sub, recurrence
`

// nextOccurrence — следующее наступление повторяющейся задачи строго позже now.
// База — текущий due_at (или now, если срока не было); шагаем, пока не уйдём в будущее.
func nextOccurrence(due *time.Time, repeat string, now time.Time) time.Time {
	base := now
	if due != nil {
		base = *due
	}
	step := func(t time.Time) time.Time {
		switch repeat {
		case "daily":
			return t.AddDate(0, 0, 1)
		case "weekly":
			return t.AddDate(0, 0, 7)
		case "monthly":
			return t.AddDate(0, 1, 0)
		default: // yearly
			return t.AddDate(1, 0, 0)
		}
	}
	next := step(base)
	for !next.After(now) {
		next = step(next)
	}
	return next
}

// ── List ───────────────────────────────────────────────────────────

func (h *Handler) ListTasks(w http.ResponseWriter, r *http.Request) {
	bid := mux.Vars(r)["bid"]
	rows, err := h.db.Query(
		`SELECT `+taskSelectCols+` FROM tasks WHERE board_id = ? AND deleted_at IS NULL ORDER BY position ASC`, bid,
	)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()

	out := make([]*models.Task, 0, 32)
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, t)
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"tasks": out})
}

// ── Create ─────────────────────────────────────────────────────────

type createTaskPayload struct {
	Title    string     `json:"title"`
	Note     string     `json:"note"`
	Color    string     `json:"color"`
	Size     string     `json:"size"`
	Tag      string     `json:"tag"`
	DueAt    *time.Time `json:"due_at"`
	Position *float64   `json:"position"`
	Repeat   string     `json:"repeat"`
}

func (h *Handler) CreateTask(w http.ResponseWriter, r *http.Request) {
	uid, _ := h.userID(r)
	bid := mux.Vars(r)["bid"]

	var p createTaskPayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeJSONError(w, http.StatusBadRequest, "bad json")
		return
	}
	p.Title = strings.TrimSpace(p.Title)
	if p.Title == "" {
		writeJSONError(w, http.StatusBadRequest, "title required")
		return
	}
	if !models.AllowedColors[p.Color] {
		p.Color = "indigo"
	}
	if !models.AllowedSizes[p.Size] {
		p.Size = "s"
	}
	if p.Repeat != "" && !models.AllowedRepeats[p.Repeat] {
		p.Repeat = ""
	}

	// Если позиция не задана — кладём в начало (минимальная позиция - 1).
	var pos float64
	if p.Position != nil {
		pos = *p.Position
	} else {
		var minPos sql.NullFloat64
		_ = h.db.QueryRow("SELECT MIN(position) FROM tasks WHERE board_id = ? AND deleted_at IS NULL", bid).Scan(&minPos)
		if minPos.Valid {
			pos = minPos.Float64 - 1024
		} else {
			pos = 1024
		}
	}

	id := uuid.NewString()

	var dueAt interface{}
	if p.DueAt != nil {
		dueAt = *p.DueAt
	}
	var tagVal interface{}
	if p.Tag != "" {
		tagVal = p.Tag
	}
	var noteVal interface{}
	if p.Note != "" {
		noteVal = p.Note
	}

	_, err := h.db.Exec(`
		INSERT INTO tasks (id, user_id, board_id, title, note, color, size, tag, done, position, due_at, recurrence)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
		id, uid, bid, p.Title, noteVal, p.Color, p.Size, tagVal, pos, dueAt, nullIfEmpty(p.Repeat),
	)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "insert error")
		return
	}

	t, err := h.getTask(bid, id)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "fetch error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"task": t})
}

func (h *Handler) getTask(bid, id string) (*models.Task, error) {
	row := h.db.QueryRow(
		`SELECT `+taskSelectCols+` FROM tasks WHERE board_id = ? AND id = ? AND deleted_at IS NULL`, bid, id,
	)
	return scanTask(row)
}

// ── Patch ──────────────────────────────────────────────────────────

func (h *Handler) PatchTask(w http.ResponseWriter, r *http.Request) {
	bid := mux.Vars(r)["bid"]
	id := mux.Vars(r)["id"]

	var raw map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		writeJSONError(w, http.StatusBadRequest, "bad json")
		return
	}

	// Аккумулируем динамический SQL.
	sets := []string{}
	args := []interface{}{}

	// Завершение повторяющейся задачи — не done, а перенос на следующий раз:
	// due_at уезжает вперёд, задача остаётся открытой.
	if v, ok := raw["done"]; ok {
		var b bool
		if json.Unmarshal(v, &b) == nil && b {
			if t, err := h.getTask(bid, id); err == nil && t.Repeat != "" {
				delete(raw, "done")
				sets = append(sets, "due_at = ?", "done = 0", "completed_at = NULL")
				args = append(args, nextOccurrence(t.DueAt, t.Repeat, time.Now().UTC()))
			}
		}
	}

	setStr := func(key, col string, validate func(string) bool) {
		if v, ok := raw[key]; ok {
			var s string
			if err := json.Unmarshal(v, &s); err == nil {
				if validate == nil || validate(s) {
					sets = append(sets, col+" = ?")
					var arg interface{} = s
					if s == "" && (col == "note" || col == "tag" || col == "recurrence") {
						arg = nil
					}
					args = append(args, arg)
				}
			}
		}
	}
	setBool := func(key, col string) {
		if v, ok := raw[key]; ok {
			var b bool
			if err := json.Unmarshal(v, &b); err == nil {
				sets = append(sets, col+" = ?")
				if b {
					args = append(args, 1)
				} else {
					args = append(args, 0)
				}
				if col == "done" {
					if b {
						sets = append(sets, "completed_at = CURRENT_TIMESTAMP")
					} else {
						sets = append(sets, "completed_at = NULL")
					}
				}
			}
		}
	}
	setFloat := func(key, col string) {
		if v, ok := raw[key]; ok {
			var f float64
			if err := json.Unmarshal(v, &f); err == nil {
				sets = append(sets, col+" = ?")
				args = append(args, f)
			}
		}
	}
	setTime := func(key, col string) {
		if v, ok := raw[key]; ok {
			// либо null, либо ISO-строка
			if string(v) == "null" {
				sets = append(sets, col+" = NULL")
				return
			}
			var t time.Time
			if err := json.Unmarshal(v, &t); err == nil {
				sets = append(sets, col+" = ?")
				args = append(args, t)
			}
		}
	}

	setStr("title", "title", nil)
	setStr("note", "note", nil)
	setStr("color", "color", func(s string) bool { return models.AllowedColors[s] })
	setStr("size", "size", func(s string) bool { return models.AllowedSizes[s] })
	setStr("tag", "tag", nil)
	setStr("repeat", "recurrence", func(s string) bool { return s == "" || models.AllowedRepeats[s] })
	setBool("done", "done")
	setFloat("position", "position")
	setTime("due_at", "due_at")

	if v, ok := raw["sub"]; ok {
		sets = append(sets, "sub = ?")
		args = append(args, string(v))
	}

	if len(sets) == 0 {
		writeJSONError(w, http.StatusBadRequest, "no fields to update")
		return
	}

	args = append(args, bid, id)
	q := "UPDATE tasks SET " + strings.Join(sets, ", ") + " WHERE board_id = ? AND id = ? AND deleted_at IS NULL"
	if _, err := h.db.Exec(q, args...); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "update error")
		return
	}

	// «Не найдено» определяем по самой строке, а не по RowsAffected: MariaDB
	// считает изменённой только строку с реально другими значениями, поэтому
	// повторный PATCH тем же значением (частый случай на общей доске, где
	// карточку уже закрыл другой участник) давал ложную 404.
	t, err := h.getTask(bid, id)
	if err == sql.ErrNoRows {
		writeJSONError(w, http.StatusNotFound, "task not found")
		return
	}
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "fetch error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"task": t})
}

// ── Delete ─────────────────────────────────────────────────────────

// DeleteTask — мягкое удаление: строка остаётся в БД с deleted_at (архив),
// чтобы карточку можно было восстановить (deleted_at = NULL).
func (h *Handler) DeleteTask(w http.ResponseWriter, r *http.Request) {
	bid := mux.Vars(r)["bid"]
	id := mux.Vars(r)["id"]
	if _, err := h.db.Exec(
		"UPDATE tasks SET deleted_at = CURRENT_TIMESTAMP WHERE board_id = ? AND id = ? AND deleted_at IS NULL",
		bid, id,
	); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "delete error")
		return
	}

	// Идемпотентно: если карточку уже заархивировал другой участник, это не
	// ошибка. 404 отдаём только когда такой задачи на доске нет вовсе.
	var exists int
	err := h.db.QueryRow(
		"SELECT 1 FROM tasks WHERE board_id = ? AND id = ?", bid, id,
	).Scan(&exists)
	if err == sql.ErrNoRows {
		writeJSONError(w, http.StatusNotFound, "task not found")
		return
	}
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "delete error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── Reorder: серверный пересчёт position между двумя соседями ──────

type reorderPayload struct {
	Before string `json:"before"` // id того, ПЕРЕД которым встаём
	After  string `json:"after"`  // id того, ПОСЛЕ которого встаём
}

// posOrErr возвращает позицию задачи или sql.ErrNoRows.
// Архивные задачи якорями не считаются.
func (h *Handler) posOf(bid, id string) (float64, error) {
	var p float64
	err := h.db.QueryRow(
		"SELECT position FROM tasks WHERE board_id = ? AND id = ? AND deleted_at IS NULL", bid, id,
	).Scan(&p)
	return p, err
}

func (h *Handler) ReorderTask(w http.ResponseWriter, r *http.Request) {
	bid := mux.Vars(r)["bid"]
	id := mux.Vars(r)["id"]

	var p reorderPayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeJSONError(w, http.StatusBadRequest, "bad json")
		return
	}
	if p.Before == "" && p.After == "" {
		writeJSONError(w, http.StatusBadRequest, "before or after required")
		return
	}

	var newPos float64
	switch {
	case p.Before != "" && p.After != "":
		a, errA := h.posOf(bid, p.After)
		b, errB := h.posOf(bid, p.Before)
		if errA != nil || errB != nil {
			writeJSONError(w, http.StatusBadRequest, "anchor not found")
			return
		}
		newPos = (a + b) / 2.0
	case p.Before != "":
		// встать перед `before` — берём середину между его соседом сверху и им
		b, err := h.posOf(bid, p.Before)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "before not found")
			return
		}
		var prevPos sql.NullFloat64
		_ = h.db.QueryRow(
			"SELECT MAX(position) FROM tasks WHERE board_id = ? AND position < ? AND id != ? AND deleted_at IS NULL",
			bid, b, id,
		).Scan(&prevPos)
		if prevPos.Valid {
			newPos = (prevPos.Float64 + b) / 2.0
		} else {
			newPos = b - 1024
		}
	case p.After != "":
		a, err := h.posOf(bid, p.After)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "after not found")
			return
		}
		var nextPos sql.NullFloat64
		_ = h.db.QueryRow(
			"SELECT MIN(position) FROM tasks WHERE board_id = ? AND position > ? AND id != ? AND deleted_at IS NULL",
			bid, a, id,
		).Scan(&nextPos)
		if nextPos.Valid {
			newPos = (a + nextPos.Float64) / 2.0
		} else {
			newPos = a + 1024
		}
	}

	if _, err := h.db.Exec(
		"UPDATE tasks SET position = ? WHERE board_id = ? AND id = ?",
		newPos, bid, id,
	); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "update error")
		return
	}

	t, _ := h.getTask(bid, id)
	writeJSON(w, http.StatusOK, map[string]interface{}{"task": t})
}

// ── Sync: bulk pull + push ─────────────────────────────────────────

type syncChange struct {
	Op   string       `json:"op"`             // upsert | delete
	ID   string       `json:"id,omitempty"`   // для delete
	Task *models.Task `json:"task,omitempty"` // для upsert
}

type syncRequest struct {
	Since   *time.Time   `json:"since,omitempty"`
	Changes []syncChange `json:"changes"`
}

type syncResponse struct {
	ServerChanges []syncChange `json:"server_changes"`
	ServerTime    time.Time    `json:"server_time"`
	Conflicts     []string     `json:"conflicts"`
}

func (h *Handler) Sync(w http.ResponseWriter, r *http.Request) {
	uid, _ := h.userID(r)
	bid := mux.Vars(r)["bid"]

	var req syncRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "bad json")
		return
	}

	// 1) Применяем клиентские изменения (LWW по updated_at).
	for _, ch := range req.Changes {
		switch ch.Op {
		case "delete":
			if ch.ID != "" {
				// мягкое удаление — как и в DeleteTask
				h.db.Exec(
					"UPDATE tasks SET deleted_at = CURRENT_TIMESTAMP WHERE board_id = ? AND id = ? AND deleted_at IS NULL",
					bid, ch.ID,
				)
			}
		case "upsert":
			if ch.Task == nil || ch.Task.ID == "" {
				continue
			}
			t := ch.Task
			if !models.AllowedColors[t.Color] {
				t.Color = "indigo"
			}
			if !models.AllowedSizes[t.Size] {
				t.Size = "s"
			}
			if t.Repeat != "" && !models.AllowedRepeats[t.Repeat] {
				t.Repeat = ""
			}
			// existing updated_at для LWW
			var existingUpdated sql.NullTime
			h.db.QueryRow(
				"SELECT updated_at FROM tasks WHERE board_id = ? AND id = ?", bid, t.ID,
			).Scan(&existingUpdated)
			clientUpdated := t.UpdatedAt
			if existingUpdated.Valid && !clientUpdated.IsZero() && clientUpdated.Before(existingUpdated.Time) {
				// сервер свежее — пропускаем
				continue
			}
			subJSON, _ := json.Marshal(t.Sub)
			var dueAt interface{}
			if t.DueAt != nil {
				dueAt = *t.DueAt
			}
			doneInt := 0
			if t.Done {
				doneInt = 1
			}
			h.db.Exec(`
				INSERT INTO tasks (id, user_id, board_id, title, note, color, size, tag, done, position, due_at, sub, recurrence)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON DUPLICATE KEY UPDATE
				  title=VALUES(title), note=VALUES(note), color=VALUES(color), size=VALUES(size),
				  tag=VALUES(tag), done=VALUES(done), position=VALUES(position),
				  due_at=VALUES(due_at), sub=VALUES(sub), recurrence=VALUES(recurrence)
			`, t.ID, uid, bid, t.Title, nullIfEmpty(t.Note), t.Color, t.Size, nullIfEmpty(t.Tag),
				doneInt, t.Position, dueAt, string(subJSON), nullIfEmpty(t.Repeat))
		}
	}

	// 2) Собираем серверные изменения с момента since. Живые — upsert,
	// архивированные (deleted_at) при инкрементальном пулле — delete.
	now := time.Now().UTC()
	var rows *sql.Rows
	var err error
	if req.Since != nil {
		rows, err = h.db.Query(
			`SELECT `+taskSelectCols+` FROM tasks
			 WHERE board_id = ? AND updated_at >= ? AND deleted_at IS NULL ORDER BY position ASC`,
			bid, *req.Since,
		)
	} else {
		rows, err = h.db.Query(
			`SELECT `+taskSelectCols+` FROM tasks
			 WHERE board_id = ? AND deleted_at IS NULL ORDER BY position ASC`, bid,
		)
	}
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()

	out := syncResponse{ServerTime: now, ServerChanges: []syncChange{}, Conflicts: []string{}}
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			continue
		}
		out.ServerChanges = append(out.ServerChanges, syncChange{Op: "upsert", Task: t})
	}

	if req.Since != nil {
		delRows, err := h.db.Query(
			`SELECT id FROM tasks WHERE board_id = ? AND deleted_at IS NOT NULL AND updated_at >= ?`,
			bid, *req.Since,
		)
		if err == nil {
			defer delRows.Close()
			for delRows.Next() {
				var id string
				if delRows.Scan(&id) == nil {
					out.ServerChanges = append(out.ServerChanges, syncChange{Op: "delete", ID: id})
				}
			}
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func nullIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
