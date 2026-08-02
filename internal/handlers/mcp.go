package handlers

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/evbogdanov/tobedone/internal/models"
	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// ── MCP API ────────────────────────────────────────────────────────
//
// Эндпоинт /mcp (streamable HTTP, stateless) для LLM-агентов и ботов.
// Авторизация — Bearer-токеном из /api/tokens. Инструменты нарочно
// простые и «плоские»: рассчитаны на дешёвые модели, которые путаются
// в сложных схемах. Задачи адресуются коротким id — первыми символами
// uuid, как их печатают list_tasks / today_agenda.

const mcpInstructions = `Это менеджер задач tobedone. Задачи лежат на досках,
внутри доски отсортированы по приоритету: верхние — самые важные.
В выводе инструментов у каждой задачи короткий id в квадратных скобках,
например [a3f2c1] — передавай его в аргумент task без скобок.
Даты пиши как YYYY-MM-DD, словами today / tomorrow / послезавтра, днём недели
(«пятница») или сдвигом «+3d»; ко всему можно дописать время: «пятница 15:00».`

type ctxKey int

const ctxUserID ctxKey = iota

func uidFromCtx(ctx context.Context) (int64, error) {
	uid, ok := ctx.Value(ctxUserID).(int64)
	if !ok {
		return 0, fmt.Errorf("unauthorized")
	}
	return uid, nil
}

// MCPHandler — http.Handler для /mcp: Bearer-авторизация поверх
// streamable-хендлера из официального SDK.
func (h *Handler) MCPHandler() http.Handler {
	srv := mcp.NewServer(
		&mcp.Implementation{Name: "tobedone", Title: "tobedone — задачи", Version: "1.0.0"},
		&mcp.ServerOptions{Instructions: mcpInstructions},
	)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_boards",
		Description: "Список досок пользователя с числом открытых задач.",
	}, h.mcpListBoards)

	mcp.AddTool(srv, &mcp.Tool{
		Name: "list_tasks",
		Description: "Задачи доски (или всех досок) в порядке приоритета: верхние — следующие на очереди. " +
			"По умолчанию показывает только невыполненные.",
	}, h.mcpListTasks)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "create_task",
		Description: "Создать задачу. Она появится наверху доски.",
	}, h.mcpCreateTask)

	mcp.AddTool(srv, &mcp.Tool{
		Name: "complete_task",
		Description: "Отметить задачу выполненной. Повторяющаяся задача не закрывается, " +
			"а переносится на следующий срок.",
	}, h.mcpCompleteTask)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "update_task",
		Description: "Изменить задачу: заголовок, заметку, срок, тег или повторение. Незаполненные поля не меняются.",
	}, h.mcpUpdateTask)

	mcp.AddTool(srv, &mcp.Tool{
		Name: "today_agenda",
		Description: "План на день: задачи со сроком на эту дату плюс всё просроченное. " +
			"Подходит для утреннего дайджеста.",
	}, h.mcpTodayAgenda)

	streamable := mcp.NewStreamableHTTPHandler(
		func(*http.Request) *mcp.Server { return srv },
		&mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true},
	)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uid, ok := h.userIDFromBearer(r)
		if !ok {
			w.Header().Set("WWW-Authenticate", `Bearer realm="tobedone MCP"`)
			writeJSONError(w, http.StatusUnauthorized, "нужен заголовок Authorization: Bearer <токен из /api/tokens>")
			return
		}
		streamable.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxUserID, uid)))
	})
}

func textResult(s string) *mcp.CallToolResult {
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: s}}}
}

// ── резолверы ──────────────────────────────────────────────────────

