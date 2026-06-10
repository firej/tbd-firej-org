package handlers

import (
	"testing"
	"time"
)

func TestNextOccurrence(t *testing.T) {
	now := time.Date(2026, 6, 9, 12, 0, 0, 0, time.UTC)
	ts := func(s string) *time.Time {
		v, err := time.Parse(time.RFC3339, s)
		if err != nil {
			t.Fatal(err)
		}
		return &v
	}

	cases := []struct {
		name   string
		due    *time.Time
		repeat string
		want   string
	}{
		{"daily от будущего срока", ts("2026-06-09T18:00:00Z"), "daily", "2026-06-10T18:00:00Z"},
		{"daily от прошедшего срока — догоняем до будущего", ts("2026-06-01T09:00:00Z"), "daily", "2026-06-10T09:00:00Z"},
		{"daily без срока — от now", nil, "daily", "2026-06-10T12:00:00Z"},
		{"weekly", ts("2026-06-08T09:00:00Z"), "weekly", "2026-06-15T09:00:00Z"},
		{"monthly", ts("2026-06-05T09:00:00Z"), "monthly", "2026-07-05T09:00:00Z"},
		{"monthly из далёкого прошлого", ts("2026-01-05T09:00:00Z"), "monthly", "2026-07-05T09:00:00Z"},
		{"yearly", ts("2026-03-08T09:00:00Z"), "yearly", "2027-03-08T09:00:00Z"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := nextOccurrence(c.due, c.repeat, now)
			if got.Format(time.RFC3339) != c.want {
				t.Errorf("nextOccurrence(%v, %s) = %s, want %s", c.due, c.repeat, got.Format(time.RFC3339), c.want)
			}
			if !got.After(now) {
				t.Errorf("результат должен быть строго позже now")
			}
		})
	}
}
