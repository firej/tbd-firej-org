/* global React, I, heatOf, formatDue, formatDueShort */
// Tile = the colored task card. Adapts to theme via CSS vars.
// Props: task, density ('cozy'|'compact'), onToggle, onPick, isDragging, dropAbove, dropBelow

const COLOR_MAP = {
  terra:   { bg: 'var(--accent-terra)',   ink: '#fffaf0', mute: '#fffaf0' },
  indigo:  { bg: 'var(--accent-indigo)',  ink: '#fffaf0', mute: '#fffaf0' },
  olive:   { bg: 'var(--accent-olive)',   ink: '#fffaf0', mute: '#fffaf0' },
  mustard: { bg: 'var(--accent-mustard)', ink: '#1f1a14', mute: '#1f1a14' },
  rose:    { bg: 'var(--accent-rose)',    ink: '#fffaf0', mute: '#fffaf0' },
  clay:    { bg: 'var(--accent-clay)',    ink: '#fffaf0', mute: '#fffaf0' },
};

// Heat overlay (a warm-red wash that grows as deadline approaches)
function heatOverlay(heat) {
  if (heat < 0.5) return 'transparent';
  const alpha = Math.min(0.55, (heat - 0.5) * 1.1);
  return `linear-gradient(180deg, transparent 0%, rgba(220, 60, 40, ${alpha.toFixed(2)}) 110%)`;
}

function DeadlineMeter({ heat, color }) {
  // Bottom progress bar — not thin (10px), with chamfered stripe pattern when overdue.
  const pct = Math.min(1, heat) * 100;
  // Color: green-ish → mustard → red
  const stops = [
    [0.0,  [125, 139,  63]], // olive
    [0.55, [200, 154,  60]], // mustard
    [0.85, [217, 119,  87]], // terra
    [1.0,  [196,  62,  47]], // hot
  ];
  function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
  function colorAt(h) {
    for (let i = 1; i < stops.length; i++) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      if (h <= t1) {
        const t = (h - t0) / (t1 - t0 || 1);
        return `rgb(${lerp(c0[0], c1[0], t)}, ${lerp(c0[1], c1[1], t)}, ${lerp(c0[2], c1[2], t)})`;
      }
    }
    return `rgb(196,62,47)`;
  }

  return (
    <div style={{
      position: 'relative',
      height: 10,
      width: '100%',
      background: 'rgba(0,0,0,0.18)',
      borderTop: '1px solid rgba(0,0,0,0.12)',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        width: `${pct}%`,
        background: heat > 1
          ? `repeating-linear-gradient(45deg, ${colorAt(1)} 0 6px, rgba(255,255,255,0.25) 6px 12px)`
          : colorAt(heat),
        transition: 'width 600ms ease',
      }}/>
    </div>
  );
}

