/* global React, I */
// CreateModal + EmptyState + Sidebar

const COLOR_CHOICES = ['terra', 'indigo', 'olive', 'mustard', 'rose', 'clay'];
const SIZE_CHOICES  = [
  { v: 's',    label: '1×1' },
  { v: 'm',    label: '2×1' },
  { v: 'wide', label: '3×1' },
  { v: 'l',    label: '2×2' },
];
const TAG_CHOICES = ['Работа', 'Личное', 'Дом', 'Спорт', 'Чтение', 'Письмо', 'Путешествия'];

function CreateModal({ open, onClose, onSubmit, onDelete, view = 'desktop', initial }) {
  const [title, setTitle] = React.useState('');
  const [note, setNote]   = React.useState('');
  const [color, setColor] = React.useState('terra');
  const [size, setSize]   = React.useState('m');
  const [due, setDue]     = React.useState(24); // hours from now
  const [tag, setTag]     = React.useState('Работа');

  React.useEffect(() => {
    if (open) {
      setTitle(initial?.title || '');
      setNote(initial?.note || '');
      setColor(initial?.color || 'terra');
      setSize(initial?.size || 'm');
      setTag(initial?.tag || 'Работа');
      setDue(24);
    }
  }, [open, initial]);

  if (!open) return null;

  const isPhone = view === 'phone';

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'rgba(20, 14, 8, 0.36)',
      backdropFilter: 'blur(2px)',
      display: 'grid', placeItems: isPhone ? 'end' : 'center',
      zIndex: 50,
      animation: 'fade-in 200ms ease',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: isPhone ? '100%' : 'min(520px, 92%)',
        background: 'var(--surface)',
        border: 'var(--tile-border)',
        borderRadius: isPhone ? '20px 20px 0 0' : 'var(--radius-tile)',
        boxShadow: 'var(--shadow-lg)',
        padding: '22px 24px 20px',
        maxHeight: '92%',
        overflowY: 'auto',
        animation: isPhone ? 'sheet-up 280ms cubic-bezier(.2,.7,.3,1.1)' : 'pop-in 240ms cubic-bezier(.2,.7,.3,1.3)',
      }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontWeight: 600, fontSize: 18, letterSpacing: -0.3 }}>
            {initial ? 'Редактировать задачу' : 'Новая задача'}
          </h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--ink-soft)', padding: 4, display: 'grid', placeItems: 'center' }}>
            <I.X size={18}/>
          </button>
        </header>

        <input autoFocus placeholder="Что нужно сделать?" value={title} onChange={e => setTitle(e.target.value)} style={{
          width: '100%', padding: '12px 14px',
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-button)',
          fontFamily: 'var(--font-head)', fontSize: 16,
          color: 'var(--ink)', outline: 'none', marginBottom: 10,
        }}/>

        <textarea placeholder="Заметка (опционально)" value={note} onChange={e => setNote(e.target.value)} rows={2} style={{
          width: '100%', padding: '11px 14px',
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-button)',
          fontFamily: 'var(--font-head)', fontSize: 13,
          color: 'var(--ink)', outline: 'none', resize: 'none', marginBottom: 16,
        }}/>

        {/* Color */}
        <Group label="Цвет плитки">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {COLOR_CHOICES.map(c => (
              <button key={c} onClick={() => setColor(c)} aria-label={c}
                style={{
                  width: 32, height: 32, borderRadius: 8, padding: 0,
                  background: `var(--accent-${c === 'terra' ? 'terra' : c === 'indigo' ? 'indigo' : c === 'olive' ? 'olive' : c === 'mustard' ? 'mustard' : c === 'rose' ? 'rose' : 'clay'})`,
                  border: color === c ? '2.5px solid var(--ink)' : 'var(--tile-border)',
                  boxShadow: color === c ? 'var(--shadow-md)' : 'var(--shadow-sm)',
                  transform: color === c ? 'scale(1.08)' : 'scale(1)',
                  transition: 'transform 180ms',
                }}/>
            ))}
          </div>
        </Group>

        {/* Size */}
        <Group label="Размер плитки">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {SIZE_CHOICES.map(s => (
              <button key={s.v} onClick={() => setSize(s.v)} style={{
                padding: '7px 12px',
                background: size === s.v ? 'var(--ink)' : 'var(--surface-2)',
                color: size === s.v ? 'var(--surface)' : 'var(--ink)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-button)',
                fontFamily: 'var(--font-mono)', fontSize: 11,
              }}>{s.label}</button>
            ))}
          </div>
        </Group>

        {/* Tag */}
        <Group label="Тег">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {TAG_CHOICES.map(t => (
              <button key={t} onClick={() => setTag(t)} style={{
                padding: '6px 12px',
                background: tag === t ? 'var(--accent-indigo)' : 'var(--surface-2)',
                color: tag === t ? '#fffaf0' : 'var(--ink-soft)',
                border: '1px solid var(--border)',
                borderRadius: 999, fontSize: 12, fontWeight: 500,
              }}>{t}</button>
            ))}
          </div>
        </Group>

        {/* Deadline */}
        <Group label={`Дедлайн — через ${due}ч`}>
          <input type="range" min={1} max={168} value={due} onChange={e => setDue(+e.target.value)} style={{
            width: '100%', accentColor: 'var(--accent-terra)',
          }}/>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faint)', marginTop: 2 }}>
            <span>1ч</span><span>1д</span><span>3д</span><span>7д</span>
          </div>
        </Group>

        <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' }}>
          {initial && onDelete && (
            <button onClick={() => { onDelete(initial.id); }} title="Удалить" style={{
              width: 42, height: 42,
              background: 'transparent',
              color: 'var(--accent-terra)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-button)',
              display: 'grid', placeItems: 'center', cursor: 'pointer',
            }}>
              <I.Trash size={16}/>
            </button>
          )}
          <button onClick={onClose} style={{
            flex: 1, padding: '11px 16px',
            background: 'var(--surface-2)', color: 'var(--ink)',
            border: '1px solid var(--border)', borderRadius: 'var(--radius-button)',
            fontFamily: 'var(--font-head)', fontWeight: 500, fontSize: 13,
          }}>Отмена</button>
          <button onClick={() => { onSubmit({ title: title || 'Новая задача', note, color, size, tag, dueInHours: due }); }} style={{
            flex: 2, padding: '11px 16px',
            background: 'var(--ink)', color: 'var(--surface)',
            border: 'var(--tile-border)', borderRadius: 'var(--radius-button)',
            fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 13,
            boxShadow: 'var(--shadow-sm)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            {initial ? (<><I.Check size={14} stroke={2.4}/> Сохранить</>) : (<><I.Plus size={14} stroke={2.2}/> Добавить</>)}
          </button>
        </div>

        <style>{`
          @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
          @keyframes pop-in  { from { opacity: 0; transform: scale(0.96) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
          @keyframes sheet-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
        `}</style>
      </div>
    </div>
  );
}

