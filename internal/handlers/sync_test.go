package handlers

import (
	"database/sql"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/mux"
	"github.com/gorilla/sessions"
	_ "modernc.org/sqlite"
)

func taskTestHandler(t *testing.T) *Handler {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	_, err = db.Exec(`CREATE TABLE tasks (
 id TEXT PRIMARY KEY, user_id INTEGER, board_id TEXT, title TEXT, note TEXT,
 color TEXT, size TEXT, tag TEXT, done INTEGER, position REAL,
 created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
 due_at DATETIME, completed_at DATETIME, deleted_at DATETIME, sub TEXT, recurrence TEXT)`)
	if err != nil {
		t.Fatal(err)
	}
	return &Handler{db: db, store: sessions.NewCookieStore([]byte("test-session-secret"))}
}

func TestSyncCannotOverwriteAnotherBoard(t *testing.T) {
	h := taskTestHandler(t)
	_, err := h.db.Exec(`INSERT INTO tasks (id, board_id, title) VALUES ('known-id','private','original')`)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("POST", "/", strings.NewReader(`{"changes":[{"op":"upsert","task":{"id":"known-id","title":"overwritten"}}]}`))
	req = mux.SetURLVars(req, map[string]string{"bid": "own"})
	w := httptest.NewRecorder()
	h.Sync(w, req)
	if w.Code != 409 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	var title string
	if err := h.db.QueryRow("SELECT title FROM tasks WHERE id='known-id'").Scan(&title); err != nil {
		t.Fatal(err)
	}
	if title != "original" {
		t.Fatalf("foreign task changed: %s", title)
	}
}

func TestCreateTaskRetryAndBoardIsolation(t *testing.T) {
	h := taskTestHandler(t)
	const body = `{"id":"5f5c7df1-aeaa-420e-aed8-32f7bc812419","title":"first"}`
	create := func(board, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("POST", "/", strings.NewReader(body))
		req = mux.SetURLVars(req, map[string]string{"bid": board})
		w := httptest.NewRecorder()
		h.CreateTask(w, req)
		return w
	}
	for i := 0; i < 2; i++ {
		if w := create("own", body); w.Code != 200 {
			t.Fatalf("status=%d: %s", w.Code, w.Body)
		}
	}
	if w := create("other", body); w.Code == 200 {
		t.Fatal("returned another board's task")
	}
	var n int
	if err := h.db.QueryRow("SELECT COUNT(*) FROM tasks").Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("duplicate creation: %d", n)
	}
}

func TestSyncCreatesAndUpdatesOwnTask(t *testing.T) {
	h := taskTestHandler(t)
	for _, title := range []string{"first", "second"} {
		req := httptest.NewRequest("POST", "/", strings.NewReader(`{"changes":[{"op":"upsert","task":{"id":"own-id","title":"`+title+`"}}]}`))
		req = mux.SetURLVars(req, map[string]string{"bid": "own"})
		w := httptest.NewRecorder()
		h.Sync(w, req)
		if w.Code != 200 {
			t.Fatalf("status=%d: %s", w.Code, w.Body)
		}
	}
	var title string
	if err := h.db.QueryRow("SELECT title FROM tasks WHERE id='own-id'").Scan(&title); err != nil {
		t.Fatal(err)
	}
	if title != "second" {
		t.Fatalf("title=%s", title)
	}
}
