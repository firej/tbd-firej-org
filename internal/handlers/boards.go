package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/evbogdanov/tobedone/internal/models"
	"github.com/google/uuid"
	"github.com/gorilla/mux"
)

// ── List ───────────────────────────────────────────────────────────

// userBoards — доски, где юзер состоит участником, в порядке position.
func (h *Handler) userBoards(uid int64) ([]*models.Board, error) {
	rows, err := h.db.Query(`
		SELECT b.id, b.owner_id, b.name, COALESCE(b.color, ''), b.position, b.created_at, b.updated_at
		FROM boards b
		JOIN board_members m ON m.board_id = b.id
		WHERE m.user_id = ?
		ORDER BY b.position ASC, b.created_at ASC`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]*models.Board, 0, 8)
	for rows.Next() {
		var b models.Board
		if err := rows.Scan(&b.ID, &b.OwnerID, &b.Name, &b.Color, &b.Position, &b.CreatedAt, &b.UpdatedAt); err != nil {
			return nil, err
		}
		b.IsOwner = b.OwnerID == uid
		out = append(out, &b)
	}
	return out, rows.Err()
}

// ListBoards — GET /api/boards: доски, где текущий юзер состоит участником.
func (h *Handler) ListBoards(w http.ResponseWriter, r *http.Request) {
	uid, _ := h.userID(r)
	out, err := h.userBoards(uid)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"boards": out})
}

// ── Create ─────────────────────────────────────────────────────────

type boardPayload struct {
	Name     string   `json:"name"`
	Color    string   `json:"color"`
	Position *float64 `json:"position"`
}

// CreateBoard — POST /api/boards. Создатель становится владельцем и участником.
func (h *Handler) CreateBoard(w http.ResponseWriter, r *http.Request) {
	uid, _ := h.userID(r)

	var p boardPayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeJSONError(w, http.StatusBadRequest, "bad json")
		return
	}
	p.Name = strings.TrimSpace(p.Name)
	if p.Name == "" {
		writeJSONError(w, http.StatusBadRequest, "name required")
		return
	}
	if len([]rune(p.Name)) > 120 {
		p.Name = string([]rune(p.Name)[:120])
	}
	if !models.AllowedColors[p.Color] {
		p.Color = "indigo"
	}

	// Позиция — в конец списка досок текущего юзера.
	var maxPos sql.NullFloat64
	_ = h.db.QueryRow(`
		SELECT MAX(b.position) FROM boards b
		JOIN board_members m ON m.board_id = b.id
		WHERE m.user_id = ?`, uid).Scan(&maxPos)
	pos := 1024.0
	if maxPos.Valid {
		pos = maxPos.Float64 + 1024
	}

	id := uuid.NewString()
	if _, err := h.db.Exec(
		`INSERT INTO boards (id, owner_id, name, color, position) VALUES (?, ?, ?, ?, ?)`,
		id, uid, p.Name, p.Color, pos,
	); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "insert error")
		return
	}
	if _, err := h.db.Exec(
		`INSERT INTO board_members (board_id, user_id) VALUES (?, ?)`, id, uid,
	); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "insert member error")
		return
	}

	b, err := h.getBoard(uid, id)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "fetch error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"board": b})
}

// createDefaultBoard заводит новому пользователю доску «Личное» и делает его участником.
// Вызывается при регистрации, чтобы у юзера сразу была доска.
func (h *Handler) createDefaultBoard(uid int64) error {
	id := uuid.NewString()
	if _, err := h.db.Exec(
		`INSERT INTO boards (id, owner_id, name, color, position) VALUES (?, ?, 'Личное', 'indigo', 1024)`,
		id, uid,
	); err != nil {
		return err
	}
	_, err := h.db.Exec(`INSERT INTO board_members (board_id, user_id) VALUES (?, ?)`, id, uid)
	return err
}

func (h *Handler) getBoard(uid int64, id string) (*models.Board, error) {
	var b models.Board
	err := h.db.QueryRow(`
		SELECT id, owner_id, name, COALESCE(color, ''), position, created_at, updated_at
		FROM boards WHERE id = ?`, id,
	).Scan(&b.ID, &b.OwnerID, &b.Name, &b.Color, &b.Position, &b.CreatedAt, &b.UpdatedAt)
	if err != nil {
		return nil, err
	}
	b.IsOwner = b.OwnerID == uid
	return &b, nil
}

// ── Patch ──────────────────────────────────────────────────────────

// PatchBoard — PATCH /api/boards/{bid}. Только владелец.
func (h *Handler) PatchBoard(w http.ResponseWriter, r *http.Request) {
	uid, _ := h.userID(r)
	bid := mux.Vars(r)["bid"]
	if !h.isOwner(uid, bid) {
		writeJSONError(w, http.StatusForbidden, "только владелец может менять доску")
		return
	}

	var raw map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		writeJSONError(w, http.StatusBadRequest, "bad json")
		return
	}

	sets := []string{}
	args := []interface{}{}
	if v, ok := raw["name"]; ok {
		var s string
		if json.Unmarshal(v, &s) == nil {
			s = strings.TrimSpace(s)
			if s != "" {
				if len([]rune(s)) > 120 {
					s = string([]rune(s)[:120])
				}
				sets = append(sets, "name = ?")
				args = append(args, s)
			}
		}
	}
	if v, ok := raw["color"]; ok {
		var s string
		if json.Unmarshal(v, &s) == nil && models.AllowedColors[s] {
			sets = append(sets, "color = ?")
			args = append(args, s)
		}
	}
	if v, ok := raw["position"]; ok {
		var f float64
		if json.Unmarshal(v, &f) == nil {
			sets = append(sets, "position = ?")
			args = append(args, f)
		}
	}
	if len(sets) == 0 {
		writeJSONError(w, http.StatusBadRequest, "no fields to update")
		return
	}

	args = append(args, bid)
	q := "UPDATE boards SET " + strings.Join(sets, ", ") + " WHERE id = ?"
	if _, err := h.db.Exec(q, args...); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "update error")
		return
	}

	b, err := h.getBoard(uid, bid)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "fetch error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"board": b})
}