function Group({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 8, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function EmptyState({ onCreate, view = 'desktop' }) {
  return (
    <div style={{
      display: 'grid', placeItems: 'center',
      minHeight: view === 'phone' ? 360 : 420,
      padding: 24,
    }}>
      <div style={{ textAlign: 'center', maxWidth: 320 }}>
        <div style={{
          position: 'relative', width: 130, height: 110, margin: '0 auto 22px',
        }}>
          {/* Stacked empty tiles */}
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              position: 'absolute', left: i * 6, top: i * -3,
              width: 110, height: 80,
              background: ['var(--accent-mustard)', 'var(--accent-terra)', 'var(--accent-indigo)'][i],
              borderRadius: 'var(--radius-tile)',
              border: 'var(--tile-border)',
              boxShadow: 'var(--shadow-md)',
              transform: `rotate(${(i - 1) * 4}deg)`,
              opacity: 0.5 + i * 0.18,
            }}/>
          ))}
        </div>
        <h3 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 600, letterSpacing: -0.4 }}>
          Чисто и пусто
        </h3>
        <p style={{ margin: '0 0 20px', color: 'var(--ink-soft)', fontSize: 14, lineHeight: 1.4 }}>
          Добавьте первую плитку и расставьте их перетаскиванием — самые важные наверх.
        </p>
        <button onClick={onCreate} style={{
          padding: '11px 18px',
          background: 'var(--accent-terra)',
          color: '#fffaf0',
          border: 'var(--tile-border)',
          borderRadius: 'var(--radius-button)',
          fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 13,
          boxShadow: 'var(--shadow-md)',
          display: 'inline-flex', alignItems: 'center', gap: 8,
        }}>
          <I.Plus size={14} stroke={2.2}/>
          Создать первую задачу
        </button>
      </div>
    </div>
  );
}

