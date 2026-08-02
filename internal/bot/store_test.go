package bot

import (
	"path/filepath"
	"testing"
)

func TestStoreLinkRoundtrip(t *testing.T) {
	s, err := OpenStore(filepath.Join(t.TempDir(), "b.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	if err := s.SaveLink(Link{ChatID: 777, Token: "tbd_x", DisplayName: "Женя", TZ: ""}); err != nil {
		t.Fatal(err)
	}
	l, err := s.GetLink(777)
	if err != nil {
		t.Fatal(err)
	}
	if l == nil {
		t.Fatal("привязка не найдена сразу после сохранения")
	}
	if l.Token != "tbd_x" || l.DisplayName != "Женя" {
		t.Fatalf("прочиталось не то: %+v", l)
	}
	if n := s.CountLinks(); n != 1 {
		t.Fatalf("CountLinks = %d, want 1", n)
	}

	// перезапись токена по тому же чату
	if err := s.SaveLink(Link{ChatID: 777, Token: "tbd_y", DisplayName: "Женя", TZ: ""}); err != nil {
		t.Fatal(err)
	}
	if l, _ := s.GetLink(777); l == nil || l.Token != "tbd_y" {
		t.Fatalf("токен не обновился: %+v", l)
	}

	// tz сохраняется отдельной командой и не сбрасывается при перепривязке
	if err := s.SetTZ(777, "Europe/Berlin"); err != nil {
		t.Fatal(err)
	}
	_ = s.SaveLink(Link{ChatID: 777, Token: "tbd_z", DisplayName: "Женя", TZ: ""})
	if l, _ := s.GetLink(777); l == nil || l.TZ != "Europe/Berlin" {
		t.Errorf("TZ потерялся при перепривязке: %+v", l)
	}

	if err := s.DeleteLink(777); err != nil {
		t.Fatal(err)
	}
	// «нет записи» — это (nil, nil), а не ошибка: бот отличает непривязанный
	// чат от недоступной базы и говорит юзеру разные вещи.
	l, err = s.GetLink(777)
	if err != nil {
		t.Errorf("удаление не должно давать ошибку чтения: %v", err)
	}
	if l != nil {
		t.Error("привязка осталась после удаления")
	}
}

// Сломанная база должна давать именно ошибку, а не «чат не привязан».
func TestGetLinkDistinguishesDBFailure(t *testing.T) {
	s, err := OpenStore(filepath.Join(t.TempDir(), "b.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SaveLink(Link{ChatID: 777, Token: "tbd_x", DisplayName: "Женя"}); err != nil {
		t.Fatal(err)
	}
	s.Close() // дальше любые запросы падают

	l, err := s.GetLink(777)
	if err == nil {
		t.Fatalf("ожидалась ошибка БД, получено link=%+v", l)
	}
	if l != nil {
		t.Errorf("при ошибке привязка должна быть nil, получено %+v", l)
	}
}

func TestStoreUpdateIDAndUsage(t *testing.T) {
	dir := t.TempDir()
	s, err := OpenStore(filepath.Join(dir, "b.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SetLastUpdateID(42); err != nil {
		t.Fatal(err)
	}
	if got := s.LastUpdateID(); got != 42 {
		t.Fatalf("LastUpdateID = %d, want 42", got)
	}
	// переживает переоткрытие (дедуп после рестарта)
	s.Close()
	s2, err := OpenStore(filepath.Join(dir, "b.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer s2.Close()
	if got := s2.LastUpdateID(); got != 42 {
		t.Fatalf("после переоткрытия LastUpdateID = %d, want 42", got)
	}

	n, err := s2.IncUsage(777, "2026-08-02")
	if err != nil || n != 1 {
		t.Fatalf("IncUsage = %d, %v", n, err)
	}
	n, _ = s2.IncUsage(777, "2026-08-02")
	if n != 2 {
		t.Fatalf("IncUsage повторно = %d, want 2", n)
	}
	if total := s2.UsageTotal("2026-08-02"); total != 2 {
		t.Fatalf("UsageTotal = %d, want 2", total)
	}
}
