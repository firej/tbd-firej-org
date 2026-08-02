# tobedone

Веб-приложение со списком дел в виде плиток-плашек. Go-бекенд + HTMX-фронт + MariaDB.

## Что внутри

- **Стек:** Go 1.25, `gorilla/mux`, `gorilla/sessions`, `bcrypt`, `go-sql-driver/mysql`, `uuid`.
- **Фронт:** ванильный JS + SortableJS для drag-and-drop. HTML-шаблоны на `html/template`. Никаких сборщиков.
- **БД:** MariaDB 11. Таблицы: `users`, `boards`, `board_members`, `tasks` (с JSON-колонкой `sub`,
  `position DOUBLE` и `board_id` — задача живёт на доске, доступ через `board_members`).
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
│   └── handlers/             — auth, tasks, boards, tokens, mcp, app (страница)
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

- `POST /auth/signup` — `{ email, password, display_name }` → `{ user }` + cookie. При регистрации
  заводится дефолтная доска «Личное».
- `POST /auth/login`  — `{ email, password }` → `{ user }` + cookie.
- `POST /auth/logout` — очистить сессию.
- `GET  /auth/me`     — `{ user }` если залогинен.

### Доски / шаринг (требует cookie-сессии)

Задача принадлежит **доске** (пространству), а не пользователю напрямую. Доступ — через членство
в доске (`board_members`). Любой участник имеет полный доступ к задачам; управлять доской
(переименовать, удалить, добавлять/убирать участников) может только владелец.

- `GET    /api/boards`                       → `{ boards: [...] }`, где юзер участник; у каждой `is_owner`.
- `POST   /api/boards`                       — `{ name, color }` создать доску (создатель — владелец).
- `PATCH  /api/boards/{bid}`                 — `{ name?, color?, position? }` (только владелец).
- `DELETE /api/boards/{bid}`                 — удалить (только владелец; нельзя удалить последнюю доску).
- `GET    /api/boards/{bid}/members`         → `{ members: [...] }`.
- `POST   /api/boards/{bid}/members`         — `{ email }` добавить существующего юзера (только владелец).
- `DELETE /api/boards/{bid}/members/{uid}`   — убрать участника (владелец — любого; участник — себя = «покинуть»).

### Task API (всё под доской, требует членства в `{bid}`)

- `GET    /api/boards/{bid}/tasks`                 → `{ tasks: [...] }`, отсортированы по `position ASC`.
- `POST   /api/boards/{bid}/tasks`                 — создать.
- `PATCH  /api/boards/{bid}/tasks/{id}`            — частичное обновление (любое подмножество полей).
  Поле `repeat` (`daily | weekly | monthly | yearly | ""`) делает задачу повторяющейся:
  `PATCH { done: true }` для неё не закрывает задачу, а переносит `due_at` на следующее
  наступление (строго в будущем; в БД колонка называется `recurrence` — `repeat` зарезервирован).
- `DELETE /api/boards/{bid}/tasks/{id}`            — удалить.
- `POST   /api/boards/{bid}/tasks/{id}/reorder`    — `{ before?: id, after?: id }`, серверный пересчёт `position`.
- `POST   /api/boards/{bid}/tasks/sync`            — `{ since?, changes: [{ op: upsert|delete, id?, task? }] }` → `{ server_changes, server_time, conflicts }`. LWW по `updated_at`.

### API-токены (для MCP и ботов)

Программный доступ — не по cookie, а по Bearer-токену. Токен показывается один раз
при создании (в БД хранится только SHA-256).

- `GET    /api/tokens`      → `{ tokens: [...] }` (без самих токенов).
- `POST   /api/tokens`      — `{ name }` → `{ token: { token: "tbd_...", ... } }`.
- `DELETE /api/tokens/{id}` — отозвать.

Выпустить токен из консоли (cookie берётся логином):

```bash
curl -c /tmp/tbd.cookies -X POST https://tbd.firej.org/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"...","password":"..."}'
curl -b /tmp/tbd.cookies -X POST https://tbd.firej.org/api/tokens \
  -H 'Content-Type: application/json' -d '{"name":"telegram-bot"}'
```

