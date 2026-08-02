package handlers

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/evbogdanov/tobedone/internal/models"
	"github.com/gorilla/mux"
)

// ── API-токены для программного доступа (MCP, боты) ────────────────
//
// Токен выглядит как tbd_<48 hex-символов>. В БД лежит только SHA-256,
// поэтому показать токен можно ровно один раз — при создании.

func newAPIToken() (token, hash string) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		panic(err) // crypto/rand не отдаёт ошибку на здоровой системе
	}
	token = "tbd_" + hex.EncodeToString(buf)
	return token, hashToken(token)
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// userIDFromBearer — авторизация по заголовку Authorization: Bearer tbd_...
// Возвращает владельца токена; попутно отмечает last_used_at.
func (h *Handler) userIDFromBearer(r *http.Request) (int64, bool) {
	auth := r.Header.Get("Authorization")
	token, ok := strings.CutPrefix(auth, "Bearer ")
	if !ok {
		return 0, false
	}
	token = strings.TrimSpace(token)
	if !strings.HasPrefix(token, "tbd_") {
		return 0, false
	}
	var uid int64
	err := h.db.QueryRow(
		"SELECT user_id FROM api_tokens WHERE token_hash = ?", hashToken(token),
	).Scan(&uid)
	if err != nil {
		return 0, false
	}
	_, _ = h.db.Exec("UPDATE api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE token_hash = ?", hashToken(token))
	return uid, true
}

// ── CRUD ───────────────────────────────────────────────────────────

type createTokenPayload struct {
	Name string `json:"name"`
}

// CreateToken — POST /api/tokens {name}. Единственное место, где токен
// возвращается в открытом виде.
func (h *Handler) CreateToken(w http.ResponseWriter, r *http.Request) {
	uid, _ := h.userID(r)

	var p createTokenPayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeJSONError(w, http.StatusBadRequest, "bad json")
		return
	}
	p.Name = strings.TrimSpace(p.Name)
	if p.Name == "" {
		p.Name = "token"
	}
	if len([]rune(p.Name)) > 120 {
		p.Name = string([]rune(p.Name)[:120])
	}

	token, hash := newAPIToken()
	res, err := h.db.Exec(
		"INSERT INTO api_tokens (user_id, name, token_hash) VALUES (?, ?, ?)",
		uid, p.Name, hash,
	)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "insert error")
		return
	}
	id, _ := res.LastInsertId()

	t := models.APIToken{ID: id, Name: p.Name, Token: token}
	_ = h.db.QueryRow("SELECT created_at FROM api_tokens WHERE id = ?", id).Scan(&t.CreatedAt)
	writeJSON(w, http.StatusOK, map[string]interface{}{"token": t})
}

// ListTokens — GET /api/tokens. Без самих токенов, только метаданные.
func (h *Handler) ListTokens(w http.ResponseWriter, r *http.Request) {
	uid, _ := h.userID(r)
	rows, err := h.db.Query(`
		SELECT id, name, created_at, last_used_at
		FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC`, uid)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()

	out := make([]models.APIToken, 0, 4)
	for rows.Next() {
		var t models.APIToken
		var lastUsed sql.NullTime
		if err := rows.Scan(&t.ID, &t.Name, &t.CreatedAt, &lastUsed); err != nil {
			writeJSONError(w, http.StatusInternalServerError, "scan error")
			return
		}
		if lastUsed.Valid {
			t.LastUsedAt = &lastUsed.Time
		}
		out = append(out, t)
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"tokens": out})
}

// DeleteToken — DELETE /api/tokens/{id}. Только свои токены.
func (h *Handler) DeleteToken(w http.ResponseWriter, r *http.Request) {
	uid, _ := h.userID(r)
	id, err := strconv.ParseInt(mux.Vars(r)["id"], 10, 64)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "bad token id")
		return
	}
	res, err := h.db.Exec("DELETE FROM api_tokens WHERE id = ? AND user_id = ?", id, uid)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "delete error")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeJSONError(w, http.StatusNotFound, "token not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
