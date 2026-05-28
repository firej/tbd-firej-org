package handlers

import (
	"html/template"
	"os"
	"strings"
	"testing"
)

// TestTemplatesParse гарантирует, что все шаблоны валидны.
// Тест запускается через go test ./internal/handlers — рабочая директория
// у него equals ./internal/handlers, поэтому переходим в корень проекта.
func TestTemplatesParse(t *testing.T) {
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	// корень — на два уровня выше
	root := strings.TrimSuffix(wd, "/internal/handlers")
	if err := os.Chdir(root); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chdir(wd) })

	funcMap := template.FuncMap{
		"upper":    strings.ToUpper,
		"initials": func(string) string { return "" },
	}
	if _, err := template.New("").Funcs(funcMap).ParseGlob("templates/*.html"); err != nil {
		t.Fatalf("template parse: %v", err)
	}
}
