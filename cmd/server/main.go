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

	// статика
	r.PathPrefix("/static/").Handler(
		http.StripPrefix("/static/", http.FileServer(http.Dir("static"))),
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

	// Tasks API (требует авторизации)
	api := r.PathPrefix("/api").Subrouter()
	api.Use(h.RequireAuthAPI)
	api.HandleFunc("/tasks", h.ListTasks).Methods("GET")
	api.HandleFunc("/tasks", h.CreateTask).Methods("POST")
	api.HandleFunc("/tasks/sync", h.Sync).Methods("POST")
	api.HandleFunc("/tasks/{id}", h.PatchTask).Methods("PATCH")
	api.HandleFunc("/tasks/{id}", h.DeleteTask).Methods("DELETE")
	api.HandleFunc("/tasks/{id}/reorder", h.ReorderTask).Methods("POST")

	addr := fmt.Sprintf(":%s", cfg.Port)
	log.Printf("tobedone listening on http://localhost:%s", cfg.Port)
	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatal("server:", err)
	}
}
