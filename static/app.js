/* ============================================================
   tobedone — клиентская логика.
   Архитектура:
     • Локальный кэш задач в localStorage (ключ TASKS_KEY).
     • Sync state machine: synced ↔ syncing ↔ offline ↔ error.
     • При любом действии — оптимистичный апдейт кэша + fetch,
       при ошибке/оффлайне действие попадает в очередь PENDING_KEY.
     • Очередь повторно пушится либо при возвращении сети, либо
       раз в 20 секунд по таймеру.
   ============================================================ */

(function () {
  'use strict';

  // ── константы ─────────────────────────────────────────────
  // Кэш задач и времени последнего синка — пер-доска (ключ + boardId).
  const TASKS_PREFIX     = 'tbd.tasks.v1.';
  const LAST_SYNC_PREFIX = 'tbd.lastSync.v1.';
  const PENDING_KEY       = 'tbd.pending.v1';      // одна очередь; в actions хранится полный path с boardId
  const BOARDS_KEY        = 'tbd.boards.v1';        // кэш списка досок
  const CURRENT_BOARD_KEY = 'tbd.currentBoard.v1';  // id выбранной доски
  const THEME_KEY   = 'theme';

  const HOUR = 3600_000;
  const DAY  = HOUR * 24;

  const COLORS = ['terra', 'indigo', 'olive', 'mustard', 'rose', 'clay'];
  const SIZES  = ['s', 'm', 'wide', 'l'];

  const REPEAT_LABELS = {
    daily:   'каждый день',
    weekly:  'каждую неделю',
    monthly: 'каждый месяц',
    yearly:  'каждый год',
  };
  // приблизительная длина периода — только для расчёта "жара" плитки
  const REPEAT_MS = { daily: DAY, weekly: DAY * 7, monthly: DAY * 30, yearly: DAY * 365 };

  // выполненная карточка уезжает вниз не сразу — даём время передумать
  const SINK_DELAY_MS = 3000;
  // выполненные дольше этого срока удаляются при заходе на страницу
  const DONE_TTL_MS = DAY * 7;

  // ── состояние ─────────────────────────────────────────────
  let boards = loadBoardsCache();
  let currentBoardId = localStorage.getItem(CURRENT_BOARD_KEY) || (boards[0] && boards[0].id) || null;
  let tasks = currentBoardId ? loadCache(currentBoardId) : [];
  let pending = loadPending();
  let editingId = null;     // id задачи, редактируемой в модалке (или null)
  let createAtEnd = false;  // true — модалка открыта с плюс-плитки, новая задача встаёт в конец
  let syncState = 'synced'; // synced | syncing | offline | error
  let syncTimer = null;
  let dragJustEnded = 0;    // timestamp окончания drag — используем чтобы не открывать модалку по синтетическому click'у Sortable'а
  let inFlightCreates = 0;  // счётчик незавершённых POST /api/tasks — пока > 0, pullAll не сметает кэш

  // ── helpers ───────────────────────────────────────────────
  function uuid() {
    // RFC4122 v4 fallback (если crypto.randomUUID нет — на iOS<15)
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function tasksKey(bid) { return TASKS_PREFIX + bid; }
  function loadCache(bid) {
    try { return JSON.parse(localStorage.getItem(tasksKey(bid)) || '[]'); }
    catch (e) { return []; }
  }
  function saveCache() {
    if (currentBoardId) localStorage.setItem(tasksKey(currentBoardId), JSON.stringify(tasks));
  }
  function loadBoardsCache() {
    try { return JSON.parse(localStorage.getItem(BOARDS_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function saveBoardsCache() {
    localStorage.setItem(BOARDS_KEY, JSON.stringify(boards));
  }
  // Полный путь к API текущей доски: boardPath('/tasks'), boardPath('/tasks/'+id) и т.п.
  function boardPath(suffix) { return '/api/boards/' + currentBoardId + (suffix || ''); }
  function loadPending() {
    try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function savePending() {
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  }

  // ── sync indicator ────────────────────────────────────────
  function setSyncState(state) {
    syncState = state;
    const btn   = document.getElementById('sync-btn');
    const bubble = document.querySelector('.sync-bubble');
    const icon  = document.getElementById('sync-icon');
    const label = document.getElementById('sync-label');
    const pulse = document.querySelector('.sync-pulse');

    const text = {
      synced:  'Синхронизировано',
      syncing: 'Синхронизация…',
      offline: 'Оффлайн',
      error:   'Ошибка синка',
    }[state] || '';

    const svg = {
      synced:  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M3 8.5l3 3 7-7"/></svg>',
      syncing: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 8a6 6 0 0 1 10-4.5L13 5"/><path d="M14 8a6 6 0 0 1-10 4.5L3 11"/><path d="M13 2v3h-3M3 14v-3h3"/></svg>',
      offline: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 2l12 12M3 9.5A4 4 0 0 1 6.7 6m6.5.3A4 4 0 0 1 13 8M5 12a2 2 0 0 1 2-2"/></svg>',
      error:   '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M8 3v5M8 11h.01"/><circle cx="8" cy="8" r="6.5"/></svg>',
    }[state] || '';

    if (btn)   btn.dataset.state = state;
    if (bubble) bubble.dataset.state = state;
    if (icon)  icon.innerHTML = svg;
    if (label) label.textContent = text;
    if (pulse) pulse.hidden = !(state === 'syncing' || state === 'error');
  }

  // ── API client ────────────────────────────────────────────
  async function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign(
      { 'Content-Type': 'application/json' },
      opts.headers || {}
    );
    const res = await fetch(path, opts);
    if (res.status === 401) {
      window.location.href = '/login';
      throw new Error('unauthorized');
    }
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { const j = await res.json(); if (j.error) msg = j.error; } catch (e) {}
      throw new Error(msg);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  // ── pending queue ─────────────────────────────────────────
  // Структура: { id, method, path, body }
  function enqueue(action) {
    pending.push(action);
    savePending();
  }

  async function flushPending() {
    if (pending.length === 0) return;
    if (!navigator.onLine) { setSyncState('offline'); return; }

    setSyncState('syncing');
    const queue = pending.slice();
    pending = [];
    savePending();

    let failed = false;
    for (const action of queue) {
      try {
        await api(action.path, {
          method: action.method,
          body: action.body ? JSON.stringify(action.body) : undefined,
        });
      } catch (err) {
        // 404 на delete/patch — задача уже могла быть удалена, пропускаем
        if (/HTTP 404/.test(err.message)) continue;
        failed = true;
        // не теряем — кладём обратно в начало
        pending.unshift(action);
      }
    }
    savePending();
    if (failed) setSyncState('error');
    else        setSyncState('synced');
  }

  // ── initial pull ──────────────────────────────────────────
  async function pullAll() {
    if (!navigator.onLine) { setSyncState('offline'); return; }
    if (!currentBoardId) return;
    // Не пуллим, пока есть оптимистично созданные задачи (tmp_*) или незавершённые POST'ы —
    // иначе перетрём то, что ещё не сохранилось на сервере.
    if (inFlightCreates > 0) return;
    if (tasks.some(t => typeof t.id === 'string' && t.id.indexOf('tmp_') === 0)) return;

    const bid = currentBoardId;
    setSyncState('syncing');
    try {
      const data = await api(boardPath('/tasks'));
      // доска могла смениться, пока шёл запрос — не перетираем чужой кэш
      if (bid !== currentBoardId) return;
      tasks = data.tasks || [];
      saveCache();
      localStorage.setItem(LAST_SYNC_PREFIX + bid, new Date().toISOString());
      setSyncState('synced');
      renderAll();
      initSortable();
    } catch (err) {
      console.warn('pull failed', err);
      setSyncState('error');
    }
  }

  // ── rendering ─────────────────────────────────────────────
  function heatOf(task) {
    if (!task.due_at) return 0;
    let created = new Date(task.created_at).getTime() || (Date.now() - HOUR);
    const due = new Date(task.due_at).getTime();
    // у повторяющихся окно жара — один период до срока, иначе они вечно "горят"
    if (task.repeat && REPEAT_MS[task.repeat]) created = due - REPEAT_MS[task.repeat];
    if (!due || due <= created) return 1;
    const ratio = (Date.now() - created) / (due - created);
    return Math.max(0, Math.min(2, ratio));
  }

  function formatDue(due, now) {
    if (!due) return 'без срока';
    const t = new Date(due).getTime();
    if (!t) return 'без срока';
    now = now || Date.now();
    const diff = t - now;
    const abs = Math.abs(diff);
    const past = diff < 0;
    if (abs < HOUR) {
      const m = Math.round(abs / 60000);
      return past ? 'просрочено ' + m + 'мин' : 'через ' + m + 'мин';
    }
    if (abs < DAY) {
      const h = Math.round(abs / HOUR);
      return past ? 'просрочено ' + h + 'ч' : 'через ' + h + 'ч';
    }
    const d = Math.round(abs / DAY);
    return past ? 'просрочено ' + d + 'д' : 'через ' + d + 'д';
  }

  function formatDueShort(due) {
    if (!due) return '';
    const t = new Date(due).getTime();
    if (!t) return '';
    const diff = t - Date.now();
    const abs = Math.abs(diff);
    const sign = diff < 0 ? '-' : '';
    if (abs < HOUR) return sign + Math.round(abs / 60000) + 'м';
    if (abs < DAY)  return sign + Math.round(abs / HOUR) + 'ч';
    return sign + Math.round(abs / DAY) + 'д';
  }

  function escapeHtml(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function heatFillStyle(heat) {
    // зелёный → mustard → terra → красный
    const stops = [
      [0.00, [125, 139,  63]],
      [0.55, [200, 154,  60]],
      [0.85, [217, 119,  87]],
      [1.00, [196,  62,  47]],
    ];
    function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
    const h = Math.min(1, heat);
    for (let i = 1; i < stops.length; i++) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      if (h <= t1) {
        const t = (h - t0) / (t1 - t0 || 1);
        return 'rgb(' + lerp(c0[0], c1[0], t) + ',' + lerp(c0[1], c1[1], t) + ',' + lerp(c0[2], c1[2], t) + ')';
      }
    }
    return 'rgb(196,62,47)';
  }

  function tileHTML(task) {
    const heat = heatOf(task);
    const overdue = heat > 1;
    const pct = Math.min(100, heat * 100);
    const fillColor = heatFillStyle(heat);
    const heatAlpha = Math.min(0.55, Math.max(0, (heat - 0.5) * 1.1));
    const heatGradient = heat > 0.5
      ? 'linear-gradient(180deg, transparent 0%, rgba(220, 60, 40, ' + heatAlpha.toFixed(2) + ') 110%)'
      : 'transparent';

    const sizeClass = SIZES.indexOf(task.size) >= 0 ? task.size : 's';
    const color = COLORS.indexOf(task.color) >= 0 ? task.color : 'indigo';

    return [
      '<article class="tile tile--', sizeClass, ' tile-bg-', color, task.done ? ' done' : '', '" data-id="', escapeHtml(task.id), '">',
        '<button class="tile-del" data-act="del" title="Удалить" type="button" aria-label="Удалить">',
          '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
        '</button>',
        '<div class="tile-heat" style="background:', heatGradient, '"></div>',
        '<div class="tile-body">',
          '<header class="tile-head">',
            '<button class="tile-check', task.done ? ' done' : '', '" data-act="toggle" type="button" aria-label="Отметить">',
              task.done ? '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M3 8.5l3 3 7-7"/></svg>' : '',
            '</button>',
            task.tag ? '<span class="tile-tag">' + escapeHtml(task.tag) + '</span>' : '',
            task.repeat && REPEAT_LABELS[task.repeat]
              ? '<span class="tile-repeat" title="' + REPEAT_LABELS[task.repeat] + '">' +
                  '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M13.5 8A5.5 5.5 0 1 1 11.6 3.9"/><path d="M12 1.5l1 2.7-2.7 1"/></svg>' +
                '</span>'
              : '',
            task.due_at ? '<span class="tile-due-short">' + escapeHtml(formatDueShort(task.due_at)) + '</span>' : '',
          '</header>',
          '<h3 class="tile-title">', escapeHtml(task.title), '</h3>',
          task.note && sizeClass !== 's' ? '<p class="tile-note">' + escapeHtml(task.note) + '</p>' : '',
          '<div class="tile-footer">',
            '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="6"/><path d="M8 5v3.5l2 1.5"/></svg>',
            '<span>', escapeHtml(formatDue(task.due_at)), '</span>',
          '</div>',
        '</div>',
        '<div class="tile-meter">',
          '<div class="tile-meter-fill', overdue ? ' overdue' : '', '" style="width:', pct, '%; background:', fillColor, '"></div>',
        '</div>',
      '</article>'
    ].join('');
  }

  // Плюс-плитка в конце сетки — создание задачи в конец списка.
  const ADD_TILE_HTML = [
    '<button class="tile-add" type="button" aria-label="Новая задача" title="Новая задача">',
      '<svg width="30" height="30" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 3v10M3 8h10"/></svg>',
    '</button>'
  ].join('');

  function getFiltered() {
    const q = (document.getElementById('search').value || '').toLowerCase().trim();
    // выполненные — вниз; свежеотмеченные (в sinkGrace) пока считаем
    // невыполненными, чтобы карточка не уезжала мгновенно
    let list = tasks.slice().sort((a, b) => {
      const ad = (a.done && !sinkGrace.has(a.id)) ? 1 : 0;
      const bd = (b.done && !sinkGrace.has(b.id)) ? 1 : 0;
      if (ad !== bd) return ad - bd;
      return (a.position || 0) - (b.position || 0);
    });
    if (q) {
      list = list.filter(t =>
        (t.title || '').toLowerCase().indexOf(q) >= 0 ||
        (t.note  || '').toLowerCase().indexOf(q) >= 0 ||
        (t.tag   || '').toLowerCase().indexOf(q) >= 0
      );
    }
    return list;
  }

  function renderAll() {
    const grid = document.getElementById('tiles');
    const empty = document.getElementById('empty');
    const list = getFiltered();
    grid.innerHTML = list.map(tileHTML).join('') + ADD_TILE_HTML;
    empty.hidden = list.length > 0;
    updateMeta(list.length);
  }

  function updateMeta(count) {
    const today = new Date();
    const months = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
    const word = count === 1 ? 'плитка' : (count >= 2 && count <= 4) ? 'плитки' : 'плиток';
    document.getElementById('section-meta').textContent =
      today.getDate() + ' ' + months[today.getMonth()] + ' · ' + count + ' ' + word;
  }

  // обновлять heat и подписи времени раз в минуту
  function tick() {
    document.querySelectorAll('.tile').forEach(el => {
      const id = el.dataset.id;
      const t = tasks.find(x => x.id === id);
      if (!t) return;
      const heat = heatOf(t);
      const fill = el.querySelector('.tile-meter-fill');
      const heatBg = el.querySelector('.tile-heat');
      const dueShort = el.querySelector('.tile-due-short');
      const dueFull  = el.querySelector('.tile-footer span');
      if (fill) {
        fill.style.width = Math.min(100, heat * 100) + '%';
        fill.style.background = heatFillStyle(heat);
        fill.classList.toggle('overdue', heat > 1);
      }
      if (heatBg) {
        const a = Math.min(0.55, Math.max(0, (heat - 0.5) * 1.1));
        heatBg.style.background = heat > 0.5
          ? 'linear-gradient(180deg, transparent 0%, rgba(220, 60, 40, ' + a.toFixed(2) + ') 110%)'
          : 'transparent';
      }
      if (dueShort) dueShort.textContent = formatDueShort(t.due_at);
      if (dueFull)  dueFull.textContent  = formatDue(t.due_at);
    });
  }

  // ── FLIP: плавный переезд плиток при пересортировке ───────
  // Плюс-плитка тоже участвует (ключ '__add'), чтобы не прыгала.
  function captureTileRects() {
    const rects = new Map();
    document.querySelectorAll('#tiles .tile, #tiles .tile-add').forEach(el => {
      rects.set(el.dataset.id || '__add', el.getBoundingClientRect());
    });
    return rects;
  }

  function playFlip(before) {
    document.querySelectorAll('#tiles .tile, #tiles .tile-add').forEach(el => {
      const b = before.get(el.dataset.id || '__add');
      if (!b) return;
      const a = el.getBoundingClientRect();
      const dx = b.left - a.left, dy = b.top - a.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.style.transition = 'none';
      el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      void el.offsetWidth; // reflow — фиксируем стартовую позицию
      el.classList.add('tile-flip');
      el.style.transition = '';
      el.style.transform = '';
      setTimeout(() => el.classList.remove('tile-flip'), 480);
    });
  }

  function flipRerender() {
    const before = captureTileRects();
    renderAll();
    initSortable();
    playFlip(before);
  }

  // ── отложенное "утопление" выполненных карточек ────────────
  const sinkGrace = new Map(); // id → таймер; пока карточка тут — вниз не уезжает

  function scheduleSink(id) {
    clearTimeout(sinkGrace.get(id));
    sinkGrace.set(id, setTimeout(() => {
      // не дёргаем сетку посреди drag'а — попробуем ещё раз позже
      if (Sortable.active) { scheduleSink(id); return; }
      sinkGrace.delete(id);
      flipRerender();
    }, SINK_DELAY_MS));
  }

  function cancelSink(id) {
    if (!sinkGrace.has(id)) return;
    clearTimeout(sinkGrace.get(id));
    sinkGrace.delete(id);
  }

  // ── авточистка: выполнено больше недели назад — удаляем ────
  function sweepExpiredDone() {
    const now = Date.now();
    const expired = tasks.filter(t => {
      if (!t.done) return false;
      const ts = Date.parse(t.completed_at || t.updated_at || '');
      return ts && (now - ts > DONE_TTL_MS);
    });
    if (!expired.length) return;

    const ids = new Set(expired.map(t => t.id));
    let i = 0;
    document.querySelectorAll('#tiles .tile').forEach(el => {
      if (!ids.has(el.dataset.id)) return;
      el.style.animationDelay = (i++ * 90) + 'ms';
      el.classList.add('tile-expire');
    });

    // ждём конца анимаций исчезновения, затем убираем из кэша одним
    // FLIP-рендером (соседи плавно съезжаются) и удаляем на сервере
    setTimeout(() => {
      const before = captureTileRects();
      tasks = tasks.filter(t => !ids.has(t.id));
      saveCache();
      renderAll();
      initSortable();
      playFlip(before);
      expired.forEach(t => deleteOnServer(t.id));
    }, 620 + i * 90);
  }

  // ── DnD ───────────────────────────────────────────────────
  let sortable = null;
  function initSortable() {
    const grid = document.getElementById('tiles');
    if (sortable) sortable.destroy();
    sortable = Sortable.create(grid, {
      animation: 320,
      easing: 'cubic-bezier(.22,.61,.24,1)',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      forceFallback: true, // лучше на тач-устройствах
      fallbackTolerance: 4,
      // в сетке из разноразмерных плиток свапаем только когда курсор реально
      // заехал за край соседа — иначе большие плитки "дребезжат"
      swapThreshold: 0.65,
      invertSwap: true,
      delay: 100,           // долгий тап — драг (важно для мобилы, чтобы скролл работал)
      delayOnTouchOnly: true,
      draggable: '.tile',   // плюс-плитка не перетаскивается
      onMove: function (evt) {
        // нельзя бросить карточку ПОСЛЕ плюс-плитки — она всегда последняя
        if (evt.related && evt.related.classList.contains('tile-add')) return !evt.willInsertAfter;
      },
      onStart: function () { dragJustEnded = 0; },
      onEnd: async function (evt) {
        // Sortable с forceFallback после drop диспатчит синтетический click —
        // запоминаем момент, чтобы tile-click-обработчик его проигнорировал.
        dragJustEnded = Date.now();

        const id = evt.item.dataset.id;
        const grid = evt.to;
        const children = Array.from(grid.children);
        const idx = children.indexOf(evt.item);
        const beforeEl = children[idx - 1];
        const afterEl  = children[idx + 1];

        // Считаем новую позицию локально (между соседями), чтобы UI был мгновенным.
        const t = tasks.find(x => x.id === id);
        if (!t) return;
        const sortedTasks = tasks.slice().sort((a, b) => (a.position || 0) - (b.position || 0));
        const beforeId = beforeEl ? beforeEl.dataset.id : null;
        const afterId  = afterEl  ? afterEl.dataset.id  : null;

        const beforePos = beforeId ? (sortedTasks.find(x => x.id === beforeId)?.position ?? null) : null;
        const afterPos  = afterId  ? (sortedTasks.find(x => x.id === afterId)?.position  ?? null) : null;

        let newPos;
        if (beforePos != null && afterPos != null) newPos = (beforePos + afterPos) / 2;
        else if (beforePos != null) newPos = beforePos + 1024;
        else if (afterPos  != null) newPos = afterPos - 1024;
        else newPos = 1024;

        t.position = newPos;
        saveCache();

        // Если перетаскиваем оптимистично созданную задачу (ещё нет серверного id) —
        // только локальный апдейт; позиция уйдёт на сервер вместе с самой задачей.
        if (id.indexOf('tmp_') === 0) return;

        // Серверный пересчёт — отправляем before/after id'шки.
        // Пропускаем якоря, которые сами ещё tmp_ (на сервере их нет).
        const safeAfter  = (afterId  && afterId.indexOf('tmp_')  !== 0) ? afterId  : null;
        const safeBefore = (beforeId && beforeId.indexOf('tmp_') !== 0) ? beforeId : null;
        if (!safeAfter && !safeBefore) return; // нет валидных якорей

        try {
          setSyncState('syncing');
          const body = {};
          if (safeAfter)  body.before = safeAfter;  // встаём ПЕРЕД таском с id=afterId
          if (safeBefore) body.after  = safeBefore; // и ПОСЛЕ таска с id=beforeId
          const data = await api(boardPath('/tasks/' + id + '/reorder'), {
            method: 'POST', body: JSON.stringify(body),
          });
          if (data && data.task) {
            const i = tasks.findIndex(x => x.id === id);
            if (i >= 0) tasks[i] = data.task;
            saveCache();
          }
          setSyncState('synced');
        } catch (err) {
          // в очередь — повторим позже
          enqueue({ method: 'POST', path: boardPath('/tasks/' + id + '/reorder'),
                    body: { before: safeAfter, after: safeBefore } });
          setSyncState(navigator.onLine ? 'error' : 'offline');
        }
      },
    });
  }

  // ── CRUD ──────────────────────────────────────────────────
  async function createTask(payload, atEnd) {
    // оптимистично — создаём временный id, реальный придёт с сервера
    const positions = tasks.map(t => t.position || 0);
    const tmp = {
      id: 'tmp_' + uuid(),
      title: payload.title, note: payload.note || '',
      color: payload.color, size: payload.size,
      tag: payload.tag || '', done: false,
      repeat: payload.repeat || '',
      position: tasks.length
        ? (atEnd ? Math.max.apply(null, positions) + 1024 : Math.min.apply(null, positions) - 1024)
        : 1024,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      due_at: payload.due_at || null,
    };
    if (atEnd) tasks.push(tmp);
    else       tasks.unshift(tmp);
    saveCache();
    renderAll();
    initSortable();

    inFlightCreates++;
    try {
      setSyncState('syncing');
      const data = await api(boardPath('/tasks'), {
        method: 'POST',
        body: JSON.stringify({
          title: payload.title, note: payload.note,
          color: payload.color, size: payload.size,
          tag: payload.tag, due_at: payload.due_at,
          repeat: payload.repeat || '',
          position: tmp.position,
        }),
      });
      const idx = tasks.findIndex(x => x.id === tmp.id);
      if (idx >= 0 && data && data.task) tasks[idx] = data.task;
      saveCache();
      renderAll();
      initSortable();
      setSyncState('synced');
    } catch (err) {
      // оставляем tmp в кэше и помечаем ошибку (на pending класть нельзя — нет id)
      setSyncState(navigator.onLine ? 'error' : 'offline');
    } finally {
      inFlightCreates--;
    }
  }

  // Следующее наступление повторяющейся задачи — строго в будущем.
  // Зеркало серверного nextOccurrence: база — текущий due_at (или now).
  function nextDueAt(due, repeat) {
    const now = Date.now();
    let d = due ? new Date(due) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    function step(x) {
      const n = new Date(x);
      if (repeat === 'daily')        n.setDate(n.getDate() + 1);
      else if (repeat === 'weekly')  n.setDate(n.getDate() + 7);
      else if (repeat === 'monthly') n.setMonth(n.getMonth() + 1);
      else                           n.setFullYear(n.getFullYear() + 1);
      return n;
    }
    let next = step(d);
    while (next.getTime() <= now) next = step(next);
    return next.toISOString();
  }

  // Завершение повторяющейся задачи: короткая вспышка галочки,
  // затем перенос срока на следующий раз — задача остаётся открытой.
  async function completeRecurring(t, tileEl) {
    const id = t.id;
    const i = tasks.findIndex(x => x.id === id);
    if (i < 0) return;

    // оптимистично двигаем срок сразу, рендерим после вспышки
    tasks[i].due_at = nextDueAt(tasks[i].due_at, tasks[i].repeat);
    tasks[i].updated_at = new Date().toISOString();
    saveCache();

    const check = tileEl && tileEl.querySelector('.tile-check');
    if (check) {
      check.classList.add('done');
      check.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M3 8.5l3 3 7-7"/></svg>';
    }
    if (tileEl) tileEl.classList.add('tile-rolled');
    setTimeout(() => { renderAll(); initSortable(); }, 500);

    if (id.indexOf('tmp_') === 0) return; // на сервер уедет вместе с созданием

    try {
      setSyncState('syncing');
      const data = await api(boardPath('/tasks/' + id), {
        method: 'PATCH', body: JSON.stringify({ done: true }),
      });
      if (data && data.task) {
        const j = tasks.findIndex(x => x.id === id);
        if (j >= 0) { tasks[j] = data.task; saveCache(); }
      }
      setSyncState('synced');
    } catch (err) {
      enqueue({ method: 'PATCH', path: boardPath('/tasks/' + id), body: { done: true } });
      setSyncState(navigator.onLine ? 'error' : 'offline');
    }
  }

  async function patchTask(id, patch) {
    const i = tasks.findIndex(x => x.id === id);
    if (i < 0) return;
    // completed_at зеркалим локально (сервер проставляет сам, в body не шлём) —
    // от него зависит недельная авточистка
    const local = Object.assign({}, patch);
    if (typeof patch.done === 'boolean') {
      local.completed_at = patch.done ? new Date().toISOString() : null;
    }
    Object.assign(tasks[i], local, { updated_at: new Date().toISOString() });
    saveCache();
    renderAll();
    initSortable();

    if (id.indexOf('tmp_') === 0) return; // пока не доехал на сервер — нечего пачить

    try {
      setSyncState('syncing');
      const data = await api(boardPath('/tasks/' + id), {
        method: 'PATCH', body: JSON.stringify(patch),
      });
      if (data && data.task) {
        tasks[i] = data.task;
        saveCache();
      }
      setSyncState('synced');
    } catch (err) {
      enqueue({ method: 'PATCH', path: boardPath('/tasks/' + id), body: patch });
      setSyncState(navigator.onLine ? 'error' : 'offline');
    }
  }

  async function deleteTask(id) {
    if (!tasks.some(x => x.id === id)) return;
    cancelSink(id);

    // сначала исчезает сама карточка, потом соседи FLIP'ом съезжаются на её место
    const el = document.querySelector('#tiles .tile[data-id="' + id + '"]');
    if (el) {
      el.classList.add('tile-remove');
      await new Promise(r => setTimeout(r, 300)); // длительность анимации tile-remove
    }

    const i = tasks.findIndex(x => x.id === id); // индекс мог сдвинуться за время анимации
    if (i < 0) return;
    tasks.splice(i, 1);
    saveCache();
    flipRerender();
    await deleteOnServer(id);
  }

  async function deleteOnServer(id) {
    if (id.indexOf('tmp_') === 0) return;
    try {
      setSyncState('syncing');
      await api(boardPath('/tasks/' + id), { method: 'DELETE' });
      setSyncState('synced');
    } catch (err) {
      enqueue({ method: 'DELETE', path: boardPath('/tasks/' + id) });
      setSyncState(navigator.onLine ? 'error' : 'offline');
    }
  }

  // ── доски (пространства) + шаринг ─────────────────────────
  let meId = null;              // id текущего пользователя (для «покинуть доску»); тянем в boot
  let switcherMode = 'dropdown'; // 'tabs' (видимые табы) | 'dropdown' (компактный фоллбек)

  function currentBoard() {
    return boards.find(b => b.id === currentBoardId) || null;
  }

  // Шапка-переключатель (дропдаун): имя и цветовая точка текущей доски.
  function renderBoardHeader() {
    const b = currentBoard();
    const nameEl = document.getElementById('board-name');
    const dotEl  = document.getElementById('board-dot');
    if (nameEl) nameEl.textContent = b ? b.name : 'Доска';
    if (dotEl)  dotEl.className = 'board-dot' + (b ? ' sw-' + b.color : '');
  }

  // Табы — по кнопке на доску + «＋». Видны на широком экране.
  function renderBoardTabs() {
    const wrap = document.getElementById('board-tabs');
    if (!wrap) return;
    wrap.innerHTML = boards.map(b => (
      '<button type="button" class="board-tab' + (b.id === currentBoardId ? ' active' : '') +
        '" data-bid="' + b.id + '" title="' + escapeHtml(b.name) + '">' +
        '<span class="board-dot sw-' + b.color + '"></span>' +
        '<span class="board-tab-name">' + escapeHtml(b.name) + '</span>' +
        (b.is_owner ? '' : '<span class="board-tab-shared" title="Общая доска">·</span>') +
      '</button>'
    )).join('') +
      '<button type="button" class="board-tab board-tab-add" id="board-tab-add" title="Новая доска">＋</button>';
  }

  // Выпадающее меню. В режиме табов список досок прячем (он уже в табах),
  // оставляем только действия с текущей доской.
  function renderBoardMenu() {
    const list = document.getElementById('board-list');
    if (!list) return;
    list.innerHTML = boards.map(b => (
      '<button type="button" class="board-menu-item board-item' +
        (b.id === currentBoardId ? ' active' : '') + '" data-bid="' + b.id + '">' +
        '<span class="board-dot sw-' + b.color + '"></span>' +
        '<span class="board-item-name">' + escapeHtml(b.name) + '</span>' +
        (b.is_owner ? '' : '<span class="board-item-shared" title="Общая доска">общая</span>') +
      '</button>'
    )).join('');

    const tabsMode = switcherMode === 'tabs';
    list.hidden = tabsMode;
    document.getElementById('board-menu-divider').hidden = tabsMode;
    document.getElementById('board-new').hidden = tabsMode; // в табах есть «＋»

    const b = currentBoard();
    const owner = b && b.is_owner;
    document.getElementById('board-owner-actions').hidden = !owner;
    document.getElementById('board-leave').hidden = !(b && !owner);
  }

  // Выбор режима переключателя: пробуем табы и проверяем, влезает ли топбар.
  // Если переполняется (или экран узкий) — откатываемся в дропдаун.
  function relayoutSwitcher() {
    const tabs    = document.getElementById('board-tabs');
    const actions = document.getElementById('board-actions-btn');
    const btn     = document.getElementById('board-btn');
    const topbar  = document.querySelector('.topbar');
    if (!tabs || !topbar) return;

    // временно показываем табы, чтобы измерить
    tabs.hidden = false; actions.hidden = false; btn.hidden = true;
    const fits = window.innerWidth >= 720 && topbar.scrollWidth <= topbar.clientWidth + 1;

    switcherMode = fits ? 'tabs' : 'dropdown';
    if (fits) {
      tabs.hidden = false; actions.hidden = false; btn.hidden = true;
    } else {
      tabs.hidden = true; actions.hidden = true; btn.hidden = false;
    }
  }

  // Полная перерисовка всего, что зависит от текущей доски.
  function renderBoardUI() {
    renderBoardHeader();
    renderBoardTabs();
    relayoutSwitcher();
    renderBoardMenu();
  }

  async function loadBoards() {
    if (!navigator.onLine) return;
    try {
      const data = await api('/api/boards');
      boards = data.boards || [];
      saveBoardsCache();
      // если текущая доска пропала из списка (удалена/покинута) — берём первую
      if (!currentBoardId || !boards.some(b => b.id === currentBoardId)) {
        currentBoardId = boards.length ? boards[0].id : null;
        if (currentBoardId) localStorage.setItem(CURRENT_BOARD_KEY, currentBoardId);
        tasks = currentBoardId ? loadCache(currentBoardId) : [];
      }
      renderBoardUI();
    } catch (err) {
      console.warn('loadBoards failed', err);
    }
  }

  function switchBoard(bid) {
    if (bid === currentBoardId) { closeBoardMenu(); return; }
    currentBoardId = bid;
    localStorage.setItem(CURRENT_BOARD_KEY, bid);
    tasks = loadCache(bid);
    closeBoardMenu();
    renderBoardUI();
    renderAll();
    initSortable();
    flushPending().then(pullAll).then(sweepExpiredDone);
  }

  async function createBoard(name, color) {
    try {
      setSyncState('syncing');
      const data = await api('/api/boards', {
        method: 'POST', body: JSON.stringify({ name: name, color: color }),
      });
      if (data && data.board) {
        boards.push(data.board);
        saveBoardsCache();
        switchBoard(data.board.id);
      }
      setSyncState('synced');
    } catch (err) {
      alert('Не удалось создать доску: ' + err.message);
      setSyncState(navigator.onLine ? 'error' : 'offline');
    }
  }

  async function updateBoard(name, color) {
    const b = currentBoard();
    if (!b) return;
    try {
      setSyncState('syncing');
      const data = await api('/api/boards/' + b.id, {
        method: 'PATCH', body: JSON.stringify({ name: name, color: color }),
      });
      if (data && data.board) {
        const i = boards.findIndex(x => x.id === b.id);
        if (i >= 0) boards[i] = data.board;
        saveBoardsCache();
        renderBoardUI();
      }
      setSyncState('synced');
    } catch (err) {
      alert('Не удалось изменить доску: ' + err.message);
      setSyncState(navigator.onLine ? 'error' : 'offline');
    }
  }

  async function deleteBoard() {
    const b = currentBoard();
    if (!b) return;
    if (!confirm('Удалить доску «' + b.name + '» со всеми задачами? Это действие необратимо.')) return;
    try {
      setSyncState('syncing');
      await api('/api/boards/' + b.id, { method: 'DELETE' });
      localStorage.removeItem(tasksKey(b.id));
      boards = boards.filter(x => x.id !== b.id);
      saveBoardsCache();
      currentBoardId = boards.length ? boards[0].id : null;
      if (currentBoardId) localStorage.setItem(CURRENT_BOARD_KEY, currentBoardId);
      tasks = currentBoardId ? loadCache(currentBoardId) : [];
      closeBoardMenu();
      renderBoardUI();
      renderAll();
      initSortable();
      setSyncState('synced');
      pullAll();
    } catch (err) {
      alert('Не удалось удалить доску: ' + err.message);
      setSyncState(navigator.onLine ? 'error' : 'offline');
    }
  }

  async function leaveBoard() {
    const b = currentBoard();
    if (!b || meId == null) return;
    if (!confirm('Покинуть доску «' + b.name + '»? Она исчезнет из вашего списка.')) return;
    try {
      setSyncState('syncing');
      await api('/api/boards/' + b.id + '/members/' + meId, { method: 'DELETE' });
      localStorage.removeItem(tasksKey(b.id));
      boards = boards.filter(x => x.id !== b.id);
      saveBoardsCache();
      currentBoardId = boards.length ? boards[0].id : null;
      if (currentBoardId) localStorage.setItem(CURRENT_BOARD_KEY, currentBoardId);
      tasks = currentBoardId ? loadCache(currentBoardId) : [];
      closeBoardMenu();
      renderBoardUI();
      renderAll();
      initSortable();
      setSyncState('synced');
      pullAll();
    } catch (err) {
      alert('Не удалось покинуть доску: ' + err.message);
      setSyncState(navigator.onLine ? 'error' : 'offline');
    }
  }

  // ── шаринг: участники доски ───────────────────────────────
  function renderMembers(members) {
    const wrap = document.getElementById('member-list');
    const b = currentBoard();
    const canManage = b && b.is_owner;
    wrap.innerHTML = members.map(m => (
      '<div class="member-row">' +
        '<span class="member-ava sw-' + (m.avatar_color || 'indigo') + '">' +
          escapeHtml(initialsOf(m.display_name)) + '</span>' +
        '<span class="member-meta">' +
          '<span class="member-name">' + escapeHtml(m.display_name) +
            (m.is_owner ? ' <span class="member-badge">владелец</span>' : '') + '</span>' +
          '<span class="member-email">' + escapeHtml(m.email) + '</span>' +
        '</span>' +
        (canManage && !m.is_owner
          ? '<button type="button" class="member-remove" data-uid="' + m.user_id + '" title="Убрать">✕</button>'
          : '') +
      '</div>'
    )).join('');
  }

  function initialsOf(name) {
    const parts = (name || '').trim().split(/\s+/).slice(0, 2);
    return parts.map(p => p[0] || '').join('').toUpperCase();
  }

  async function loadMembers() {
    const b = currentBoard();
    if (!b) return;
    try {
      const data = await api('/api/boards/' + b.id + '/members');
      renderMembers(data.members || []);
    } catch (err) {
      renderMembers([]);
    }
  }

  async function addMember(email) {
    const b = currentBoard();
    if (!b) return;
    const errEl = document.getElementById('share-error');
    errEl.hidden = true;
    try {
      await api('/api/boards/' + b.id + '/members', {
        method: 'POST', body: JSON.stringify({ email: email }),
      });
      document.getElementById('share-email').value = '';
      loadMembers();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  }

  async function removeMember(uid) {
    const b = currentBoard();
    if (!b) return;
    try {
      await api('/api/boards/' + b.id + '/members/' + uid, { method: 'DELETE' });
      loadMembers();
    } catch (err) {
      const errEl = document.getElementById('share-error');
      errEl.textContent = err.message; errEl.hidden = false;
    }
  }

  // ── меню досок и модалки доски/шаринга ────────────────────
  let boardModalMode = 'create'; // create | rename
  let boardModalColor = 'indigo';

  function openBoardMenu() {
    renderBoardMenu();
    const menu = document.getElementById('board-menu');
    // в режиме табов меню вызывается кнопкой «⋯» справа — прижимаем к правому краю
    menu.classList.toggle('align-right', switcherMode === 'tabs');
    menu.hidden = false;
  }
  function closeBoardMenu() {
    const m = document.getElementById('board-menu');
    if (m) m.hidden = true;
  }

  function setBoardModalColor(c) {
    boardModalColor = c;
    document.querySelectorAll('#board-f-colors .sw').forEach(x =>
      x.classList.toggle('selected', x.dataset.v === c));
  }

  function openBoardModal(mode) {
    boardModalMode = mode;
    const b = currentBoard();
    document.getElementById('board-modal-title').textContent =
      mode === 'rename' ? 'Переименовать доску' : 'Новая доска';
    const nameInput = document.getElementById('board-f-name');
    nameInput.value = mode === 'rename' && b ? b.name : '';
    setBoardModalColor(mode === 'rename' && b ? b.color : 'indigo');
    document.getElementById('board-modal').showModal();
    setTimeout(() => nameInput.focus(), 30);
  }
  function closeBoardModal() {
    document.getElementById('board-modal').close();
  }

  function openShareModal() {
    document.getElementById('share-error').hidden = true;
    document.getElementById('share-email').value = '';
    document.getElementById('share-modal').showModal();
    loadMembers();
  }

  // ── режим дашборда: полный экран + не гасить подсветку ────
  // Источник правды — fullscreen-статус: вошли в полный экран →
  // взяли wake lock, вышли (кнопкой, Esc, жестом) → отпустили.
  // Если Fullscreen API нет — кнопка работает как чистый wake lock.
  // Wake lock система отпускает при уходе вкладки в фон —
  // переполучаем на visibilitychange, пока режим включён.
  // В WKWebView-браузерах на iPad (Яндекс, Chrome) нет ни того, ни
  // другого API — там экран держит зацикленное видео с беззвучной
  // аудиодорожкой (трюк NoSleep.js).
  let dashWanted = false;    // режим включён (в памяти; fullscreen не переживает reload)
  let wakeSentinel = null;   // активный WakeLockSentinel или null
  let wakeVideo = null;      // <video>-фоллбек для браузеров без Wake Lock API
  let wakeApiBroken = false; // wakeLock есть, но request отвергается (webview)

  function getWakeVideo() {
    if (!wakeVideo) {
      wakeVideo = document.createElement('video');
      wakeVideo.setAttribute('playsinline', '');
      wakeVideo.loop = true;
      // звука нет: дорожка в файле тихая; muted нельзя — iOS не считает
      // беззвучное видео поводом держать экран
      wakeVideo.src = '/static/wake.mp4';
      wakeVideo.style.cssText =
        'position:fixed;left:-10px;top:-10px;width:2px;height:2px;opacity:0;pointer-events:none;';
      document.body.appendChild(wakeVideo);
    }
    return wakeVideo;
  }

  // Fullscreen API с webkit-префиксами (iPadOS Safari)
  const fsSupported = !!(document.documentElement.requestFullscreen ||
                         document.documentElement.webkitRequestFullscreen);
  function fsElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }
  function fsRequest() {
    const el = document.documentElement;
    if (el.requestFullscreen) return el.requestFullscreen();
    return Promise.resolve(el.webkitRequestFullscreen());
  }
  function fsExit() {
    if (document.exitFullscreen) return document.exitFullscreen();
    return Promise.resolve(document.webkitExitFullscreen());
  }

  function updateWakeBtn() {
    const btn = document.getElementById('wake-btn');
    if (!btn) return;
    const on = !!fsElement() || !!wakeSentinel || !!(wakeVideo && !wakeVideo.paused);
    btn.classList.toggle('active', on);
    btn.title = on ? 'Выйти из режима дашборда'
                   : 'Дашборд: во весь экран, не гасить подсветку';
  }

  async function acquireWake() {
    if (document.visibilityState !== 'visible') return;
    if ('wakeLock' in navigator && !wakeApiBroken) {
      if (wakeSentinel) return;
      try {
        wakeSentinel = await navigator.wakeLock.request('screen');
        wakeSentinel.addEventListener('release', () => {
          wakeSentinel = null;
          // Лок отняли, хотя вкладка видима и режим включён (WebKit так
          // делает, например, при входе в fullscreen) — нативному API тут
          // доверия нет, переходим на видео-фоллбек.
          if (dashWanted && document.visibilityState === 'visible') {
            wakeApiBroken = true;
            acquireWake();
          }
          updateWakeBtn();
        });
        updateWakeBtn();
        return;
      } catch (err) {
        // API есть, но запрещён (webview) — дальше пробуем видео
        wakeApiBroken = true;
      }
    }
    try { await getWakeVideo().play(); } catch (e) { /* low power mode и т.п. */ }
    updateWakeBtn();
  }

  async function releaseWake() {
    if (wakeSentinel) { try { await wakeSentinel.release(); } catch (e) {} }
    wakeSentinel = null;
    if (wakeVideo && !wakeVideo.paused) wakeVideo.pause();
    updateWakeBtn();
  }

  // ── modal ─────────────────────────────────────────────────
  function openModal(task, atEnd) {
    editingId = task ? task.id : null;
    createAtEnd = !task && !!atEnd;
    const modal = document.getElementById('task-modal');
    document.getElementById('modal-overlay').hidden = false;

    document.getElementById('modal-title').textContent = task ? 'Редактирование' : 'Новая задача';
    document.getElementById('modal-delete').hidden = !task;

    document.getElementById('f-title').value = task ? task.title : '';
    document.getElementById('f-note').value  = task ? (task.note || '') : '';
    document.getElementById('f-tag').value   = task ? (task.tag || '') : '';

    // due_at → datetime-local
    let dueLocal = '';
    if (task && task.due_at) {
      const d = new Date(task.due_at);
      if (!isNaN(d.getTime())) {
        const pad = n => String(n).padStart(2, '0');
        dueLocal = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
                 + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      }
    }
    document.getElementById('f-due').value = dueLocal;

    const color  = task ? task.color : 'indigo';
    const size   = task ? task.size  : 's';
    const repeat = task ? (task.repeat || '') : '';
    document.querySelectorAll('#f-colors .sw').forEach(el => {
      el.classList.toggle('selected', el.dataset.v === color);
    });
    document.querySelectorAll('#f-sizes button').forEach(el => {
      el.classList.toggle('selected', el.dataset.v === size);
    });
    document.querySelectorAll('#f-repeat button').forEach(el => {
      el.classList.toggle('selected', (el.dataset.v || '') === repeat);
    });

    if (typeof modal.showModal === 'function') modal.showModal();
    else modal.setAttribute('open', '');
    setTimeout(() => document.getElementById('f-title').focus(), 50);
  }

  function closeModal() {
    const modal = document.getElementById('task-modal');
    if (modal.open) modal.close();
    else modal.removeAttribute('open');
    document.getElementById('modal-overlay').hidden = true;
    editingId = null;
  }

  function readModal() {
    const selColor  = document.querySelector('#f-colors .sw.selected');
    const selSize   = document.querySelector('#f-sizes button.selected');
    const selRepeat = document.querySelector('#f-repeat button.selected');
    const dueRaw = document.getElementById('f-due').value;
    let due_at = null;
    if (dueRaw) {
      const d = new Date(dueRaw);
      if (!isNaN(d.getTime())) due_at = d.toISOString();
    }
    return {
      title: document.getElementById('f-title').value.trim(),
      note:  document.getElementById('f-note').value.trim(),
      tag:   document.getElementById('f-tag').value.trim(),
      color: selColor ? selColor.dataset.v : 'indigo',
      size:  selSize  ? selSize.dataset.v  : 's',
      repeat: selRepeat ? (selRepeat.dataset.v || '') : '',
      due_at,
    };
  }

  // ── wiring ────────────────────────────────────────────────
  function wireEvents() {
    // топбар: theme
    document.getElementById('theme-btn').addEventListener('click', () => {
      const isDark = document.documentElement.classList.toggle('dark');
      localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
      document.getElementById('icon-moon').hidden = isDark;
      document.getElementById('icon-sun').hidden  = !isDark;
    });
    // на загрузке — подравнять иконки
    const isDark = document.documentElement.classList.contains('dark');
    document.getElementById('icon-moon').hidden = isDark;
    document.getElementById('icon-sun').hidden  = !isDark;

    // sync — клик принудительно пушит pending и пуллит сервер
    document.getElementById('sync-btn').addEventListener('click', () => {
      flushPending().then(pullAll);
    });

    // режим дашборда — полный экран + wake lock (кнопка видна всегда:
    // видео-фоллбек работает даже там, где нет обоих API)
    document.getElementById('wake-btn').addEventListener('click', () => {
      if (dashWanted) {
        dashWanted = false;
        if (fsElement()) fsExit();
        releaseWake();
      } else {
        dashWanted = true;
        // wake берём прямо здесь — video.play() требует жеста пользователя
        acquireWake();
        if (fsSupported && !fsElement()) {
          fsRequest().catch(() => { /* fullscreen не дали — остаёмся с wake */ });
        }
        updateWakeBtn();
      }
    });
    ['fullscreenchange', 'webkitfullscreenchange'].forEach(ev => {
      document.addEventListener(ev, () => {
        if (fsElement()) { dashWanted = true; acquireWake(); }
        else if (dashWanted) { dashWanted = false; releaseWake(); }
        // на планшете системный статус-бар и кнопка выхода ложатся поверх
        // страницы — класс опускает топбар (см. .fs-touch в app.css)
        document.documentElement.classList.toggle('fs-touch',
          !!fsElement() && matchMedia('(pointer: coarse)').matches);
        // выход из fullscreen асинхронный: кнопку обновляем всегда, даже
        // если dashWanted уже сброшен кликом
        updateWakeBtn();
      });
    });
    document.addEventListener('visibilitychange', () => {
      if (dashWanted && document.visibilityState === 'visible') acquireWake();
    });

    // создание задачи
    document.getElementById('new-task-btn').addEventListener('click', () => openModal(null));
    document.getElementById('empty-new-btn').addEventListener('click', () => openModal(null));

    // user menu
    const userBtn = document.getElementById('user-btn');
    const userMenu = document.getElementById('user-menu');
    userBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      userMenu.hidden = !userMenu.hidden;
    });
    document.addEventListener('click', (e) => {
      if (!userMenu.hidden && !userMenu.contains(e.target) && e.target !== userBtn) {
        userMenu.hidden = true;
      }
    });
    document.getElementById('logout-btn').addEventListener('click', async () => {
      try { await fetch('/auth/logout', { method: 'POST' }); } catch (e) {}
      // вычищаем весь локальный кэш tbd.* — на следующий вход подтянется свежее
      Object.keys(localStorage)
        .filter(k => k.indexOf('tbd.') === 0)
        .forEach(k => localStorage.removeItem(k));
      window.location.href = '/login';
    });

    // ── переключатель досок ──────────────────────────────────
    const boardBtn = document.getElementById('board-btn');
    const boardActionsBtn = document.getElementById('board-actions-btn');
    const boardMenu = document.getElementById('board-menu');
    const toggleMenu = (e) => {
      e.stopPropagation();
      if (boardMenu.hidden) openBoardMenu(); else closeBoardMenu();
    };
    boardBtn.addEventListener('click', toggleMenu);
    boardActionsBtn.addEventListener('click', toggleMenu);
    document.addEventListener('click', (e) => {
      if (!boardMenu.hidden && !boardMenu.contains(e.target) &&
          e.target !== boardBtn && !boardActionsBtn.contains(e.target)) {
        closeBoardMenu();
      }
    });
    document.getElementById('board-list').addEventListener('click', (e) => {
      const item = e.target.closest('.board-item');
      if (item) switchBoard(item.dataset.bid);
    });
    // клики по табам: выбор доски или «＋» (новая доска)
    document.getElementById('board-tabs').addEventListener('click', (e) => {
      if (e.target.closest('#board-tab-add')) { openBoardModal('create'); return; }
      const tab = e.target.closest('.board-tab');
      if (tab && tab.dataset.bid) switchBoard(tab.dataset.bid);
    });
    // пересчёт режима табы/дропдаун при изменении ширины окна
    let relayoutTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(relayoutTimer);
      relayoutTimer = setTimeout(() => { relayoutSwitcher(); renderBoardMenu(); }, 120);
    });
    document.getElementById('board-new').addEventListener('click', () => {
      closeBoardMenu(); openBoardModal('create');
    });
    document.getElementById('board-rename').addEventListener('click', () => {
      closeBoardMenu(); openBoardModal('rename');
    });
    document.getElementById('board-share').addEventListener('click', () => {
      closeBoardMenu(); openShareModal();
    });
    document.getElementById('board-delete').addEventListener('click', () => {
      closeBoardMenu(); deleteBoard();
    });
    document.getElementById('board-leave').addEventListener('click', () => {
      closeBoardMenu(); leaveBoard();
    });

    // ── модалка доски (создание / переименование) ────────────
    document.querySelectorAll('#board-f-colors .sw').forEach(el => {
      el.addEventListener('click', () => setBoardModalColor(el.dataset.v));
    });
    document.getElementById('board-modal-close').addEventListener('click', closeBoardModal);
    document.getElementById('board-modal-cancel').addEventListener('click', closeBoardModal);
    document.getElementById('board-modal').addEventListener('cancel', (e) => { e.preventDefault(); closeBoardModal(); });
    document.getElementById('board-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('board-f-name').value.trim();
      if (!name) { document.getElementById('board-f-name').focus(); return; }
      if (boardModalMode === 'rename') updateBoard(name, boardModalColor);
      else                            createBoard(name, boardModalColor);
      closeBoardModal();
    });

    // ── шаринг ────────────────────────────────────────────────
    document.getElementById('share-close').addEventListener('click', () => document.getElementById('share-modal').close());
    document.getElementById('share-done').addEventListener('click', () => document.getElementById('share-modal').close());
    document.getElementById('share-modal').addEventListener('cancel', (e) => { e.preventDefault(); document.getElementById('share-modal').close(); });
    document.getElementById('share-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const email = document.getElementById('share-email').value.trim();
      if (email) addMember(email);
    });
    document.getElementById('member-list').addEventListener('click', (e) => {
      const btn = e.target.closest('.member-remove');
      if (btn) removeMember(btn.dataset.uid);
    });

    // search
    let searchTimer = null;
    document.getElementById('search').addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { renderAll(); initSortable(); }, 80);
    });

    // клики по плиткам (делегирование)
    document.getElementById('tiles').addEventListener('click', (e) => {
      // Игнорируем синтетический click сразу после drag (Sortable forceFallback).
      if (Date.now() - dragJustEnded < 350) return;

      // плюс-плитка — новая задача в конец списка
      if (e.target.closest('.tile-add')) { openModal(null, true); return; }

      const tile = e.target.closest('.tile');
      if (!tile) return;
      const id = tile.dataset.id;
      const t = tasks.find(x => x.id === id);
      if (!t) return;

      const act = e.target.closest('[data-act]');
      if (act && act.dataset.act === 'toggle') {
        e.stopPropagation();
        if (t.repeat && !t.done) completeRecurring(t, tile);
        else {
          const makingDone = !t.done;
          if (makingDone) scheduleSink(id); // вниз уедет через SINK_DELAY_MS
          else            cancelSink(id);
          // рендер внутри patchTask синхронный — оборачиваем во FLIP,
          // чтобы снятая галочка плавно возвращала карточку наверх
          const before = captureTileRects();
          patchTask(id, { done: makingDone });
          playFlip(before);
        }
        return;
      }
      if (act && act.dataset.act === 'del') {
        e.stopPropagation();
        if (confirm('Удалить «' + t.title + '»?')) deleteTask(id);
        return;
      }
      // открыть редактирование
      openModal(t);
    });

    // модалка
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-overlay').addEventListener('click', closeModal);
    document.getElementById('task-modal').addEventListener('cancel', (e) => { e.preventDefault(); closeModal(); });
    // Клик по подложке: у <dialog> в top layer клик по ::backdrop таргетится
    // в сам диалог — отличаем его от клика по контенту по координатам.
    document.getElementById('task-modal').addEventListener('click', (e) => {
      if (e.target !== e.currentTarget) return;
      const r = e.currentTarget.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right &&
                     e.clientY >= r.top  && e.clientY <= r.bottom;
      if (!inside) closeModal();
    });

    document.querySelectorAll('#f-colors .sw').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('#f-colors .sw').forEach(x => x.classList.remove('selected'));
        el.classList.add('selected');
      });
    });
    document.querySelectorAll('#f-sizes button').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('#f-sizes button').forEach(x => x.classList.remove('selected'));
        el.classList.add('selected');
      });
    });
    document.querySelectorAll('#f-repeat button').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('#f-repeat button').forEach(x => x.classList.remove('selected'));
        el.classList.add('selected');
      });
    });

    document.getElementById('task-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const data = readModal();
      if (!data.title) { document.getElementById('f-title').focus(); return; }
      if (editingId) patchTask(editingId, data);
      else           createTask(data, createAtEnd);
      closeModal();
    });
    document.getElementById('modal-delete').addEventListener('click', () => {
      if (!editingId) return;
      const t = tasks.find(x => x.id === editingId);
      const title = t ? t.title : 'эту задачу';
      if (confirm('Удалить «' + title + '»?')) {
        deleteTask(editingId);
        closeModal();
      }
    });

    // online / offline
    window.addEventListener('online',  () => { setSyncState('syncing'); flushPending().then(pullAll); });
    window.addEventListener('offline', () => setSyncState('offline'));

    // фоновый пуллинг каждые 30с (когда вкладка активна)
    setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        flushPending().then(pullAll);
      }
    }, 30_000);

    // тик "живых" дедлайнов
    setInterval(tick, 60_000);
  }

  // ── boot ──────────────────────────────────────────────────
  function boot() {
    setSyncState(navigator.onLine ? 'synced' : 'offline');
    renderBoardUI();
    renderAll();
    initSortable();
    wireEvents();
    // узнаём свой id (для «покинуть доску»)
    api('/auth/me').then(d => { if (d && d.user) meId = d.user.id; }).catch(() => {});
    // тянем список досок, затем задачи текущей; после первого пулла —
    // выметаем карточки, выполненные больше недели назад
    loadBoards().then(() => flushPending()).then(pullAll).then(sweepExpiredDone);
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