function Tile({ task, density = 'cozy', onToggle, onPick, onDelete, isDragging, dropHint, draggable = true, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd, themeStyle = 'paper' }) {
  const heat = heatOf(task);
  const c = COLOR_MAP[task.color] || COLOR_MAP.indigo;
  const isCompact = density === 'compact' || task.size === 's';

  // Subtle rotation for the collage theme (only on small tiles)
  const rotate = themeStyle === 'collage'
    ? (parseInt(task.id.slice(1), 10) % 5 - 2) * 0.4
    : 0;

  return (
    <article
      className={`tile tile--${task.size}${isDragging ? ' is-dragging' : ''}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={onPick}
      style={{
        position: 'relative',
        background: c.bg,
        color: c.ink,
        borderRadius: 'var(--radius-tile)',
        border: 'var(--tile-border)',
        boxShadow: isDragging ? 'var(--shadow-lg)' : 'var(--shadow-md)',
        cursor: 'grab',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        userSelect: 'none',
        transform: `rotate(${rotate}deg) ${isDragging ? 'scale(1.02)' : ''}`,
        opacity: task.done ? 0.55 : 1,
        transition: 'transform 220ms cubic-bezier(.2,.7,.3,1.4), box-shadow 200ms, opacity 200ms',
      }}>

      <style>{`
        .tile .tile-del { opacity: 0; transition: opacity 160ms, transform 160ms, background 160ms; }
        .tile:hover .tile-del,
        .tile:focus-within .tile-del { opacity: 1; }
        .tile .tile-del:hover { background: rgba(0,0,0,0.28); transform: scale(1.08); }
      `}</style>

      {/* Delete button (top-right, hover-revealed) */}
      {onDelete && (
        <button
          className="tile-del"
          onClick={(e) => { e.stopPropagation(); onDelete(task.id); }}
          aria-label="Удалить задачу"
          title="Удалить"
          style={{
            position: 'absolute', top: 8, right: 8, zIndex: 6,
            width: 22, height: 22, borderRadius: 999,
            background: 'rgba(0,0,0,0.18)',
            color: c.ink,
            border: 'none',
            display: 'grid', placeItems: 'center',
            padding: 0, cursor: 'pointer',
          }}>
          <I.X size={13} stroke={2.4}/>
        </button>
      )}

      {/* Drop hint line */}
      {dropHint === 'above' && (
        <div style={{ position: 'absolute', top: -6, left: 0, right: 0, height: 4, background: 'var(--accent-terra)', borderRadius: 4, zIndex: 5 }}/>
      )}
      {dropHint === 'below' && (
        <div style={{ position: 'absolute', bottom: -6, left: 0, right: 0, height: 4, background: 'var(--accent-terra)', borderRadius: 4, zIndex: 5 }}/>
      )}

      {/* Heat wash on top of background */}
      <div style={{
        position: 'absolute', inset: 0,
        background: heatOverlay(heat),
        pointerEvents: 'none',
        opacity: task.done ? 0 : 1,
      }}/>

      {/* Texture */}
      <div className="paper-texture" style={{ opacity: themeStyle === 'collage' ? 0.18 : 0.10, mixBlendMode: 'multiply' }}/>

      <div style={{
        position: 'relative',
        padding: isCompact ? '12px 14px 10px' : '16px 18px 12px',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: isCompact ? 6 : 10,
        zIndex: 2,
      }}>

        {/* Header row: checkbox + tag */}
        <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={(e) => { e.stopPropagation(); onToggle && onToggle(task.id); }}
            aria-label="Отметить"
            style={{
              width: 20, height: 20, borderRadius: 6,
              background: task.done ? c.ink : 'transparent',
              color: task.done ? c.bg : c.ink,
              border: `1.6px solid ${c.ink}`,
              padding: 0, display: 'grid', placeItems: 'center', flexShrink: 0,
            }}>
            {task.done && <I.Check size={13} stroke={2.4}/>}
          </button>

          {task.tag && (
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              padding: '2px 7px',
              border: `1px solid ${c.ink}`,
              borderRadius: 999,
              opacity: 0.75,
            }}>{task.tag}</span>
          )}

          <div style={{ flex: 1 }}/>

          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            opacity: 0.78,
            whiteSpace: 'nowrap',
          }}>{formatDueShort(task.due)}</span>
        </header>

        {/* Title */}
        <h3 style={{
          fontFamily: 'var(--font-head)',
          fontWeight: 600,
          margin: 0,
          fontSize: task.size === 'l' ? 22 : task.size === 'wide' ? 19 : isCompact ? 15 : 17,
          lineHeight: 1.18,
          letterSpacing: -0.2,
          textDecoration: task.done ? 'line-through' : 'none',
          textWrap: 'pretty',
        }}>{task.title}</h3>

        {/* Note */}
        {task.note && !isCompact && (
          <p style={{
            margin: 0,
            fontSize: 13,
            opacity: 0.82,
            lineHeight: 1.35,
          }}>{task.note}</p>
        )}

        {/* Subtasks (only for large) */}
        {task.sub && task.sub.length > 0 && task.size === 'l' && (
          <ul style={{
            margin: 'auto 0 0', padding: 0, listStyle: 'none',
            display: 'flex', flexDirection: 'column', gap: 4,
            fontSize: 13,
          }}>
            {task.sub.map(s => (
              <li key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: s.done ? 0.65 : 1 }}>
                <span style={{
                  width: 12, height: 12, borderRadius: 3,
                  background: s.done ? c.ink : 'transparent',
                  border: `1.4px solid ${c.ink}`,
                  display: 'inline-block',
                }}/>
                <span style={{ textDecoration: s.done ? 'line-through' : 'none' }}>{s.text}</span>
              </li>
            ))}
          </ul>
        )}

        <div style={{ flex: 1 }}/>

        {/* Footer row: deadline pill */}
        <footer style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, opacity: 0.85, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            <I.Clock size={12} stroke={1.8}/>
            {formatDue(task.due)}
          </span>
        </footer>
      </div>

      <DeadlineMeter heat={heat} />
    </article>
  );
}

window.Tile = Tile;
window.DeadlineMeter = DeadlineMeter;
