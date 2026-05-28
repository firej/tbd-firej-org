/* global React, DesignCanvas, DCSection, DCArtboard, DCPostIt, IOSDevice, DesktopFrame, IPadFrame, App, LoginScreen, CreateModal, MOCK_TASKS, SyncIndicator, I, Tile */

// ---------- Device switcher (mini interactive prototype) ----------
function LivePrototype() {
  const [view, setView] = React.useState('desktop');
  const sizes = {
    desktop: { w: 1240, h: 740 },
    tablet:  { w: 820,  h: 1060 },
    phone:   { w: 390,  h: 760 },
  };
  const s = sizes[view];

  // container is fixed; we center the chosen device inside
  return (
    <div style={{
      width: 1400, height: 1180,
      background: 'linear-gradient(180deg, #efe4ce 0%, #e3d6ba 100%)',
      borderRadius: 8,
      position: 'relative',
      padding: '20px 24px 32px',
      display: 'flex',
      flexDirection: 'column',
      gap: 18,
      overflow: 'hidden',
    }}>
      <div className="paper-texture theme-paper" style={{ opacity: 0.14 }}/>

      {/* Device picker */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', zIndex: 2 }}>
        <div>
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: 0.5, color: '#7a6a52', textTransform: 'uppercase' }}>
            Живой прототип · кликабельно
          </div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 22, color: '#2a241d', letterSpacing: -0.4, marginTop: 2 }}>
            Попробуй — перетащи плитку, отметь задачу, переключи тему
          </div>
        </div>

        <div style={{
          display: 'inline-flex',
          background: '#fffaf0',
          border: '1px solid rgba(60,40,20,0.18)',
          borderRadius: 12,
          padding: 4,
          gap: 2,
          boxShadow: '0 8px 18px -10px rgba(60,40,20,0.25)',
        }}>
          {[
            { v: 'desktop', label: 'Desktop',  glyph: '▭' },
            { v: 'tablet',  label: 'iPad',     glyph: '▢' },
            { v: 'phone',   label: 'Phone',    glyph: '▯' },
          ].map(o => (
            <button key={o.v} onClick={() => setView(o.v)} style={{
              padding: '8px 14px',
              background: view === o.v ? '#2a241d' : 'transparent',
              color: view === o.v ? '#fffaf0' : '#2a241d',
              border: 'none',
              borderRadius: 8,
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 600,
              fontSize: 13,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ fontFamily: "'Space Mono', monospace" }}>{o.glyph}</span>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stage */}
      <div style={{
        flex: 1, display: 'grid', placeItems: 'center', position: 'relative', zIndex: 1,
        overflow: 'hidden',
      }}>
        <div className="theme-paper" style={{
          width: s.w, height: s.h,
          transition: 'width 360ms cubic-bezier(.2,.7,.3,1.2), height 360ms cubic-bezier(.2,.7,.3,1.2)',
        }}>
          {view === 'desktop' && (
            <DesktopFrame width={s.w} height={s.h}>
              <App view="desktop" themeStyle="paper"/>
            </DesktopFrame>
          )}
          {view === 'tablet' && (
            <IPadFrame width={s.w} height={s.h}>
              <App view="tablet" themeStyle="paper" showSidebar={false}/>
            </IPadFrame>
          )}
          {view === 'phone' && (
            <IOSDevice>
              <App view="phone" themeStyle="paper" showSidebar={false}/>
            </IOSDevice>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Direction artboard wrapper ----------
function Direction({ themeStyle, dark, initialSync = 'synced' }) {
  return (
    <div className={`theme-${themeStyle}${dark ? ' dark' : ''}`} style={{ width: '100%', height: '100%' }}>
      <DesktopFrame width={1240} height={740}>
        <App view="desktop" themeStyle={themeStyle} initialSync={initialSync} initialDark={dark}/>
      </DesktopFrame>
    </div>
  );
}

// ---------- Login showcase ----------
function LoginShowcase({ view, themeStyle = 'paper' }) {
  return (
    <div className={`theme-${themeStyle}`} style={{ width: '100%', height: '100%' }}>
      {view === 'desktop' && (
        <DesktopFrame width={1100} height={700} label="tobedone.app / войти">
          <LoginScreen view="desktop"/>
        </DesktopFrame>
      )}
      {view === 'phone' && (
        <IOSDevice title="">
          <LoginScreen view="phone"/>
        </IOSDevice>
      )}
    </div>
  );
}

// ---------- Sync states showcase ----------
function SyncStates() {
  const states = [
    { state: 'synced',  desc: 'Всё засинхрено' },
    { state: 'syncing', desc: 'Идёт синхронизация' },
    { state: 'offline', desc: 'Нет сети, работаем оффлайн' },
    { state: 'error',   desc: 'Ошибка — нужно вмешательство' },
  ];
  return (
    <div className="theme-paper" style={{
      width: 760, padding: 30,
      background: 'var(--bg)',
      borderRadius: 8,
      position: 'relative',
      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18,
    }}>
      <div className="paper-texture"/>
      {states.map(s => (
        <div key={s.state} style={{
          position: 'relative',
          background: 'var(--surface)',
          border: 'var(--tile-border)',
          borderRadius: 'var(--radius-tile)',
          boxShadow: 'var(--shadow-md)',
          padding: '18px 20px',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, textTransform: 'uppercase', color: 'var(--ink-faint)', letterSpacing: 0.6 }}>
            {s.state}
          </div>
          <SyncIndicator state={s.state}/>
          <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.35 }}>
            {s.desc}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- Drag-in-action snapshot ----------
function DragInAction() {
  // Show the app with one tile lifted and a drop-line above another tile
  return (
    <div className="theme-paper">
      <DesktopFrame width={1240} height={740}>
        <App
          view="desktop"
          themeStyle="paper"
          frozenDragId="t8"
          frozenHover={{ id: 't1', hint: 'above' }}
        />
      </DesktopFrame>
    </div>
  );
}

// ---------- Create modal showcase ----------
function CreateModalShowcase({ view = 'desktop' }) {
  const [open, setOpen] = React.useState(true);
  React.useEffect(() => { setOpen(true); }, []);
  return (
    <div className="theme-paper">
      {view === 'desktop' ? (
        <DesktopFrame width={1100} height={700} label="tobedone.app / новая задача">
          <div style={{ width: '100%', height: '100%', position: 'relative' }}>
            <App view="desktop" themeStyle="paper"/>
            <CreateModal open={open} onClose={() => setOpen(true)} onSubmit={() => {}} view="desktop"/>
          </div>
        </DesktopFrame>
      ) : (
        <IOSDevice title="Новая задача">
          <div style={{ width: '100%', height: '100%', position: 'relative' }}>
            <App view="phone" themeStyle="paper" showSidebar={false}/>
            <CreateModal open={open} onClose={() => setOpen(true)} onSubmit={() => {}} view="phone"/>
          </div>
        </IOSDevice>
      )}
    </div>
  );
}

// ---------- Empty state showcase ----------
function EmptyShowcase() {
  return (
    <div className="theme-paper">
      <DesktopFrame width={1100} height={700} label="tobedone.app / пусто">
        <App view="desktop" themeStyle="paper" startEmpty/>
      </DesktopFrame>
    </div>
  );
}

// ---------- iPad + Phone ----------
function IPadShowcase({ themeStyle = 'paper' }) {
  return (
    <div className={`theme-${themeStyle}`}>
      <IPadFrame width={820} height={1060}>
        <App view="tablet" themeStyle={themeStyle} showSidebar={false}/>
      </IPadFrame>
    </div>
  );
}

function PhoneShowcase({ themeStyle = 'paper', state }) {
  return (
    <div className={`theme-${themeStyle}`}>
      <IOSDevice title={state === 'empty' ? '' : 'tobedone'}>
        <App view="phone" themeStyle={themeStyle} showSidebar={false} startEmpty={state === 'empty'}/>
      </IOSDevice>
    </div>
  );
}

// ---------- Main canvas ----------
function TobeDoneCanvas() {
  return (
    <DesignCanvas>
      <DCSection id="live" title="Живой прототип" subtitle="Один экран, три устройства — переключайтесь и трогайте все элементы">
        <DCArtboard id="live-proto" label="Кликабельный прототип · все устройства в одном кадре" width={1400} height={1180}>
          <LivePrototype/>
        </DCArtboard>
      </DCSection>

      <DCSection id="dirs" title="Три направления · Desktop" subtitle="Одно приложение, три эстетики — сравните боком-о-бок">
        <DCArtboard id="dir-a" label="A · Бумажное бенто (рекомендую)"   width={1240} height={740}>
          <Direction themeStyle="paper"/>
        </DCArtboard>
        <DCArtboard id="dir-b" label="B · Цветные блоки (neo-brutalist warm)" width={1240} height={740}>
          <Direction themeStyle="blocks"/>
        </DCArtboard>
        <DCArtboard id="dir-c" label="C · Коллаж · стикеры" width={1240} height={740}>
          <Direction themeStyle="collage"/>
        </DCArtboard>
      </DCSection>

      <DCSection id="device-a" title="Direction A · iPad и iPhone" subtitle="Та же бенто-сетка адаптируется под планшет и телефон">
        <DCArtboard id="ipad-a"  label="iPad · 3 колонки" width={820} height={1060}>
          <IPadShowcase themeStyle="paper"/>
        </DCArtboard>
        <DCArtboard id="phone-a" label="iPhone · 2 колонки" width={400} height={870}>
          <PhoneShowcase themeStyle="paper"/>
        </DCArtboard>
        <DCArtboard id="dir-a-dark" label="A · Тёмная тема" width={820} height={520}>
          <div className="theme-paper dark" style={{ width: '100%', height: '100%' }}>
            <DesktopFrame width={820} height={520} label="tobedone.app">
              <App view="tablet" themeStyle="paper" initialDark showSidebar={false}/>
            </DesktopFrame>
          </div>
        </DCArtboard>
      </DCSection>

      <DCSection id="flows" title="Потоки и состояния" subtitle="Вход, пусто, создание задачи, перетаскивание в действии">
        <DCArtboard id="login-d" label="Экран входа · Desktop" width={1100} height={700}>
          <LoginShowcase view="desktop"/>
        </DCArtboard>
        <DCArtboard id="login-p" label="Экран входа · iPhone" width={400} height={870}>
          <LoginShowcase view="phone"/>
        </DCArtboard>
        <DCArtboard id="empty"  label="Пусто · Onboarding" width={1100} height={700}>
          <EmptyShowcase/>
        </DCArtboard>
        <DCArtboard id="create" label="Создание задачи · модалка" width={1100} height={700}>
          <CreateModalShowcase view="desktop"/>
        </DCArtboard>
        <DCArtboard id="create-p" label="Создание задачи · iPhone sheet" width={400} height={870}>
          <CreateModalShowcase view="phone"/>
        </DCArtboard>
        <DCArtboard id="drag"   label="Drag-and-drop в действии" width={1240} height={740}>
          <DragInAction/>
        </DCArtboard>
      </DCSection>

      <DCSection id="sync" title="Состояния синхронизации" subtitle="Анимированные индикаторы в топ-баре">
        <DCArtboard id="sync-states" label="4 состояния" width={760} height={420}>
          <SyncStates/>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<TobeDoneCanvas/>);