## MCP API

Эндпоинт `POST /mcp` — [MCP](https://modelcontextprotocol.io) поверх streamable HTTP
(stateless, официальный `modelcontextprotocol/go-sdk`). Авторизация:
`Authorization: Bearer <токен из /api/tokens>`. Часовой пояс «сегодня/завтра» задаётся
переменной `TZ` контейнера (tzdata вкомпилена).

Инструменты нарочно простые — рассчитаны на дешёвые LLM в связке с ботом:

| Инструмент      | Аргументы                                   | Что делает |
|-----------------|---------------------------------------------|------------|
| `list_boards`   | —                                           | Доски + число открытых задач |
| `list_tasks`    | `board?`, `filter?` (`open`/`done`/`all`)   | Задачи в порядке приоритета, с короткими id |
| `create_task`   | `title`, `board?`, `note?`, `due?`, `tag?`, `repeat?` | Создать наверху доски |
| `complete_task` | `task` (короткий id)                        | Выполнить; повторяющуюся — перенести на следующий срок |
| `update_task`   | `task`, `title?`, `note?`, `due?`, `tag?`, `repeat?` (`none` — убрать) | Частичное обновление |
| `today_agenda`  | `date?` (`YYYY-MM-DD`)                      | План на день + просроченное — готовый утренний дайджест |

Соглашения: задачи адресуются **коротким id** (первые 6 символов uuid, печатаются в
`[скобках]`); даты — `YYYY-MM-DD`, `YYYY-MM-DD HH:MM`, `today`/`tomorrow`; доска — по
названию (без регистра, можно кусок). Дата без времени = конец дня (23:59). Все ответы —
человекочитаемый текст, ошибки подсказывают следующий шаг (само-коррекция LLM).

Подключить, например, к Claude Code:

```bash
claude mcp add tobedone --transport http https://tbd.firej.org/mcp --header "Authorization: Bearer tbd_..."
```

## Telegram-бот

`cmd/bot` — мульти-юзерный бот: свободный текст → дешёвая LLM (любой
OpenAI-совместимый endpoint) → MCP-инструменты выше. `/today` и прочие команды
работают без LLM. План и архитектура — [docs/bot-plan.md](docs/bot-plan.md).

Привязка аккаунта: меню профиля в вебе → «Подключить Telegram» → deep link
с одноразовым кодом (`link_codes`, TTL 10 минут) → бот меняет код на API-токен
через `POST /api/telegram/exchange`. Привязки живут в sqlite бота (volume).

ENV бота (локально — `.env.bot`, `make run-bot`):

| Переменная         | По умолчанию                    | Что значит |
|--------------------|---------------------------------|------------|
| `TELEGRAM_TOKEN`   | — (обязателен)                  | токен из BotFather |
| `MCP_URL`          | `http://localhost:8080/mcp`     | MCP-эндпоинт tobedone |
| `EXCHANGE_URL`     | `http://localhost:8080/api/telegram/exchange` | обмен кода привязки |
| `BOT_DB`           | `bot.sqlite`                    | файл sqlite |
| `LLM_BASE_URL`     | `''` (LLM выключена)            | напр. `https://api.deepseek.com/v1` |
| `LLM_API_KEY`      | —                               | |
| `LLM_MODEL`        | `deepseek-chat`                 | |
| `DAILY_LIMIT`      | `50`                            | LLM-сообщений на юзера в день |
| `GLOBAL_DAILY_LIMIT` | `500`                         | стоп-кран на всех |
| `OWNER_CHAT_ID`    | `0`                             | алерты и `/stats` |
| `DEFAULT_TZ`       | `Europe/Moscow`                 | пояс юзера до `/tz` |
| `TELEGRAM_API_URL` | api.telegram.org                | переопределяется в тестах |

Серверу для deep-link кнопки нужен `TELEGRAM_BOT_USERNAME` (username бота без @).
В проде бот — сервис `bot` в compose (см. `docker-compose.prod.yml`), собирается
из `Dockerfile.bot`, наружу ничего не открывает.

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
