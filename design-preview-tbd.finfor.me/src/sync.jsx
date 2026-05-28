/* global React, I */
// SyncIndicator — animated arrows when syncing, check when synced, cloud-off when offline, warn on error.

const SYNC_STATES = ['synced', 'syncing', 'offline', 'error'];

function SyncIndicator({ state = 'synced', label = true, compact = false, size = 18 }) {
  const styles = {
    synced:  { color: 'var(--accent-olive)',  text: 'Синхронизировано' },
    syncing: { color: 'var(--accent-indigo)', text: 'Синхронизация…'    },
    offline: { color: 'var(--ink-faint)',     text: 'Оффлайн'           },
    error:   { color: 'var(--accent-terra)',  text: 'Ошибка синка'      },
  }[state] || {};

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      color: styles.color,
      fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: 0.3,
    }}>
      <span style={{
        position: 'relative', display: 'grid', placeItems: 'center',
        width: size + 8, height: size + 8, borderRadius: 999,
        background: 'color-mix(in oklab, currentColor 12%, transparent)',
      }}>
        {state === 'syncing' && (
          <span style={{ display: 'inline-flex', animation: 'sync-spin 1.1s linear infinite' }}>
            <I.Sync size={size} stroke={2}/>
          </span>
        )}
        {state === 'synced'  && <I.Check size={size} stroke={2.4}/>}
        {state === 'offline' && <I.CloudOff size={size} stroke={2}/>}
        {state === 'error'   && <I.Warn size={size} stroke={2.2}/>}

        {/* pulse dot */}
        {state === 'syncing' && (
          <span style={{
            position: 'absolute', top: -1, right: -1, width: 8, height: 8, borderRadius: 999,
            background: 'var(--accent-indigo)',
            animation: 'sync-pulse 1.1s ease-in-out infinite',
          }}/>
        )}
        {state === 'error' && (
          <span style={{
            position: 'absolute', top: -1, right: -1, width: 8, height: 8, borderRadius: 999,
            background: 'var(--accent-terra)',
            animation: 'sync-pulse 1.6s ease-in-out infinite',
          }}/>
        )}
      </span>
      {!compact && label && <span style={{ textTransform: 'uppercase', opacity: 0.85 }}>{styles.text}</span>}
      <style>{`
        @keyframes sync-spin { to { transform: rotate(360deg); } }
        @keyframes sync-pulse { 0%, 100% { transform: scale(0.6); opacity: 0.4; } 50% { transform: scale(1.2); opacity: 1; } }
      `}</style>
    </span>
  );
}

window.SyncIndicator = SyncIndicator;
window.SYNC_STATES = SYNC_STATES;