// resolveBoard находит доску по названию (без учёта регистра, можно кусок
// названия) или по id/префиксу id. Пустой ref — первая доска пользователя.
func (h *Handler) resolveBoard(uid int64, ref string) (*models.Board, error) {
	boards, err := h.userBoards(uid)
	if err != nil {
		return nil, fmt.Errorf("db error: %w", err)
	}
	if len(boards) == 0 {
		return nil, fmt.Errorf("у пользователя нет ни одной доски")
	}
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return boards[0], nil
	}

	names := func() string {
		out := make([]string, len(boards))
		for i, b := range boards {
			out[i] = "«" + b.Name + "»"
		}
		return strings.Join(out, ", ")
	}

	// 1) точное имя, 2) уникальное вхождение, 3) id или его префикс
	var sub []*models.Board
	lower := strings.ToLower(ref)
	for _, b := range boards {
		if strings.EqualFold(b.Name, ref) {
			return b, nil
		}
		if strings.Contains(strings.ToLower(b.Name), lower) {
			sub = append(sub, b)
		}
	}
	if len(sub) == 1 {
		return sub[0], nil
	}
	if len(sub) > 1 {
		return nil, fmt.Errorf("под «%s» подходит несколько досок, уточни название. Доски: %s", ref, names())
	}
	for _, b := range boards {
		if strings.HasPrefix(b.ID, lower) {
			return b, nil
		}
	}
	return nil, fmt.Errorf("доска «%s» не найдена. Доски: %s", ref, names())
}

var taskRefRe = regexp.MustCompile(`^[0-9a-fA-F-]{4,36}$`)

// resolveTask находит задачу по id или префиксу id (минимум 4 символа)
// среди досок, где пользователь состоит участником.
func (h *Handler) resolveTask(uid int64, ref string) (*models.Task, error) {
	ref = strings.ToLower(strings.Trim(strings.TrimSpace(ref), "[]"))
	if !taskRefRe.MatchString(ref) {
		return nil, fmt.Errorf("«%s» не похоже на id задачи — возьми короткий id из list_tasks, например a3f2c1", ref)
	}
	rows, err := h.db.Query(
		`SELECT `+taskSelectCols+` FROM tasks
		 WHERE deleted_at IS NULL
		   AND board_id IN (SELECT board_id FROM board_members WHERE user_id = ?)
		   AND id LIKE ?
		 LIMIT 2`, uid, ref+"%",
	)
	if err != nil {
		return nil, fmt.Errorf("db error: %w", err)
	}
	defer rows.Close()

	var found []*models.Task
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, fmt.Errorf("scan error: %w", err)
		}
		found = append(found, t)
	}
	switch len(found) {
	case 0:
		return nil, fmt.Errorf("задача %s не найдена — проверь id через list_tasks", ref)
	case 1:
		return found[0], nil
	default:
		return nil, fmt.Errorf("префикс %s неоднозначен, укажи больше символов id", ref)
	}
}

// ── форматирование ─────────────────────────────────────────────────

func shortID(id string) string {
	if len(id) > 6 {
		return id[:6]
	}
	return id
}

var ruRepeat = map[string]string{
	"daily": "ежедневно", "weekly": "еженедельно", "monthly": "ежемесячно", "yearly": "ежегодно",
}

var ruWeekdays = [...]string{"воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"}

// fmtWhen — человекочитаемый срок: «сегодня 18:00», «завтра», «05.08 09:30».
// Время 23:59 считаем меткой «весь день» и не показываем (так parseDue
// кодирует даты без времени).
func fmtWhen(t, now time.Time) string {
	t = t.In(now.Location())
	day := func(x time.Time) time.Time {
		return time.Date(x.Year(), x.Month(), x.Day(), 0, 0, 0, 0, x.Location())
	}
	var date string
	dt, dn := day(t), day(now)
	switch {
	case dt.Equal(dn):
		date = "сегодня"
	case dt.Equal(dn.AddDate(0, 0, 1)):
		date = "завтра"
	case dt.Equal(dn.AddDate(0, 0, -1)):
		date = "вчера"
	case t.Year() != now.Year():
		date = t.Format("02.01.2006")
	default:
		date = t.Format("02.01")
	}
	if t.Hour() == 23 && t.Minute() == 59 {
		return date
	}
	return date + " " + t.Format("15:04")
}

