/* global React, App, DesktopFrame, IPadFrame, IOSDevice, useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakColor, Brand */

// Demo — full-viewport interactive prototype with device switcher.

const DEFAULTS = /*EDITMODE-BEGIN*/{
  "dark": false,
  "accent": "#d97757"
}/*EDITMODE-END*/;

const DEVICE_SIZES = {
  desktop: { w: 1280, h: 780 },
  tablet:  { w: 820,  h: 1060 },
  phone:   { w: 402,  h: 874 },
};

function useFitScale(targetW, targetH, padding = 56) {
  const [scale, setScale] = React.useState(1);
  React.useEffect(() => {
    function update() {
      const vw = window.innerWidth  - padding * 2;
      const vh = window.innerHeight - padding * 2 - 88;
      const sx = vw / targetW;
      const sy = vh / targetH;
      setScale(Math.min(1, sx, sy));
    }
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [targetW, targetH, padding]);
  return scale;
}

function DeviceSwitcher({ value, onChange }) {
  const opts = [
    { v: 'desktop', label: 'Desktop' },
    { v: 'tablet',  label: 'iPad' },
    { v: 'phone',   label: 'iPhone' },
  ];
  return (
    <div role="tablist" style={{
      display: 'inline-flex', alignItems: 'center',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: 4, gap: 2,
      boxShadow: 'var(--shadow-sm)',
    }}>
      {opts.map(o => (
        <button key={o.v} role="tab" aria-selected={value === o.v} onClick={() => onChange(o.v)} style={{
          padding: '8px 14px',
          background: value === o.v ? 'var(--ink)' : 'transparent',
          color:      value === o.v ? 'var(--surface)' : 'var(--ink)',
          border: 'none',
          borderRadius: 8,
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 600,
          fontSize: 13,
          cursor: 'pointer',
          transition: 'all 220ms',
        }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Demo() {
  const [t, setTweak] = useTweaks(DEFAULTS);
  const [view, setView] = React.useState('desktop');
  const [authed, setAuthed] = React.useState(false);

  const size = DEVICE_SIZES[view];
  const scale = useFitScale(size.w, size.h, 56);

  React.useEffect(() => {
    document.documentElement.style.setProperty('--accent-terra', t.accent || '#d97757');
  }, [t.accent]);

  const themeClass = `theme-paper${t.dark ? ' dark' : ''}`;

  return (
    <div className={themeClass} style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      color: 'var(--ink)',
      display: 'flex', flexDirection: 'column',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div className="paper-texture"/>
      <Decor/>

      {/* Floating toolbar */}
      <header style={{
        position: 'relative', zIndex: 10,
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '20px 28px',
      }}>
        <Brand size={22}/>
        <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: 0.6, color: 'var(--ink-faint)', textTransform: 'uppercase', marginLeft: 2 }}>
          · демо · direction A
        </span>

        <div style={{ flex: 1 }}/>

        <DeviceSwitcher value={view} onChange={setView}/>

        {authed && (
          <button onClick={() => setAuthed(false)} style={{
            padding: '8px 14px',
            background: 'transparent',
            color: 'var(--ink-soft)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-button)',
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 500,
            fontSize: 13,
            cursor: 'pointer',
          }}>
            Выйти
          </button>
        )}
      </header>

      {/* Stage */}
      <main style={{
        flex: 1,
        position: 'relative', zIndex: 1,
        display: 'grid', placeItems: 'center',
        padding: '0 56px 56px',
      }}>
        <div style={{
          width: size.w * scale,
          height: size.h * scale,
        }}>
          <div style={{
            width: size.w, height: size.h,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            transition: 'transform 360ms cubic-bezier(.2,.7,.3,1.2)',
          }}>
            <DeviceShell key={view} view={view} size={size}>
              <App
                view={view}
                themeStyle="paper"
                authed={authed}
                onAuthChange={setAuthed}
                initialDark={t.dark}
                showSidebar={view !== 'phone'}
              />
            </DeviceShell>
          </div>
        </div>
      </main>

      {/* Tweaks */}
      <TweaksPanel>
        <TweakSection label="Тема"/>
        <TweakToggle label="Тёмная" value={t.dark} onChange={v => setTweak('dark', v)}/>
        <TweakColor  label="Акцент" value={t.accent}
                     options={['#d97757', '#4f5fb3', '#7d8b3f', '#c89a3c', '#c75d72']}
                     onChange={v => setTweak('accent', v)}/>
        <TweakSection label="Устройство"/>
        <TweakRadio  label="Вид" value={view}
                     options={['desktop', 'tablet', 'phone']}
                     onChange={setView}/>
      </TweaksPanel>
    </div>
  );
}

function DeviceShell({ view, size, children }) {
  if (view === 'desktop') {
    return <DesktopFrame width={size.w} height={size.h} label="tobedone.app">{children}</DesktopFrame>;
  }
  if (view === 'tablet') {
    return <IPadFrame width={size.w} height={size.h}>{children}</IPadFrame>;
  }
  return <IOSDevice width={size.w} height={size.h}>{children}</IOSDevice>;
}

function Decor() {
  return (
    <>
      <div style={{
        position: 'absolute', top: '-8%', left: '-6%',
        width: 360, height: 360, borderRadius: '50%',
        background: 'radial-gradient(circle at 30% 30%, rgba(217,119,87,0.28), transparent 70%)',
        filter: 'blur(40px)', pointerEvents: 'none', zIndex: 0,
      }}/>
      <div style={{
        position: 'absolute', bottom: '-10%', right: '-8%',
        width: 460, height: 460, borderRadius: '50%',
        background: 'radial-gradient(circle at 70% 70%, rgba(79,95,179,0.20), transparent 70%)',
        filter: 'blur(50px)', pointerEvents: 'none', zIndex: 0,
      }}/>
      <div style={{
        position: 'absolute', top: '38%', right: '-5%',
        width: 280, height: 280, borderRadius: '50%',
        background: 'radial-gradient(circle at 50% 50%, rgba(125,139,63,0.16), transparent 70%)',
        filter: 'blur(40px)', pointerEvents: 'none', zIndex: 0,
      }}/>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Demo/>);
