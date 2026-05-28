package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/evbogdanov/tobedone/internal/models"
	"golang.org/x/crypto/bcrypt"
)

type authPayload struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name,omitempty"`
}

// pickPalette подбирает цвет аватарки на основе email.
func pickPalette(seed string) string {
	colors := []string{"terra", "indigo", "olive", "mustard", "rose", "clay"}
	if seed == "" {
		return colors[0]
	}
	h := 0
	for _, r := range seed {
		h = (h*31 + int(r)) & 0x7fffffff
	}
	return colors[h%len(colors)]
}

// ── HTML: страницы login / signup ──────────────────────────────────

// LoginPage — GET /login. Если уже залогинен — редиректит на /.
func (h *Handler) LoginPage(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.userID(r); ok {
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	h.render(w, "login.html", map[string]interface{}{"Title": "tobedone — вход"})
}

// SignupPage — GET /signup.
func (h *Handler) SignupPage(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.userID(r); ok {
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	h.render(w, "signup.html", map[string]interface{}{"Title": "tobedone — регистрация"})
}

// Logout — POST/GET /auth/logout.
func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	h.clearSession(w, r)
	// HTMX-friendly: если запрос пришёл от HTMX — отдаём 204, иначе редирект.
	if r.Header.Get("HX-Request") == "true" {
		w.Header().Set("HX-Redirect", "/login")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	http.Redirect(w, r, "/login", http.StatusSeeOther)
}

// ── JSON API: /auth/signup, /auth/login, /auth/me ───────────────────

// parseAuth разбирает тело: поддерживаем и JSON, и form-urlencoded
// (на login.html можно делать обычный <form>, на signup.html тоже).
func parseAuth(r *http.Request) (authPayload, error) {
	var p authPayload
	ct := r.Header.Get("Content-Type")
	if strings.HasPrefix(ct, "application/json") {
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			return p, err
		}
	} else {
		if err := r.ParseForm(); err != nil {
			return p, err
		}
		p.Email = r.FormValue("email")
		p.Password = r.FormValue("password")
		p.DisplayName = r.FormValue("display_name")
	}
	p.Email = strings.ToLower(strings.TrimSpace(p.Email))
	p.DisplayName = strings.TrimSpace(p.DisplayName)
	return p, nil
}

// Signup — POST /auth/signup. Возвращает {user} и ставит cookie-сессию.
func (h *Handler) Signup(w http.ResponseWriter, r *http.Request) {
	p, err := parseAuth(r)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "bad request")
		return
	}
	if p.Email == "" || p.Password == "" {
		writeJSONError(w, http.StatusBadRequest, "email и пароль обязательны")
		return
	}
	if p.DisplayName == "" {
		// fallback — часть email до @
		if i := strings.Index(p.Email, "@"); i > 0 {
			p.DisplayName = p.Email[:i]
		} else {
			p.DisplayName = p.Email
		}
	}

	var exists bool
	if err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE email = ?)", p.Email).Scan(&exists); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "db error")
		return
	}
	if exists {
		writeJSONError(w, http.StatusConflict, "пользователь с таким email уже существует")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(p.Password), bcrypt.DefaultCost)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "bcrypt error")
		return
	}

	res, err := h.db.Exec(`
		INSERT INTO users (email, password_hash, display_name, avatar_color)
		VALUES (?, ?, ?, ?)`,
		p.Email, string(hash), p.DisplayName, pickPalette(p.Email))
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "insert error")
		return
	}
	uid, _ := res.LastInsertId()
	if err := h.setUserID(w, r, uid); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "session error")
		return
	}

	user, _ := h.loadUser(uid)
	writeJSON(w, http.StatusOK, map[string]interface{}{"user": user})
}

// Login — POST /auth/login.
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	p, err := parseAuth(r)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "bad request")
		return
	}
	if p.Email == "" || p.Password == "" {
		writeJSONError(w, http.StatusBadRequest, "email и пароль обязательны")
		return
	}

	var u models.User
	err = h.db.QueryRow(`
		SELECT id, email, password_hash, display_name, COALESCE(avatar_color, ''), created_at, updated_at
		FROM users WHERE email = ?`, p.Email,
	).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.DisplayName, &u.AvatarColor, &u.CreatedAt, &u.UpdatedAt)
	if err == sql.ErrNoRows {
		writeJSONError(w, http.StatusUnauthorized, "неверный email или пароль")
		return
	}
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "db error")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(p.Password)); err != nil {
		writeJSONError(w, http.StatusUnauthorized, "неверный email или пароль")
		return
	}

	if err := h.setUserID(w, r, u.ID); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "session error")
		return
	}
	u.PasswordHash = ""
	writeJSON(w, http.StatusOK, map[string]interface{}{"user": u})
}

// Me — GET /auth/me. Полезен фронту, чтобы понять, авторизован ли юзер.
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	u, err := h.loadUser(uid)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "user not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"user": u})
}