function Sidebar({ active = 'today', onPick, view = 'desktop' }) {
  const items = [
    { id: 'inbox',    label: 'Входящие',  icon: <I.Inbox size={16}/>,  count: 12 },
    { id: 'today',    label: 'Сегодня',   icon: <I.Today size={16}/>,  count: 5,  active: true },
    { id: 'upcoming', label: 'Скоро',     icon: <I.Cal size={16}/>,    count: 8 },
    { id: 'starred',  label: 'Важные',    icon: <I.Star size={16}/>,   count: 3 },
  ];
  const projects = [
    { id: 'work',     label: 'Работа',     color: 'var(--accent-indigo)' },
    { id: 'personal', label: 'Личное',     color: 'var(--accent-terra)' },
    { id: 'home',     label: 'Дом',        color: 'var(--accent-olive)' },
    { id: 'travel',   label: 'Путешествия', color: 'var(--accent-mustard)' },
  ];
  return (
    <aside style={{
      width: view === 'tablet' ? 200 : 220,
      padding: '18px 14px',
      background: 'var(--bg-2)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', gap: 18,
      flexShrink: 0,
    }}>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map(it => (
          <button key={it.id} onClick={() => onPick && onPick(it.id)} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 11px',
            background: active === it.id ? 'var(--surface)' : 'transparent',
            border: active === it.id ? 'var(--tile-border)' : '1px solid transparent',
            borderRadius: 'var(--radius-button)',
            color: 'var(--ink)',
            fontFamily: 'var(--font-head)', fontSize: 13, fontWeight: 500,
            textAlign: 'left',
            boxShadow: active === it.id ? 'var(--shadow-sm)' : 'none',
          }}>
            <span style={{ color: 'var(--ink-soft)' }}>{it.icon}</span>
            <span style={{ flex: 1 }}>{it.label}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-faint)' }}>{it.count}</span>
          </button>
        ))}
      </nav>

      <div>
        <div style={{ fontSize: 10, color: 'var(--ink-faint)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', letterSpacing: 0.6, padding: '0 11px 8px' }}>
          Проекты
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {projects.map(p => (
            <button key={p.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 11px', background: 'transparent', border: '1px solid transparent',
              borderRadius: 'var(--radius-button)',
              color: 'var(--ink-soft)', fontFamily: 'var(--font-head)', fontSize: 13,
              textAlign: 'left',
            }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: p.color, border: 'var(--tile-border)' }}/>
              <span>{p.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1 }}/>

      <div style={{
        padding: 12,
        background: 'var(--surface)',
        border: '1px dashed var(--border-strong)',
        borderRadius: 'var(--radius-button)',
        fontSize: 11, color: 'var(--ink-soft)',
        lineHeight: 1.4,
      }}>
        <strong style={{ display: 'block', color: 'var(--ink)', marginBottom: 4 }}>Подсказка</strong>
        Перетащите плитку выше — она станет приоритетней.
      </div>
    </aside>
  );
}

window.CreateModal = CreateModal;
window.EmptyState = EmptyState;
window.Sidebar = Sidebar;
