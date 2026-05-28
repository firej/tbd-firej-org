/* global React */
// Device frames — Desktop window, iPad, (Phone uses IOSDevice from ios-frame.jsx)

function DesktopFrame({ width = 1100, height = 700, children, label = 'tobedone.app' }) {
  return (
    <div style={{
      width, height,
      background: '#11100c',
      borderRadius: 14,
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: '0 28px 60px -22px rgba(40,30,15,0.45), 0 8px 16px -8px rgba(40,30,15,0.2)',
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Title bar */}
      <div style={{
        height: 32, flexShrink: 0,
        background: 'linear-gradient(180deg, #2a2620, #1d1a15)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center', padding: '0 12px',
        gap: 8,
      }}>
        <span style={{ width: 12, height: 12, borderRadius: 999, background: '#ff5f57' }}/>
        <span style={{ width: 12, height: 12, borderRadius: 999, background: '#ffbd2e' }}/>
        <span style={{ width: 12, height: 12, borderRadius: 999, background: '#28c940' }}/>
        <div style={{ flex: 1 }}/>
        <div style={{
          padding: '4px 12px', borderRadius: 6,
          background: 'rgba(255,255,255,0.06)',
          color: 'rgba(255,255,255,0.7)',
          fontFamily: "'Space Mono', monospace", fontSize: 11,
          minWidth: 220, textAlign: 'center',
        }}>🔒 {label}</div>
        <div style={{ flex: 1 }}/>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {children}
      </div>
    </div>
  );
}

function IPadFrame({ width = 760, height = 980, children, orientation = 'portrait' }) {
  const isPortrait = orientation === 'portrait';
  const w = isPortrait ? width : height;
  const h = isPortrait ? height : width;
  return (
    <div style={{
      width: w, height: h,
      background: '#1c1a16',
      borderRadius: 36,
      padding: 14,
      boxShadow: '0 28px 60px -22px rgba(40,30,15,0.45), 0 8px 16px -8px rgba(40,30,15,0.2), inset 0 0 0 2px rgba(255,255,255,0.05)',
      position: 'relative',
    }}>
      {/* Camera dot */}
      <div style={{
        position: 'absolute',
        top: isPortrait ? 22 : '50%',
        left: isPortrait ? '50%' : 22,
        width: 6, height: 6, borderRadius: 999,
        background: '#0a0908',
        transform: isPortrait ? 'translateX(-50%)' : 'translateY(-50%)',
      }}/>
      <div style={{
        width: '100%', height: '100%',
        borderRadius: 22,
        overflow: 'hidden',
        background: 'var(--bg)',
        position: 'relative',
      }}>
        {children}
      </div>
    </div>
  );
}

window.DesktopFrame = DesktopFrame;
window.IPadFrame    = IPadFrame;
