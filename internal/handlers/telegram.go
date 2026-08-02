package handlers

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
)

// ── Привязка Telegram ──────────────────────────────────────────────
//
// Веб (под сессией) выдаёт одноразовый код; юзер тапает deep link
// t.me/<bot>?start=<code>; бот меняет код на постоянный api_token через
// /api/telegram/exchange. Код — 256 бит случайности, живёт 10 минут,
// сам по себе является credential'ом, поэтому обмен не требует иной
// авторизации. В БД хранится только SHA-256 кода.

// newLinkCode — код в base64url (43 символа — влезает в 64-символьный
// лимит telegram deep link, алфавит совместим).
func newLinkCode() (code, hash string) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	code = base64.RawURLEncoding.EncodeToString(buf)
	return code, hashToken(code)
}

// CreateLinkCode — POST /api/telegram/link-code (сессия).
// Возвращает код и, если настроен username бота, готовый deep link.
func (h *Handler) CreateLinkCode(w http.ResponseWriter, r *http.Request) {
	uid, _ := h.userID(r)

	// Заодно прибираем протухшие коды — дешёвле, чем отдельный джоб.
	_, _ = h.db.Exec("DELETE FROM link_codes WHERE expires_at < NOW() OR used_at IS NOT NULL")

	code, hash := newLinkCode()
	if _, err := h.db.Exec(
		"INSERT INTO link_codes (code_hash, user_id, expires_at) VALUES (?, ?, NOW() + INTERVAL 10 MINUTE)",
		hash, uid,
	); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "insert error")
		return
	}

	resp := map[string]string{"code": code}
	if h.botUsername != "" {
		resp["url"] = "https://t.me/" + h.botUsername + "?start=" + code
		resp["bot"] = h.botUsername
	}
	writeJSON(w, http.StatusOK, resp)
}

type exchangePayload struct {
	Code string `json:"code"`
}

// ExchangeLinkCode — POST /api/telegram/exchange {code} → {token, display_name}.
// Вызывается ботом; код гасится атомарно, токен обычный (api_tokens, имя telegram).
func (h *Handler) ExchangeLinkCode(w http.ResponseWriter, r *http.Request) {
	var p exchangePayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeJSONError(w, http.StatusBadRequest, "bad json")
		return
	}
	p.Code = strings.TrimSpace(p.Code)
	if p.Code == "" {
		writeJSONError(w, http.StatusBadRequest, "code required")
		return
	}

	// Атомарное гашение: UPDATE попадает ровно один раз даже при гонке.
	res, err := h.db.Exec(
		"UPDATE link_codes SET used_at = NOW() WHERE code_hash = ? AND used_at IS NULL AND expires_at > NOW()",
		hashToken(p.Code),
	)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "db error")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeJSONError(w, http.StatusNotFound, "код не найден, использован или протух — сгенерируй новый в веб-интерфейсе")
		return
	}

	var uid int64
	if err := h.db.QueryRow(
		"SELECT user_id FROM link_codes WHERE code_hash = ?", hashToken(p.Code),
	).Scan(&uid); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "db error")
		return
	}

	token, hash := newAPIToken()
	if _, err := h.db.Exec(
		"INSERT INTO api_tokens (user_id, name, token_hash) VALUES (?, 'telegram', ?)", uid, hash,
	); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "insert error")
		return
	}

	u, err := h.loadUser(uid)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"token": token, "display_name": u.DisplayName})
}
