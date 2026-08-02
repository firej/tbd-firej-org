package handlers

import (
	"testing"
	"time"
)

func TestParseDue(t *testing.T) {
	loc := time.FixedZone("MSK", 3*3600)
	now := time.Date(2026, 8, 2, 10, 0, 0, 0, loc) // воскресенье, утро

	cases := []struct {
		name string
		in   string
		want string // RFC3339 или "" для nil
		err  bool
	}{
		{"пусто — без срока", "", "", false},
		{"today — конец сегодняшнего дня", "today", "2026-08-02T23:59:00+03:00", false},
		{"сегодня по-русски", "Сегодня", "2026-08-02T23:59:00+03:00", false},
		{"tomorrow", "tomorrow", "2026-08-03T23:59:00+03:00", false},
		{"послезавтра", "послезавтра", "2026-08-04T23:59:00+03:00", false},
		{"завтра с временем", "завтра 09:15", "2026-08-03T09:15:00+03:00", false},
		{"дата без времени — конец дня", "2026-08-10", "2026-08-10T23:59:00+03:00", false},
		{"дата с временем через пробел", "2026-08-10 18:30", "2026-08-10T18:30:00+03:00", false},
		{"дата с временем через T", "2026-08-10T18:30", "2026-08-10T18:30:00+03:00", false},
		{"полный RFC3339", "2026-08-10T18:30:00+03:00", "2026-08-10T18:30:00+03:00", false},
		// now = воскресенье 02.08 → ближайшая пятница 07.08, воскресенье — сегодня
		{"день недели en", "friday", "2026-08-07T23:59:00+03:00", false},
		{"день недели ru винительный + время", "в Пятницу 15:00", "", true}, // предлог не поддерживаем
		{"день недели ru", "пятницу 15:00", "2026-08-07T15:00:00+03:00", false},
		{"сегодняшний день недели — сегодня", "воскресенье", "2026-08-02T23:59:00+03:00", false},
		{"сдвиг в днях", "+3d", "2026-08-05T23:59:00+03:00", false},
		{"сдвиг в неделях с временем", "+2w 10:00", "2026-08-16T10:00:00+03:00", false},
		{"мусор — ошибка", "хз когда", "", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := parseDue(c.in, now)
			if c.err {
				if err == nil {
					t.Fatalf("ожидалась ошибка, получено %v", got)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if c.want == "" {
				if got != nil {
					t.Fatalf("ожидался nil, получено %v", got)
				}
				return
			}
			if got.Format(time.RFC3339) != c.want {
				t.Errorf("parseDue(%q) = %s, want %s", c.in, got.Format(time.RFC3339), c.want)
			}
		})
	}
}

func TestFmtWhen(t *testing.T) {
	loc := time.FixedZone("MSK", 3*3600)
	now := time.Date(2026, 8, 2, 10, 0, 0, 0, loc)
	ts := func(y int, m time.Month, d, hh, mm int) time.Time {
		return time.Date(y, m, d, hh, mm, 0, 0, loc)
	}

	cases := []struct {
		name string
		in   time.Time
		want string
	}{
		{"сегодня с временем", ts(2026, 8, 2, 18, 0), "сегодня 18:00"},
		{"сегодня весь день (23:59)", ts(2026, 8, 2, 23, 59), "сегодня"},
		{"завтра", ts(2026, 8, 3, 9, 30), "завтра 09:30"},
		{"вчера", ts(2026, 8, 1, 23, 59), "вчера"},
		{"этот год — без года", ts(2026, 8, 10, 12, 0), "10.08 12:00"},
		{"другой год — с годом", ts(2027, 1, 5, 23, 59), "05.01.2027"},
		{"UTC конвертируется в зону now", time.Date(2026, 8, 2, 15, 0, 0, 0, time.UTC), "сегодня 18:00"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := fmtWhen(c.in, now); got != c.want {
				t.Errorf("fmtWhen(%v) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}
