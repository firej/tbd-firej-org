package bot

import (
	"strings"
	"testing"
)

func TestSplitCommand(t *testing.T) {
	cases := []struct {
		in, cmd, arg string
	}{
		{"/today", "/today", ""},
		{"/today@tbd_bot", "/today", ""},
		{"/link abc123", "/link", "abc123"},
		{"/tz Europe/Moscow", "/tz", "Europe/Moscow"},
		{"добавь молоко", "", "добавь молоко"},
	}
	for _, c := range cases {
		cmd, arg := splitCommand(c.in)
		if cmd != c.cmd || arg != c.arg {
			t.Errorf("splitCommand(%q) = (%q, %q), want (%q, %q)", c.in, cmd, arg, c.cmd, c.arg)
		}
	}
}

func TestSplitMessage(t *testing.T) {
	t.Run("короткое — как есть", func(t *testing.T) {
		got := splitMessage("привет", 100)
		if len(got) != 1 || got[0] != "привет" {
			t.Fatalf("got %v", got)
		}
	})
	t.Run("режется по переносам и ничего не теряет", func(t *testing.T) {
		lines := strings.Repeat("строка про задачу\n", 50)
		got := splitMessage(strings.TrimRight(lines, "\n"), 200)
		if len(got) < 2 {
			t.Fatalf("ожидался сплит, got %d chunks", len(got))
		}
		for i, ch := range got {
			if len(ch) > 200 {
				t.Errorf("chunk %d длиннее лимита: %d", i, len(ch))
			}
		}
		joined := strings.Join(got, "\n")
		if strings.ReplaceAll(joined, "\n", "") != strings.ReplaceAll(lines, "\n", "") {
			t.Error("контент потерялся при сплите")
		}
	})
	t.Run("без переносов — жёсткая нарезка", func(t *testing.T) {
		got := splitMessage(strings.Repeat("x", 450), 200)
		if len(got) != 3 {
			t.Fatalf("want 3 chunks, got %d", len(got))
		}
	})
}

func TestHistoryTrimAndReset(t *testing.T) {
	h := newHistory()
	for i := 0; i < 30; i++ {
		h.add(1, ChatMessage{Role: "user", Content: "msg"})
	}
	if n := len(h.get(1)); n != historyLimit {
		t.Errorf("история не обрезана: %d", n)
	}
	h.reset(1)
	if n := len(h.get(1)); n != 0 {
		t.Errorf("после reset осталось %d", n)
	}
}
