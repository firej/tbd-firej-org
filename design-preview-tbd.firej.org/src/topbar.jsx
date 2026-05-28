/* global React, I, SyncIndicator */
// TopBar — brand mark + sync status + avatar.

function Brand({ size = 22, compact = false }) {
  // "tobedone" wordmark — playful, custom-drawn-ish using Space Grotesk
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{
        display: 'inline-grid', placeItems: 'center',
        width: size + 6, height: size + 6,
        background: 'var(--accent-terra)',
        color: '#fffaf0',
        borderRadius: 8,
        border: 'var(--tile-border)',
        boxShadow: 'var(--shadow-sm)',
        fontFamily: 'var(--font-head)',
        fontWeight: 700,
        fontSize: size * 0.62,
        letterSpacing: -1,
        transform: 'rotate(-3deg)',
      }}>tbd</span>
      {!compact && (
        <span style={{
          fontFamily: 'var(--font-head)',
          fontWeight: 600,
          fontSize: size * 0.78,
          letterSpacing: -0.4,
          color: 'var(--ink)',
        }}>
          tobedone
        </span>
      )}
    </div>
  );
}

function Avatar({ name = 'Лена', size = 30, ring }) {
  const initials = name.split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase();
  return (
    <span style={{
      display: 'inline-grid', placeItems: 'center',
      width: size, height: size, borderRadius: 999,
      background: 'var(--accent-indigo)',
      color: '#fffaf0',
      fontFamily: 'var(--font-head)', fontWeight: 600,
      fontSize: size * 0.4,
      border: ring ? `2px solid ${ring}` : 'var(--tile-border)',
      boxShadow: 'var(--shadow-sm)',
    }}>
      {initials}
    </span>
  );
}

function TopBar({ syncState, onChangeSync, query, setQuery, onCreate, dark, onToggleDark, view = 'desktop' }) {
  const isPhone = view === 'phone';
  return (
    <header style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: isPhone ? '14px 16px 12px' : '18px 24px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--surface)',
      position: 'relative', zIndex: 4,
    }}>
      <Brand size={isPhone ? 20 : 22} compact={false}/>
      <div style={{ flex: 1 }}/>

      {!isPhone && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--surface-2)',
          padding: '7px 12px',
          borderRadius: 'var(--radius-button)',
          border: '1px solid var(--border)',
          minWidth: 260,
        }}>
          <I.Search size={15} stroke={1.8}/>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Найти задачу…"
            style={{
              border: 'none', background: 'transparent', outline: 'none',
              flex: 1, fontSize: 13, color: 'var(--ink)',
              fontFamily: 'var(--font-head)',
            }}/>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, opacity: 0.5 }}>⌘K</span>
        </div>
      )}

      {/* sync state (clickable: cycles for demo) */}
      <button
        onClick={onChangeSync}
        title="Переключить состояние синка"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          background: 'transparent', border: 'none', padding: 4, borderRadius: 8,
        }}>
        <SyncIndicator state={syncState} label={!isPhone} compact={isPhone}/>
      </button>

      <button
        onClick={onToggleDark}
        title="Тема"
        style={{
          width: 34, height: 34, borderRadius: 'var(--radius-button)',
          border: '1px solid var(--border)',
          background: 'var(--surface-2)',
          color: 'var(--ink)',
          display: 'grid', placeItems: 'center',
        }}>
        {dark ? <I.Sun size={16}/> : <I.Moon size={16}/>}
      </button>

      <button
        onClick={onCreate}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: isPhone ? '8px 10px' : '8px 14px',
          background: 'var(--ink)',
          color: 'var(--surface)',
          border: 'var(--tile-border)',
          borderRadius: 'var(--radius-button)',
          fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 13,
          boxShadow: 'var(--shadow-sm)',
        }}>
        <I.Plus size={14} stroke={2.2}/>
        {!isPhone && 'Новая задача'}
      </button>

      <Avatar name="Лена Кр"/>
    </header>
  );
}

window.Brand = Brand;
window.Avatar = Avatar;
window.TopBar = TopBar;
