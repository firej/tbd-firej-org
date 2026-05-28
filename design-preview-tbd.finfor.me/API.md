# tobedone — спецификация для бекенда

Данные и контракты, которые описывает фронт-прототип. Достаточно для MVP.

---

## 1. Модели данных

### User
```ts
type User = {
  id: string;              // uuid
  email: string;           // unique
  password_hash: string;   // bcrypt / argon2
  display_name: string;
  avatar_color?: string;   // hex; для аватарки-инициалов
  created_at: ISODate;
  updated_at: ISODate;
};
```

### Task
```ts
type Task = {
  id: string;              // uuid
  user_id: string;         // FK -> User.id
  title: string;
  note?: string;
  color: 'terra' | 'indigo' | 'olive' | 'mustard' | 'rose' | 'clay';
  size:  's' | 'm' | 'wide' | 'l';   // визуальный размер в бенто
  tag?:  string;           // 'Работа' | 'Личное' | 'Дом' | 'Спорт' | ...
  done: boolean;
  position: number;        // float — для DnD сортировки (см. ниже)
  created_at: ISODate;
  due_at: ISODate | null;
  completed_at?: ISODate | null;
  sub?: SubTask[];
};

type SubTask = {
  id: string;
  text: string;
  done: boolean;
};
```

**Про `position`:** использовать дробное число (float). При перетаскивании между задачами A (pos=1.0) и B (pos=2.0) новая позиция = `(1.0 + 2.0)/2 = 1.5`. Это избавляет от ребиндинга всех соседей при каждом drop. Раз в N драгов делать background-задачу на «нормализацию» позиций.

**Heat / прогресс-бар** — вычисляется на клиенте из `created_at` и `due_at`. Бекенд не хранит.

---

## 2. Auth endpoints

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| `POST` | `/auth/signup` | `{ email, password, display_name }` | `{ user, token }` |
| `POST` | `/auth/login`  | `{ email, password }` | `{ user, token }` |
| `POST` | `/auth/logout` | — | `204` |
| `GET`  | `/auth/me`     | — | `{ user }` |

Токен — JWT в `Authorization: Bearer <token>` или httpOnly cookie. Refresh не критичен для MVP.

---

## 3. Task endpoints

| Метод | Путь | Назначение |
|---|---|---|
| `GET`    | `/tasks` | список всех задач юзера (сортировка по `position` asc) |
| `POST`   | `/tasks` | создать (см. тело ниже) |
| `PATCH`  | `/tasks/:id` | частичное обновление (title, note, color, size, tag, done, due_at, position) |
| `DELETE` | `/tasks/:id` | удалить |
| `POST`   | `/tasks/:id/reorder` | `{ before?: id, after?: id }` — серверный пересчёт `position` |
| `POST`   | `/tasks/sync` | bulk-синк (см. секцию Sync) |

### POST /tasks — тело
```json
{
  "title": "Купить молоко",
  "note": "",
  "color": "olive",
  "size": "s",
  "tag": "Дом",
  "due_at": "2026-06-01T20:00:00Z",
  "position": 1000
}
```

---

## 4. Sync (offline-first)

Фронт хранит локальный кэш (IndexedDB / localStorage) и работает оффлайн. Топбар показывает 4 состояния: `synced` · `syncing` · `offline` · `error`.

### Простой подход: pull + push
```
POST /tasks/sync
{
  "since": "2026-05-27T10:00:00Z",
  "changes": [
    { "op": "upsert", "task": { ... } },
    { "op": "delete", "id": "..." }
  ]
}

→ {
  "server_changes": [ { "op": "upsert", "task": { ... } }, ... ],
  "server_time":    "2026-05-27T10:05:00Z",
  "conflicts": []
}
```

**Конфликты:** last-write-wins по `updated_at`. Для MVP этого достаточно. Если хотите CRDT — добавьте `version` (Lamport-clock) на задачу.

**Real-time (опционально):** WebSocket `/ws` шлёт `{ type: 'task.updated', task }` другим устройствам того же юзера. Если не делаете — фронт пуллит `/tasks/sync` каждые 15–30 сек, когда вкладка активна.

---

## 5. Стек, который хорошо ляжет на это

- **API:** Node (Fastify / Hono) или Go (chi) — лёгкие, быстрый JSON, не страшно деплоить
- **БД:** Postgres (`tasks` + `users`, индекс по `(user_id, position)`)
- **Auth:** `argon2` для хешей, JWT в httpOnly cookie или sessions в Redis
- **Sync:** простой pull/push API + ETag/`updated_at`. Для real-time — `socket.io` или нативный ws.
- **Хостинг:** Fly / Railway / Hetzner. PG — Neon/Supabase, если не хочется админить.

---

## 6. Чего нет на фронте, но стоит сразу заложить

- `archive` flag на задаче (мягкое удаление)
- `recurrence` (повторяющиеся задачи) — `rrule` строка
- `assignee_id` если планируется шеринг
- Push-уведомления о приближении дедлайна (cron + Web Push / APNs)
- Аналитика «сколько закрыл за неделю»

---

Что вы получите в архиве:
- `tobedone.html` — design canvas со всеми артбордами
- `demo.html` — кликабельная демка
- `src/` — модульный React-код прототипа
- `themes.css` — токены палитры/типографики
- `API.md` — этот файл
