package main

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"

	"github.com/evbogdanov/tobedone/internal/config"
	"github.com/evbogdanov/tobedone/internal/database"
	"github.com/evbogdanov/tobedone/internal/handlers"
	_ "github.com/go-sql-driver/mysql"
	"github.com/gorilla/mux"
	"github.com/gorilla/sessions"
)

func noCache(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		next.ServeHTTP(w, r)
	})
}

func main() {
	cfg := config.Load()

	db, err := sql.Open("mysql", cfg.DatabaseDSN)
	if err != nil {
		log.Fatal("open db:", err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		log.Fatal("ping db:", err)
	}
	if err := database.InitDB(db); err != nil {
		log.Fatal("init db:", err)
	}

	store := sessions.NewCookieStore([]byte(cfg.SessionSecret))
	store.Options = &sessions.Options{
		Path:     "/",
		MaxAge:   86400 * 30, // 30 дней
		HttpOnly: true,
		Secure:   cfg.SecureCookie,
		SameSite: http.SameSiteLaxMode,
	}

	h := handlers.New(db, store)
	r := mux.NewRouter()

	// Статика. no-cache = браузер ревалидирует файл при каждом запросе
	// (FileServer отвечает 304 по If-Modified-Since — дёшево); без этого
	// после деплоя клиенты подолгу сидят на старых app.js/app.css.
	r.PathPrefix("/static/").Handler(
		http.StripPrefix("/static/", noCache(http.FileServer(http.Dir("static")))),
	)

	// HTML-страницы
	r.HandleFunc("/", h.RequireAuthHTML(h.AppPage)).Methods("GET")
	r.HandleFunc("/login", h.LoginPage).Methods("GET")
	r.HandleFunc("/signup", h.SignupPage).Methods("GET")

	// Auth API
	r.HandleFunc("/auth/signup", h.Signup).Methods("POST")
	r.HandleFunc("/auth/login", h.Login).Methods("POST")
	r.HandleFunc("/auth/logout", h.Logout).Methods("POST", "GET")
	r.HandleFunc("/auth/me", h.Me).Methods("GET")

	// API (требует авторизации)
	api := r.PathPrefix("/api").Subrouter()
	api.Use(h.RequireAuthAPI)

	// Boards
	api.HandleFunc("/boards", h.ListBoards).Methods("GET")
	api.HandleFunc("/boards", h.CreateBoard).Methods("POST")

	// Всё под конкретной доской — требует членства в ней
	b := api.PathPrefix("/boards/{bid}").Subrouter()
	b.Use(h.RequireMember)
	b.HandleFunc("", h.PatchBoard).Methods("PATCH")
	b.HandleFunc("", h.DeleteBoard).Methods("DELETE")
	b.HandleFunc("/members", h.ListMembers).Methods("GET")
	b.HandleFunc("/members", h.AddMember).Methods("POST")
	b.HandleFunc("/members/{uid}", h.RemoveMember).Methods("DELETE")

	// Tasks доски
	b.HandleFunc("/tasks", h.ListTasks).Methods("GET")
	b.HandleFunc("/tasks", h.CreateTask).Methods("POST")
	b.HandleFunc("/tasks/sync", h.Sync).Methods("POST")
	b.HandleFunc("/tasks/{id}", h.PatchTask).Methods("PATCH")
	b.HandleFunc("/tasks/{id}", h.DeleteTask).Methods("DELETE")
	b.HandleFunc("/tasks/{id}/reorder", h.ReorderTask).Methods("POST")

	addr := fmt.Sprintf(":%s", cfg.Port)
	log.Printf("tobedone listening on http://localhost:%s", cfg.Port)
	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatal("server:", err)
	}
}
