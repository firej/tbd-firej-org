package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/sessions"
)

func TestLoginReplacesInvalidSession(t *testing.T) {
	oldStore := sessions.NewCookieStore([]byte("old-server-secret"))
	oldRequest := httptest.NewRequest("GET", "/", nil)
	oldSession, _ := oldStore.Get(oldRequest, "tbd-session")
	oldSession.Values["user_id"] = int64(999)
	oldResponse := httptest.NewRecorder()
	if err := oldSession.Save(oldRequest, oldResponse); err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		name   string
		cookie *http.Cookie
	}{
		{"old server key", oldResponse.Result().Cookies()[0]},
		{"malformed cookie", &http.Cookie{Name: "tbd-session", Value: "invalid"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := &Handler{store: sessions.NewCookieStore([]byte("new-server-secret"))}
			req := httptest.NewRequest("POST", "/auth/login", nil)
			req.AddCookie(tc.cookie)
			if _, ok := h.userID(req); ok {
				t.Fatal("invalid cookie authenticated")
			}
			w := httptest.NewRecorder()
			if err := h.setUserID(w, req, 42); err != nil {
				t.Fatalf("login session: %v", err)
			}
			next := httptest.NewRequest("GET", "/auth/me", nil)
			for _, cookie := range w.Result().Cookies() {
				next.AddCookie(cookie)
			}
			if id, ok := h.userID(next); !ok || id != 42 {
				t.Fatalf("session id=%d authenticated=%v", id, ok)
			}
		})
	}
}
