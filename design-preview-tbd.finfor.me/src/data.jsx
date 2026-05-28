// Mock task data. Deadlines computed relative to "now" so the heat-meter looks alive.
// All sizes from { 's','m','l','wide' } -- bento grid uses dense pack.

const NOW = Date.now();
const HOUR = 3600_000;
const DAY = HOUR * 24;

// helper: a task created `createdHoursAgo` ago, due in `dueInHours`
function tk({ id, title, note, color, size, createdHoursAgo, dueInHours, done = false, sub = [], tag }) {
  const created = NOW - createdHoursAgo * HOUR;
  const due = NOW + dueInHours * HOUR;
  return { id, title, note, color, size, created, due, done, sub, tag };
}

window.MOCK_TASKS = [
  tk({ id: 't1', title: 'Подготовить презентацию для совета', note: 'Слайды + цифры за Q2', color: 'terra',   size: 'l',
       tag: 'Работа',     createdHoursAgo: 36,  dueInHours: 6,
       sub: [{ id: 's1', text: 'Слайды по росту', done: true },
             { id: 's2', text: 'Сценарий', done: true },
             { id: 's3', text: 'Прогон', done: false }] }),

  tk({ id: 't2', title: 'Записаться к стоматологу', color: 'mustard', size: 's',
       tag: 'Личное',     createdHoursAgo: 100, dueInHours: 18 }),

  tk({ id: 't3', title: 'Прочитать главу о привычках', note: 'Atomic Habits, гл. 4', color: 'olive',   size: 'm',
       tag: 'Чтение',     createdHoursAgo: 12,  dueInHours: 72 }),

  tk({ id: 't4', title: 'Купить подарок маме', note: 'Что-то домашнее, не цветы', color: 'rose',  size: 's',
       tag: 'Дом',        createdHoursAgo: 200, dueInHours: 26 }),

  tk({ id: 't5', title: 'Финальный созвон с дизайнером', color: 'indigo',  size: 'wide',
       tag: 'Работа',     createdHoursAgo: 4,   dueInHours: 28,
       sub: [{ id: 's4', text: 'Подготовить вопросы', done: false }] }),

  tk({ id: 't6', title: 'Полить растения', color: 'olive',   size: 's',
       tag: 'Дом',        createdHoursAgo: 24,  dueInHours: 12 }),

  tk({ id: 't7', title: 'Накидать черновик статьи', note: 'про утренние ритуалы',  color: 'clay',  size: 'm',
       tag: 'Письмо',     createdHoursAgo: 60,  dueInHours: 96 }),

  tk({ id: 't8', title: 'Пробежка 5к', color: 'terra',   size: 's',
       tag: 'Спорт',      createdHoursAgo: 6,   dueInHours: 3 }),

  tk({ id: 't9', title: 'Разобрать почту', color: 'indigo',  size: 's',
       tag: 'Работа',     createdHoursAgo: 2,   dueInHours: 5 }),

  tk({ id: 't10', title: 'Спланировать поездку в Грузию', note: 'маршрут + жильё', color: 'mustard',  size: 'm',
       tag: 'Путешествия', createdHoursAgo: 300, dueInHours: 240 }),
];

// derive heat: 0 = lots of time, 1 = overdue
window.heatOf = function heatOf(task, now = Date.now()) {
  const total = task.due - task.created;
  if (total <= 0) return 1;
  const elapsed = now - task.created;
  const ratio = Math.max(0, Math.min(1, elapsed / total));
  return ratio;
};

window.formatDue = function formatDue(due, now = Date.now()) {
  const diff = due - now;
  const abs = Math.abs(diff);
  const sign = diff < 0 ? -1 : 1;
  if (abs < HOUR) {
    const m = Math.round(abs / 60000);
    return sign < 0 ? `просрочено ${m}мин` : `через ${m}мин`;
  }
  if (abs < DAY) {
    const h = Math.round(abs / HOUR);
    return sign < 0 ? `просрочено ${h}ч` : `через ${h}ч`;
  }
  const d = Math.round(abs / DAY);
  return sign < 0 ? `просрочено ${d}д` : `через ${d}д`;
};

window.formatDueShort = function formatDueShort(due, now = Date.now()) {
  const diff = due - now;
  const abs = Math.abs(diff);
  const sign = diff < 0 ? '-' : '';
  if (abs < HOUR) return `${sign}${Math.round(abs / 60000)}м`;
  if (abs < DAY)  return `${sign}${Math.round(abs / HOUR)}ч`;
  return `${sign}${Math.round(abs / DAY)}д`;
};