// taskLine — одна строка про задачу для вывода LLM.
func taskLine(t *models.Task, now time.Time, withNote bool) string {
	var b strings.Builder
	if t.Done {
		b.WriteString("✓ ")
	}
	fmt.Fprintf(&b, "[%s] %s", shortID(t.ID), t.Title)
	if t.DueAt != nil {
		b.WriteString(" — " + fmtWhen(*t.DueAt, now))
	}
	if t.Tag != "" {
		b.WriteString(" #" + t.Tag)
	}
	if t.Repeat != "" {
		b.WriteString(" ↻ " + ruRepeat[t.Repeat])
	}
	if n := len(t.Sub); n > 0 {
		done := 0
		for _, s := range t.Sub {
			if s.Done {
				done++
			}
		}
		fmt.Fprintf(&b, " (подзадачи %d/%d)", done, n)
	}
	if withNote && t.Note != "" {
		note := strings.Join(strings.Fields(t.Note), " ")
		if r := []rune(note); len(r) > 80 {
			note = string(r[:80]) + "…"
		}
		b.WriteString(" · " + note)
	}
	return b.String()
}

// ruWeekdayNames — распознавание дня недели по-русски (именительный и
// винительный: «пятница» / «в пятницу» → пятницу) и по-английски.
var weekdayNames = map[string]time.Weekday{
	"sunday": time.Sunday, "sun": time.Sunday, "воскресенье": time.Sunday,
	"monday": time.Monday, "mon": time.Monday, "понедельник": time.Monday,
	"tuesday": time.Tuesday, "tue": time.Tuesday, "вторник": time.Tuesday,
	"wednesday": time.Wednesday, "wed": time.Wednesday, "среда": time.Wednesday, "среду": time.Wednesday,
	"thursday": time.Thursday, "thu": time.Thursday, "четверг": time.Thursday,
	"friday": time.Friday, "fri": time.Friday, "пятница": time.Friday, "пятницу": time.Friday,
	"saturday": time.Saturday, "sat": time.Saturday, "суббота": time.Saturday, "субботу": time.Saturday,
}

var (
	dueTimeRe  = regexp.MustCompile(`\s+(\d{1,2}):(\d{2})$`)
	dueShiftRe = regexp.MustCompile(`^\+(\d{1,3})([dwдн])$`)
)

// parseDue разбирает срок из аргумента инструмента: ISO-даты, today/завтра,
// послезавтра, день недели («пятница» → ближайшая, сегодняшний день считается),
// сдвиги «+3d»/«+2w». Ко всем формам, кроме ISO с временем, можно дописать
// время: «пятница 15:00». Дата без времени превращается в конец дня (23:59) —
// «успеть до конца дня».
func parseDue(s string, now time.Time) (*time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, nil
	}
	loc := now.Location()

	// ISO-формы с временем — целиком, без выделения времени.
	for _, layout := range []string{time.RFC3339, "2006-01-02T15:04", "2006-01-02 15:04"} {
		if t, err := time.ParseInLocation(layout, s, loc); err == nil {
			return &t, nil
		}
	}

	// Опциональный хвост «HH:MM» после словесной формы или голой даты.
	datePart, hh, mm := s, 23, 59
	if m := dueTimeRe.FindStringSubmatch(s); m != nil {
		h, _ := strconv.Atoi(m[1])
		mi, _ := strconv.Atoi(m[2])
		if h < 24 && mi < 60 {
			datePart, hh, mm = strings.TrimSpace(s[:len(s)-len(m[0])]), h, mi
		}
	}
	at := func(t time.Time) *time.Time {
		v := time.Date(t.Year(), t.Month(), t.Day(), hh, mm, 0, 0, loc)
		return &v
	}

	if t, err := time.ParseInLocation("2006-01-02", datePart, loc); err == nil {
		return at(t), nil
	}

	word := strings.ToLower(datePart)
	switch word {
	case "today", "сегодня":
		return at(now), nil
	case "tomorrow", "завтра":
		return at(now.AddDate(0, 0, 1)), nil
	case "послезавтра":
		return at(now.AddDate(0, 0, 2)), nil
	}
	if wd, ok := weekdayNames[word]; ok {
		days := (int(wd) - int(now.Weekday()) + 7) % 7 // сегодняшний день — это сегодня
		return at(now.AddDate(0, 0, days)), nil
	}
	if m := dueShiftRe.FindStringSubmatch(word); m != nil {
		n, _ := strconv.Atoi(m[1])
		if m[2] == "w" || m[2] == "н" {
			n *= 7
		}
		return at(now.AddDate(0, 0, n)), nil
	}
	return nil, fmt.Errorf("не понял дату «%s»: нужен формат YYYY-MM-DD, \"YYYY-MM-DD HH:MM\", "+
		"today / tomorrow / послезавтра, день недели («пятница») или сдвиг «+3d»", s)
}

