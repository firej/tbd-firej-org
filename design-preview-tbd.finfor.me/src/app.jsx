/* global React, TopBar, Sidebar, TaskList, CreateModal, EmptyState, LoginScreen, MOCK_TASKS */
// The main App — shared logic, parameterized by view (desktop|tablet|phone).
// Each instance keeps its own state so artboards don't interfere.

function makeId() { return 't' + Math.random().toString(36).slice(2, 7); }

function App({
  view = 'desktop',
  initialTasks = null,
  initialSync = 'synced',
  initialDark = false,
  themeStyle = 'paper',
  startAuthenticated = true,
  startEmpty = false,
  frozenDragId = null,
  frozenHover = null,
  freezeSync = false,
  showSidebar = true,
  // Controlled auth (optional). If onAuthChange is given, App becomes controlled on auth.
  authed: controlledAuthed,
  onAuthChange,
}) {
  const isAuthControlled = onAuthChange !== undefined;
  const [internalAuthed, setInternalAuthed] = React.useState(startAuthenticated);
  const authed = isAuthControlled ? controlledAuthed : internalAuthed;
  const setAuthed = (v) => {
    if (isAuthControlled) onAuthChange(v);
    else setInternalAuthed(v);
  };
  const [tasks, setTasks]   = React.useState(() =>
    startEmpty ? [] : (initialTasks || MOCK_TASKS)
  );
  const [sync, setSync]     = React.useState(initialSync);
  const [dark, setDark]     = React.useState(initialDark);
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing]   = React.useState(null);
  const [query, setQuery]       = React.useState('');
  const [activeNav, setActiveNav] = React.useState('today');

  // Demo: cycle sync on click
  function cycleSync() {
    if (freezeSync) return;
    const order = ['synced', 'syncing', 'offline', 'error'];
    const i = order.indexOf(sync);
    setSync(order[(i + 1) % order.length]);
    // auto-return to synced after syncing
    if (order[(i + 1) % order.length] === 'syncing') {
      setTimeout(() => setSync('synced'), 1600);
    }
  }

  function handleSave(form) {
    const HOUR = 3600_000;
    if (editing) {
      // edit existing
      setTasks(prev => prev.map(t => t.id === editing.id ? {
        ...t,
        title: form.title, note: form.note,
        color: form.color, size: form.size, tag: form.tag,
        due: Date.now() + form.dueInHours * HOUR,
      } : t));
      setEditing(null);
    } else {
      const newTask = {
        id: makeId(),
        title: form.title, note: form.note,
        color: form.color, size: form.size, tag: form.tag,
        created: Date.now(),
        due: Date.now() + form.dueInHours * HOUR,
        done: false, sub: [],
      };
      setTasks(prev => [newTask, ...prev]);
      setCreating(false);
    }
    if (!freezeSync) {
      setSync('syncing');
      setTimeout(() => setSync('synced'), 1500);
    }
  }

  function handleDelete(id) {
    setTasks(prev => prev.filter(t => t.id !== id));
    if (!freezeSync) {
      setSync('syncing');
      setTimeout(() => setSync('synced'), 900);
    }
  }

  const filteredTasks = React.useMemo(() => {
    if (!query.trim()) return tasks;
    const q = query.toLowerCase();
    return tasks.filter(t =>
      t.title.toLowerCase().includes(q) ||
      (t.note && t.note.toLowerCase().includes(q)) ||
      (t.tag && t.tag.toLowerCase().includes(q))
    );
  }, [tasks, query]);

  if (!authed) {
    return <LoginScreen view={view} onLogin={() => setAuthed(true)}/>;
  }

  const cols = view === 'desktop' ? 4 : view === 'tablet' ? 3 : 2;
  const showSide = showSidebar && view !== 'phone';

  return (
    <div className={dark ? 'dark' : ''} style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      background: 'var(--bg)',
      color: 'var(--ink)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div className="paper-texture"/>

      <TopBar
        view={view}
        syncState={sync}
        onChangeSync={cycleSync}
        query={query} setQuery={setQuery}
        onCreate={() => setCreating(true)}
        dark={dark} onToggleDark={() => setDark(d => !d)}
      />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative', zIndex: 1 }}>
        {showSide && <Sidebar active={activeNav} onPick={setActiveNav} view={view}/>}

        <main style={{
          flex: 1, overflow: 'auto',
          padding: view === 'phone' ? 14 : view === 'tablet' ? 22 : 28,
        }}>
          <SectionHeader view={view} count={filteredTasks.length} title={navTitle(activeNav)}/>

          {filteredTasks.length === 0 ? (
            <EmptyState onCreate={() => setCreating(true)} view={view}/>
          ) : (
            <TaskList
              tasks={filteredTasks}
              setTasks={setTasks}
              density={view === 'phone' ? 'compact' : 'cozy'}
              cols={cols}
              themeStyle={themeStyle}
              onPick={(t) => setEditing(t)}
              onDelete={handleDelete}
              frozenDragId={frozenDragId}
              frozenHover={frozenHover}
            />
          )}
        </main>
      </div>

      <CreateModal
        open={creating || !!editing}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSubmit={handleSave}
        onDelete={(id) => { handleDelete(id); setEditing(null); }}
        view={view}
        initial={editing}
      />
    </div>
  );
}

function navTitle(nav) {
  return {
    inbox: 'Входящие',
    today: 'Сегодня',
    upcoming: 'Скоро',
    starred: 'Важные',
  }[nav] || 'Сегодня';
}

function SectionHeader({ title, count, view }) {
  const today = new Date();
  const months = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  const dateStr = `${today.getDate()} ${months[today.getMonth()]}`;
  return (
    <header style={{
      display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
      marginBottom: view === 'phone' ? 14 : 22,
      gap: 12,
    }}>
      <div>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 11,
          color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: 0.6,
          marginBottom: 4,
        }}>
          {dateStr} · {count} {count === 1 ? 'плитка' : count < 5 ? 'плитки' : 'плиток'}
        </div>
        <h1 style={{
          margin: 0,
          fontFamily: 'var(--font-head)', fontWeight: 600,
          fontSize: view === 'phone' ? 26 : view === 'tablet' ? 32 : 38,
          letterSpacing: -0.8,
          textWrap: 'balance',
        }}>{title}</h1>
      </div>
    </header>
  );
}

window.App = App;
