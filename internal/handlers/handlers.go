package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"html/template"
	"net/http"
	"strings"

	"github.com/evbogdanov/tobedone/internal/models"
	"github.com/gorilla/sessions"
)

type Handler struct {
	db        *sql.DB
	store     *sessions.CookieStore
	templates *template.Template
}

func New(db *sql.DB, store *sessions.CookieStore) *Handler {
	funcMap := template.FuncMap{
		"upper": strings.ToUpper,
		"initials": func(name string) string {
			parts := strings.Fields(name)
			out := ""
			for i, p := range parts {
				if i >= 2 {
					break
				}
				r := []rune(p)
				if len(r) > 0 {
					out += string(r[0])
				}
			}
			return strings.ToUpper(out)
		},
	}
	tpl := template.Must(template.New("").Funcs(funcMap).ParseGlob("templates/*.html"))
	return &Handler{db: db, store: store, templates: tpl}
}

// ── session helpers ────────────────────────────────────────────────

func (h *Handler) userID(r *http.Request) (int64, bool) {
	sess, err := h.store.Get(r, "tbd-session")
	if err != nil {
		return 0, false
	}
	id, ok := sess.Values["user_id"].(int64)
	if !ok {
		return 0, false
	}
	return id, true
}

func (h *Handler) setUserID(w http.ResponseWriter, r *http.Request, id int64) error {
	sess, err := h.store.Get(r, "tbd-session")
	if err != nil {
		return err
	}
	sess.Values["user_id"] = id
	return sess.Save(r, w)
}

func (h *Handler) clearSession(w http.ResponseWriter, r *http.Request) {
	sess, err := h.store.Get(r, "tbd-session")
	if err != nil {
		return
	}
	sess.Values = map[interface{}]interface{}{}
	sess.Options.MaxAge = -1
	sess.Save(r, w)
}

// loadUser получает пользователя по ID (для шаблонов / /auth/me).
func (h *Handler) loadUser(id int64) (*models.User, error) {
	u := &models.User{}
	err := h.db.QueryRow(`
		SELECT id, email, display_name, COALESCE(avatar_color, ''), created_at, updated_at
		FROM users WHERE id = ?`, id,
	).Scan(&u.ID, &u.Email, &u.DisplayName, &u.AvatarColor, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return u, nil
}

// ── middleware ─────────────────────────────────────────────────────

func (h *Handler) RequireAuthHTML(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := h.userID(r); !ok {
			http.Redirect(w, r, "/login", http.StatusSeeOther)
			return
		}
		next(w, r)
	}
}

func (h *Handler) RequireAuthAPI(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := h.userID(r); !ok {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ── render helpers ─────────────────────────────────────────────────

func (h *Handler) render(w http.ResponseWriter, name string, data interface{}) {
	var buf strings.Builder
	if err := h.templates.ExecuteTemplate(&buf, name, data); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprint(w, buf.String())
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeJSONError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