// ── инструменты ────────────────────────────────────────────────────

type listBoardsIn struct{}

func (h *Handler) mcpListBoards(ctx context.Context, req *mcp.CallToolRequest, in listBoardsIn) (*mcp.CallToolResult, any, error) {
	uid, err := uidFromCtx(ctx)
	if err != nil {
		return nil, nil, err
	}
	boards, err := h.userBoards(uid)
	if err != nil {
		return nil, nil, fmt.Errorf("db error: %w", err)
	}
	var b strings.Builder
	b.WriteString("Доски:\n")
	for _, board := range boards {
		var open int
		_ = h.db.QueryRow(
			"SELECT COUNT(*) FROM tasks WHERE board_id = ? AND done = 0 AND deleted_at IS NULL", board.ID,
		).Scan(&open)
		fmt.Fprintf(&b, "• %s — открытых задач: %d\n", board.Name, open)
	}
	return textResult(b.String()), nil, nil
}

type listTasksIn struct {
	Board  string `json:"board,omitempty" jsonschema:"название доски; пусто — все доски"`
	Filter string `json:"filter,omitempty" jsonschema:"open (по умолчанию), done или all"`
}

// boardTasks — задачи доски под фильтр open|done|all.
func (h *Handler) boardTasks(boardID, filter string) ([]*models.Task, error) {
	q := `SELECT ` + taskSelectCols + ` FROM tasks WHERE board_id = ? AND deleted_at IS NULL`
	switch filter {
	case "done":
		q += ` AND done = 1 ORDER BY completed_at DESC LIMIT 50`
	case "all":
		q += ` ORDER BY done ASC, position ASC LIMIT 100`
	default:
		q += ` AND done = 0 ORDER BY position ASC LIMIT 100`
	}
	rows, err := h.db.Query(q, boardID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*models.Task
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (h *Handler) mcpListTasks(ctx context.Context, req *mcp.CallToolRequest, in listTasksIn) (*mcp.CallToolResult, any, error) {
	uid, err := uidFromCtx(ctx)
	if err != nil {
		return nil, nil, err
	}
	filter := strings.ToLower(strings.TrimSpace(in.Filter))
	if filter != "done" && filter != "all" {
		filter = "open"
	}

	var boards []*models.Board
	if strings.TrimSpace(in.Board) != "" {
		b, err := h.resolveBoard(uid, in.Board)
		if err != nil {
			return nil, nil, err
		}
		boards = []*models.Board{b}
	} else if boards, err = h.userBoards(uid); err != nil {
		return nil, nil, fmt.Errorf("db error: %w", err)
	}

	now := time.Now()
	var b strings.Builder
	total := 0
	for _, board := range boards {
		tasks, err := h.boardTasks(board.ID, filter)
		if err != nil {
			return nil, nil, fmt.Errorf("db error: %w", err)
		}
		if len(tasks) == 0 {
			continue
		}
		total += len(tasks)
		fmt.Fprintf(&b, "Доска «%s»:\n", board.Name)
		for _, t := range tasks {
			b.WriteString(taskLine(t, now, true) + "\n")
		}
		b.WriteString("\n")
	}
	if total == 0 {
		switch filter {
		case "done":
			return textResult("Выполненных задач нет."), nil, nil
		default:
			return textResult("Открытых задач нет — всё сделано."), nil, nil
		}
	}
	return textResult(strings.TrimRight(b.String(), "\n")), nil, nil
}

type createTaskIn struct {
	Title  string `json:"title" jsonschema:"текст задачи"`
	Board  string `json:"board,omitempty" jsonschema:"название доски; пусто — первая доска"`
	Note   string `json:"note,omitempty" jsonschema:"заметка-описание"`
	Due    string `json:"due,omitempty" jsonschema:"срок: YYYY-MM-DD, today, tomorrow, день недели (friday) или +3d; можно с временем: friday 15:00"`
	Tag    string `json:"tag,omitempty" jsonschema:"короткий тег, например быт или работа"`
	Repeat string `json:"repeat,omitempty" jsonschema:"повторение: daily, weekly, monthly или yearly"`
}

func (h *Handler) mcpCreateTask(ctx context.Context, req *mcp.CallToolRequest, in createTaskIn) (*mcp.CallToolResult, any, error) {
	uid, err := uidFromCtx(ctx)
	if err != nil {
		return nil, nil, err
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return nil, nil, fmt.Errorf("title обязателен")
	}
	board, err := h.resolveBoard(uid, in.Board)
	if err != nil {
		return nil, nil, err
	}
	now := time.Now()
	due, err := parseDue(in.Due, now)
	if err != nil {
		return nil, nil, err
	}
	repeat := strings.ToLower(strings.TrimSpace(in.Repeat))
	if repeat != "" && !models.AllowedRepeats[repeat] {
		return nil, nil, fmt.Errorf("repeat может быть daily, weekly, monthly или yearly")
	}

	// Как в веб-версии: новая задача — в начало доски.
	var minPos sql.NullFloat64
	_ = h.db.QueryRow("SELECT MIN(position) FROM tasks WHERE board_id = ? AND deleted_at IS NULL", board.ID).Scan(&minPos)
	pos := 1024.0
	if minPos.Valid {
		pos = minPos.Float64 - 1024
	}

	id := uuid.NewString()
	var dueVal interface{}
	if due != nil {
		dueVal = *due
	}
	if _, err := h.db.Exec(`
		INSERT INTO tasks (id, user_id, board_id, title, note, color, size, tag, done, position, due_at, recurrence)
		VALUES (?, ?, ?, ?, ?, 'indigo', 's', ?, 0, ?, ?, ?)`,
		id, uid, board.ID, title, nullIfEmpty(strings.TrimSpace(in.Note)), nullIfEmpty(strings.TrimSpace(in.Tag)),
		pos, dueVal, nullIfEmpty(repeat),
	); err != nil {
		return nil, nil, fmt.Errorf("insert error: %w", err)
	}

	msg := fmt.Sprintf("Создано: [%s] %s — доска «%s»", shortID(id), title, board.Name)
	if due != nil {
		msg += ", срок " + fmtWhen(*due, now)
	}
	if repeat != "" {
		msg += ", ↻ " + ruRepeat[repeat]
	}
	return textResult(msg), nil, nil
}

type taskRefIn struct {
	Task string `json:"task" jsonschema:"id задачи из list_tasks, например a3f2c1"`
}

func (h *Handler) mcpCompleteTask(ctx context.Context, req *mcp.CallToolRequest, in taskRefIn) (*mcp.CallToolResult, any, error) {
	uid, err := uidFromCtx(ctx)
	if err != nil {
		return nil, nil, err
	}
	t, err := h.resolveTask(uid, in.Task)
	if err != nil {
		return nil, nil, err
	}

	now := time.Now()
	// Повторяющаяся задача не закрывается, а уезжает на следующий срок —
	// та же логика, что в PatchTask.
	if t.Repeat != "" {
		next := nextOccurrence(t.DueAt, t.Repeat, time.Now().UTC())
		if _, err := h.db.Exec(
			"UPDATE tasks SET due_at = ?, done = 0, completed_at = NULL WHERE id = ?", next, t.ID,
		); err != nil {
			return nil, nil, fmt.Errorf("update error: %w", err)
		}
		return textResult(fmt.Sprintf(
			"«%s» повторяется (%s) — перенёс на %s.", t.Title, ruRepeat[t.Repeat], fmtWhen(next, now),
		)), nil, nil
	}

	if t.Done {
		return textResult(fmt.Sprintf("«%s» уже выполнена.", t.Title)), nil, nil
	}
	if _, err := h.db.Exec(
		"UPDATE tasks SET done = 1, completed_at = CURRENT_TIMESTAMP WHERE id = ?", t.ID,
	); err != nil {
		return nil, nil, fmt.Errorf("update error: %w", err)
	}
	return textResult(fmt.Sprintf("Готово: «%s» выполнена.", t.Title)), nil, nil
}

type updateTaskIn struct {
	Task   string `json:"task" jsonschema:"id задачи из list_tasks"`
	Title  string `json:"title,omitempty" jsonschema:"новый заголовок"`
	Note   string `json:"note,omitempty" jsonschema:"новая заметка; none — убрать"`
	Due    string `json:"due,omitempty" jsonschema:"новый срок (YYYY-MM-DD, tomorrow, friday, +3d); none — убрать срок"`
	Tag    string `json:"tag,omitempty" jsonschema:"новый тег; none — убрать"`
	Repeat string `json:"repeat,omitempty" jsonschema:"daily, weekly, monthly, yearly; none — не повторять"`
}

func isNone(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "none", "нет", "null", "убрать":
		return true
	}
	return false
}

func (h *Handler) mcpUpdateTask(ctx context.Context, req *mcp.CallToolRequest, in updateTaskIn) (*mcp.CallToolResult, any, error) {
	uid, err := uidFromCtx(ctx)
	if err != nil {
		return nil, nil, err
	}
	t, err := h.resolveTask(uid, in.Task)
	if err != nil {
		return nil, nil, err
	}

	now := time.Now()
	sets := []string{}
	args := []interface{}{}

	if s := strings.TrimSpace(in.Title); s != "" {
		sets, args = append(sets, "title = ?"), append(args, s)
	}
	if in.Note != "" {
		sets = append(sets, "note = ?")
		if isNone(in.Note) {
			args = append(args, nil)
		} else {
			args = append(args, in.Note)
		}
	}
	if in.Due != "" {
		if isNone(in.Due) {
			sets = append(sets, "due_at = NULL")
		} else {
			due, err := parseDue(in.Due, now)
			if err != nil {
				return nil, nil, err
			}
			sets, args = append(sets, "due_at = ?"), append(args, *due)
		}
	}
	if in.Tag != "" {
		sets = append(sets, "tag = ?")
		if isNone(in.Tag) {
			args = append(args, nil)
		} else {
			args = append(args, strings.TrimSpace(in.Tag))
		}
	}
	if in.Repeat != "" {
		r := strings.ToLower(strings.TrimSpace(in.Repeat))
		if isNone(r) {
			sets = append(sets, "recurrence = NULL")
		} else if models.AllowedRepeats[r] {
			sets, args = append(sets, "recurrence = ?"), append(args, r)
		} else {
			return nil, nil, fmt.Errorf("repeat может быть daily, weekly, monthly, yearly или none")
		}
	}
	if len(sets) == 0 {
		return nil, nil, fmt.Errorf("нечего менять: передай title, note, due, tag или repeat")
	}

	args = append(args, t.ID)
	if _, err := h.db.Exec("UPDATE tasks SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...); err != nil {
		return nil, nil, fmt.Errorf("update error: %w", err)
	}

	fresh, err := h.getTask(t.BoardID, t.ID)
	if err != nil {
		return nil, nil, fmt.Errorf("fetch error: %w", err)
	}
	return textResult("Обновлено: " + taskLine(fresh, now, true)), nil, nil
}

type agendaIn struct {
	Date string `json:"date,omitempty" jsonschema:"дата YYYY-MM-DD; пусто — сегодня"`
}

func (h *Handler) mcpTodayAgenda(ctx context.Context, req *mcp.CallToolRequest, in agendaIn) (*mcp.CallToolResult, any, error) {
	uid, err := uidFromCtx(ctx)
	if err != nil {
		return nil, nil, err
	}
	now := time.Now()
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	if s := strings.TrimSpace(in.Date); s != "" {
		d, err := time.ParseInLocation("2006-01-02", s, now.Location())
		if err != nil {
			return nil, nil, fmt.Errorf("не понял дату «%s»: нужен формат YYYY-MM-DD", s)
		}
		day = d
	}
	dayEnd := day.AddDate(0, 0, 1)

	boards, err := h.userBoards(uid)
	if err != nil {
		return nil, nil, fmt.Errorf("db error: %w", err)
	}

	type item struct {
		t     *models.Task
		board string
	}
	var todays, overdue []item
	noDue := 0
	for _, board := range boards {
		rows, err := h.db.Query(
			`SELECT `+taskSelectCols+` FROM tasks
			 WHERE board_id = ? AND deleted_at IS NULL AND done = 0 AND due_at IS NOT NULL AND due_at < ?
			 ORDER BY due_at ASC`, board.ID, dayEnd,
		)
		if err != nil {
			return nil, nil, fmt.Errorf("db error: %w", err)
		}
		for rows.Next() {
			t, err := scanTask(rows)
			if err != nil {
				rows.Close()
				return nil, nil, fmt.Errorf("scan error: %w", err)
			}
			it := item{t, board.Name}
			if t.DueAt.In(now.Location()).Before(day) {
				overdue = append(overdue, it)
			} else {
				todays = append(todays, it)
			}
		}
		rows.Close()

		var n int
		_ = h.db.QueryRow(
			"SELECT COUNT(*) FROM tasks WHERE board_id = ? AND deleted_at IS NULL AND done = 0 AND due_at IS NULL",
			board.ID,
		).Scan(&n)
		noDue += n
	}

	var b strings.Builder
	fmt.Fprintf(&b, "Агенда на %s, %s:\n", ruWeekdays[day.Weekday()], day.Format("02.01.2006"))
	if len(todays) == 0 && len(overdue) == 0 {
		b.WriteString("Задач со сроком на этот день нет, просроченного тоже.\n")
	}
	if len(todays) > 0 {
		b.WriteString("\nНа этот день:\n")
		for _, it := range todays {
			fmt.Fprintf(&b, "• %s (%s)\n", taskLine(it.t, now, false), it.board)
		}
	}
	if len(overdue) > 0 {
		b.WriteString("\nПросрочено:\n")
		for _, it := range overdue {
			fmt.Fprintf(&b, "• %s (%s)\n", taskLine(it.t, now, false), it.board)
		}
	}
	if noDue > 0 {
		fmt.Fprintf(&b, "\nЕщё %d открытых задач без срока — см. list_tasks.\n", noDue)
	}
	return textResult(strings.TrimRight(b.String(), "\n")), nil, nil
}
