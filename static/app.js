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
  const TASKS_KEY   = 'tbd.tasks.v1';
  const PENDING_KEY = 'tbd.pending.v1';
  const LAST_SYNC_KEY = 'tbd.lastSync.v1';
  const THEME_KEY   = 'theme';

  const HOUR = 3600_000;
  const DAY  = HOUR * 24;

  const COLORS = ['terra', 'indigo', 'olive', 'mustard', 'rose', 'clay'];
  const SIZES  = ['s', 'm', 'wide', 'l'];

  // ── состояние ─────────────────────────────────────────────
  let tasks = loadCache();
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

  function loadCache() {
    try { return JSON.parse(localStorage.getItem(TASKS_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function saveCache() {
    localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
  }
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
    // Не пуллим, пока есть оптимистично созданные задачи (tmp_*) или незавершённые POST'ы —
    // иначе перетрём то, что ещё не сохранилось на сервере.
    if (inFlightCreates > 0) return;
    if (tasks.some(t => typeof t.id === 'string' && t.id.indexOf('tmp_') === 0)) return;

    setSyncState('syncing');
    try {
      const data = await api('/api/tasks');
      tasks = data.tasks || [];
      saveCache();
      localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
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
    const created = new Date(task.created_at).getTime() || (Date.now() - HOUR);
    const due = new Date(task.due_at).getTime();
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
    let list = tasks.slice().sort((a, b) => (a.position || 0) - (b.position || 0));
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

  // ── DnD ───────────────────────────────────────────────────
  let sortable = null;
  function initSortable() {
    const grid = document.getElementById('tiles');
    if (sortable) sortable.destroy();
    sortable = Sortable.create(grid, {
      animation: 180,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      forceFallback: true, // лучше на тач-устройствах
      fallbackTolerance: 4,
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
          const data = await api('/api/tasks/' + id + '/reorder', {
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
          enqueue({ method: 'POST', path: '/api/tasks/' + id + '/reorder',
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
      const data = await api('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: payload.title, note: payload.note,
          color: payload.color, size: payload.size,
          tag: payload.tag, due_at: payload.due_at,
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

  async function patchTask(id, patch) {
    const i = tasks.findIndex(x => x.id === id);
    if (i < 0) return;
    Object.assign(tasks[i], patch, { updated_at: new Date().toISOString() });
    saveCache();
    renderAll();
    initSortable();

    if (id.indexOf('tmp_') === 0) return; // пока не доехал на сервер — нечего пачить

    try {
      setSyncState('syncing');
      const data = await api('/api/tasks/' + id, {
        method: 'PATCH', body: JSON.stringify(patch),
      });
      if (data && data.task) {
        tasks[i] = data.task;
        saveCache();
      }
      setSyncState('synced');
    } catch (err) {
      enqueue({ method: 'PATCH', path: '/api/tasks/' + id, body: patch });
      setSyncState(navigator.onLine ? 'error' : 'offline');
    }
  }

  async function deleteTask(id) {
    const i = tasks.findIndex(x => x.id === id);
    if (i < 0) return;
    tasks.splice(i, 1);
    saveCache();
    renderAll();
    initSortable();

    if (id.indexOf('tmp_') === 0) return;

    try {
      setSyncState('syncing');
      await api('/api/tasks/' + id, { method: 'DELETE' });
      setSyncState('synced');
    } catch (err) {
      enqueue({ method: 'DELETE', path: '/api/tasks/' + id });
      setSyncState(navigator.onLine ? 'error' : 'offline');
    }
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

    const color = task ? task.color : 'indigo';
    const size  = task ? task.size  : 's';
    document.querySelectorAll('#f-colors .sw').forEach(el => {
      el.classList.toggle('selected', el.dataset.v === color);
    });
    document.querySelectorAll('#f-sizes button').forEach(el => {
      el.classList.toggle('selected', el.dataset.v === size);
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
    const selColor = document.querySelector('#f-colors .sw.selected');
    const selSize  = document.querySelector('#f-sizes button.selected');
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
      // вычищаем локальный кэш — на следующий вход подтянется свежее
      localStorage.removeItem(TASKS_KEY);
      localStorage.removeItem(PENDING_KEY);
      localStorage.removeItem(LAST_SYNC_KEY);
      window.location.href = '/login';
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
        patchTask(id, { done: !t.done });
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
    renderAll();
    initSortable();
    wireEvents();
    flushPending().then(pullAll);
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
