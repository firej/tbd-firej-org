# tobedone

Веб-приложение со списком дел в виде плиток-плашек. Go-бекенд + HTMX-фронт + MariaDB.

## Что внутри

- **Стек:** Go 1.25, `gorilla/mux`, `gorilla/sessions`, `bcrypt`, `go-sql-driver/mysql`, `uuid`.
- **Фронт:** ванильный JS + SortableJS для drag-and-drop. HTML-шаблоны на `html/template`. Никаких сборщиков.
- **БД:** MariaDB 11. Таблицы: `users`, `tasks` (с JSON-колонкой `sub` и `position DOUBLE`).
- **Тема:** Paper из прототипа в `design-preview-tbd.firej.org/` (Direction A). Тёмная — toggle в топбаре.
- **Sync:** локальный кэш в `localStorage` + очередь pending-операций. Топбар показывает 4 состояния: `synced` / `syncing` / `offline` / `error`. При возвращении сети — автоматический flush очереди и pull.

## Структура

```
.
├── cmd/server/main.go        — точка входа, роутер
├── internal/
│   ├── config/               — ENV-конфиг
│   ├── database/             — init + миграции
│   ├── models/               — User, Task, SubTask
│   └── handlers/             — auth, tasks, app (страница)
├── templates/                — login.html, signup.html, app.html
├── static/
│   ├── theme-paper.css       — токены и paper-тема из прототипа
│   ├── app.css               — структурные стили (топбар, грид, плитки, модалка)
│   └── app.js                — клиентская логика (sync, DnD, CRUD)
├── design-preview-tbd.firej.org/  — реф-прототип (не трогать)
├── Dockerfile / docker-compose.yml / docker-compose.prod.yml
└── Makefile
```

## Быстрый старт (локально)

Нужны: Go 1.25+, Docker (либо podman) с docker-compose.

```bash
make dev    # поднимет MariaDB в docker и запустит `go run` локально
```

Открой http://localhost:8080 — попадёшь на `/login`. Кнопка «Зарегистрироваться» создаёт аккаунт.

Альтернативы:
- `make up` — поднять и app, и mariadb в docker.
- `make db-only` + `make run` — те же два шага вручную.
- `make build` — собрать бинарь в `bin/tobedone`.

## ENV

Все настройки — через переменные окружения. Локально читаются из `.env.local` (см. `Makefile run`).

| Переменная        | По умолчанию                                                        | Что значит                          |
|-------------------|---------------------------------------------------------------------|-------------------------------------|
| `PORT`            | `8080`                                                              | Порт HTTP                            |
| `DATABASE_DSN`    | `tobedone:tobedone@tcp(localhost:3306)/tobedone?parseTime=true&...` | DSN MariaDB                          |
| `SESSION_SECRET`  | `change-me-in-production`                                           | Ключ для cookie-сессии (`gorilla/sessions`) |
| `SECURE_COOKIE`   | `false`                                                             | `true` за HTTPS (прод)               |

## Эндпоинты

### HTML

- `GET /` — главный экран (требует авторизации, иначе → `/login`).
- `GET /login`, `GET /signup` — формы.

### Auth API (`Content-Type: application/json` или form-urlencoded)

- `POST /auth/signup` — `{ email, password, display_name }` → `{ user }` + cookie.
- `POST /auth/login`  — `{ email, password }` → `{ user }` + cookie.
- `POST /auth/logout` — очистить сессию.
- `GET  /auth/me`     — `{ user }` если залогинен.

### Task API (требует cookie-сессии)

- `GET    /api/tasks`                 → `{ tasks: [...] }`, отсортированы по `position ASC`.
- `POST   /api/tasks`                 — создать.
- `PATCH  /api/tasks/{id}`            — частичное обновление (любое подмножество полей).
  Поле `repeat` (`daily | weekly | monthly | yearly | ""`) делает задачу повторяющейся:
  `PATCH { done: true }` для неё не закрывает задачу, а переносит `due_at` на следующее
  наступление (строго в будущем; в БД колонка называется `recurrence` — `repeat` зарезервирован).
- `DELETE /api/tasks/{id}`            — удалить.
- `POST   /api/tasks/{id}/reorder`    — `{ before?: id, after?: id }`, серверный пересчёт `position`.
- `POST   /api/tasks/sync`            — `{ since?, changes: [{ op: upsert|delete, id?, task? }] }` → `{ server_changes, server_time, conflicts }`. LWW по `updated_at`.

## Деплой

По образцу finforme:

```bash
make deploy
```

Сделает `rsync` исходников на `firej@firej.org:/opt/tobedone`, соберёт там образ `tobedone:latest` и перезапустит сервис из `/opt/traefik/docker-compose.yml`.

Перед первым деплоем нужно:
1. На проде в `/opt/traefik/docker-compose.yml` добавить сервис `tobedone` (см. `docker-compose.prod.yml` — там готовый сниппет с Traefik-лейблами на `tbd.firej.org`).
2. Завести БД и пользователя в существующем mariadb-контейнере:
   ```sql
   CREATE DATABASE tobedone CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'tobedone'@'%' IDENTIFIED BY '<пароль>';
   GRANT ALL ON tobedone.* TO 'tobedone'@'%';
   FLUSH PRIVILEGES;
   ```
3. Прописать на сервере в `.env` рядом с `/opt/traefik/docker-compose.yml`:
   ```
   DATABASE_DSN=tobedone:<пароль>@tcp(mariadb:3306)/tobedone?parseTime=true&charset=utf8mb4
   SESSION_SECRET=<openssl rand -hex 32>
   ```

## Дизайн-референс

Папка `design-preview-tbd.firej.org/` — React-прототип со всей версткой. Файлы:
- `API.md` — спецификация бекенда (по ней сделано API).
- `themes.css` — токены трёх тем (используется paper).
- `src/*.jsx` — компоненты: `tile.jsx`, `tasklist.jsx`, `sync.jsx`, `topbar.jsx`, `app.jsx`, `data.jsx`.
- `demo.html` — кликабельная демка, можно открыть как статику.