// ── Delete ─────────────────────────────────────────────────────────

// DeleteBoard — DELETE /api/boards/{bid}. Только владелец.
// Нельзя удалить, если это единственная доступная юзеру доска (чтобы не остаться без досок).
func (h *Handler) DeleteBoard(w http.ResponseWriter, r *http.Request) {
	uid, _ := h.userID(r)
	bid := mux.Vars(r)["bid"]
	if !h.isOwner(uid, bid) {
		writeJSONError(w, http.StatusForbidden, "только владелец может удалить доску")
		return
	}

	var count int
	_ = h.db.QueryRow("SELECT COUNT(*) FROM board_members WHERE user_id = ?", uid).Scan(&count)
	if count <= 1 {
		writeJSONError(w, http.StatusBadRequest, "нельзя удалить последнюю доску")
		return
	}

	if _, err := h.db.Exec("DELETE FROM boards WHERE id = ?", bid); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "delete error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── Members ────────────────────────────────────────────────────────

// ListMembers — GET /api/boards/{bid}/members.
func (h *Handler) ListMembers(w http.ResponseWriter, r *http.Request) {
	bid := mux.Vars(r)["bid"]
	rows, err := h.db.Query(`
		SELECT u.id, u.email, u.display_name, COALESCE(u.avatar_color, ''), (u.id = b.owner_id)
		FROM board_members m
		JOIN users u ON u.id = m.user_id
		JOIN boards b ON b.id = m.board_id
		WHERE m.board_id = ?
		ORDER BY (u.id = b.owner_id) DESC, u.display_name ASC`, bid)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()

	out := make([]models.BoardMember, 0, 4)
	for rows.Next() {
		var m models.BoardMember
		if err := rows.Scan(&m.UserID, &m.Email, &m.DisplayName, &m.AvatarColor, &m.IsOwner); err != nil {
			writeJSONError(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, m)
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"members": out})
}

type addMemberPayload struct {
	Email string `json:"email"`
}

// AddMember — POST /api/boards/{bid}/members {email}. Только владелец.
func (h *Handler) AddMember(w http.ResponseWriter, r *http.Request) {
	uid, _ := h.userID(r)
	bid := mux.Vars(r)["bid"]
	if !h.isOwner(uid, bid) {
		writeJSONError(w, http.StatusForbidden, "только владелец может добавлять участников")
		return
	}

	var p addMemberPayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeJSONError(w, http.StatusBadRequest, "bad json")
		return
	}
	email := strings.ToLower(strings.TrimSpace(p.Email))
	if email == "" {
		writeJSONError(w, http.StatusBadRequest, "email обязателен")
		return
	}

	var memberID int64
	err := h.db.QueryRow("SELECT id FROM users WHERE email = ?", email).Scan(&memberID)
	if err == sql.ErrNoRows {
		writeJSONError(w, http.StatusNotFound, "пользователь с таким email не найден")
		return
	}
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "db error")
		return
	}
	if memberID == uid {
		// владелец и так участник — ничего не делаем
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if h.isMember(memberID, bid) {
		writeJSONError(w, http.StatusConflict, "пользователь уже участник доски")
		return
	}

	if _, err := h.db.Exec(
		"INSERT INTO board_members (board_id, user_id) VALUES (?, ?)", bid, memberID,
	); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "insert error")
		return
	}

	var m models.BoardMember
	_ = h.db.QueryRow(
		"SELECT id, email, display_name, COALESCE(avatar_color, '') FROM users WHERE id = ?", memberID,
	).Scan(&m.UserID, &m.Email, &m.DisplayName, &m.AvatarColor)
	writeJSON(w, http.StatusOK, map[string]interface{}{"member": m})
}

// RemoveMember — DELETE /api/boards/{bid}/members/{uid}.
// Владелец может убрать любого участника (кроме себя); участник может выйти сам.
func (h *Handler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	uid, _ := h.userID(r)
	bid := mux.Vars(r)["bid"]
	targetID, err := strconv.ParseInt(mux.Vars(r)["uid"], 10, 64)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "bad user id")
		return
	}

	owner := h.isOwner(uid, bid)
	if h.isOwner(targetID, bid) {
		writeJSONError(w, http.StatusBadRequest, "нельзя убрать владельца доски")
		return
	}
	// owner убирает кого угодно; обычный участник — только себя
	if !owner && targetID != uid {
		writeJSONError(w, http.StatusForbidden, "нет прав убрать этого участника")
		return
	}

	if _, err := h.db.Exec(
		"DELETE FROM board_members WHERE board_id = ? AND user_id = ?", bid, targetID,
	); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "delete error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
