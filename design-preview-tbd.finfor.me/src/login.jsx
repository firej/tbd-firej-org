/* global React, I, Brand */
// LoginScreen — Email + password, warm paper card

function LoginScreen({ onLogin, view = 'desktop' }) {
  const [email, setEmail] = React.useState('lena@tobedone.app');
  const [pwd, setPwd] = React.useState('•••••••••');
  const [showPwd, setShowPwd] = React.useState(false);
  const [stage, setStage] = React.useState('idle'); // idle | submitting

  const isPhone = view === 'phone';

  const submit = (e) => {
    e.preventDefault();
    setStage('submitting');
    setTimeout(() => { setStage('idle'); onLogin && onLogin(); }, 1100);
  };

  return (
    <div style={{
      width: '100%', height: '100%',
      background: 'var(--bg)',
      position: 'relative',
      display: 'grid',
      placeItems: 'center',
      padding: isPhone ? 18 : 40,
      overflow: 'hidden',
    }}>
      <div className="paper-texture"/>

      {/* Decorative bento tiles in background */}
      {!isPhone && <DecorTiles/>}

      <form onSubmit={submit} style={{
        position: 'relative',
        width: '100%',
        maxWidth: 380,
        background: 'var(--surface)',
        border: 'var(--tile-border)',
        borderRadius: 'var(--radius-tile)',
        boxShadow: 'var(--shadow-lg)',
        padding: isPhone ? '26px 22px' : '32px 30px',
        zIndex: 2,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 }}>
          <Brand size={24}/>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faint)', textTransform: 'uppercase' }}>v 0.3</span>
        </div>

        <h1 style={{
          fontFamily: 'var(--font-head)', fontWeight: 600,
          fontSize: 26, letterSpacing: -0.6, margin: '0 0 4px',
          textWrap: 'balance',
        }}>С возвращением</h1>
        <p style={{ margin: '0 0 22px', color: 'var(--ink-soft)', fontSize: 14 }}>
          Войдите, чтобы синхронизировать ваши плитки.
        </p>

        <Field label="Email" icon={<I.Mail size={15}/>}>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                 style={fieldInputStyle}/>
        </Field>

        <Field label="Пароль" icon={<I.Lock size={15}/>}
               trailing={
                 <button type="button" onClick={() => setShowPwd(s => !s)}
                         style={{ background: 'transparent', border: 'none', color: 'var(--ink-soft)', padding: 4, display: 'grid', placeItems: 'center' }}>
                   {showPwd ? <I.EyeOff size={15}/> : <I.Eye size={15}/>}
                 </button>
               }>
          <input type={showPwd ? 'text' : 'password'} value={pwd} onChange={e => setPwd(e.target.value)}
                 style={fieldInputStyle}/>
        </Field>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 18px', fontSize: 12 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--ink-soft)' }}>
            <input type="checkbox" defaultChecked style={{ accentColor: 'var(--accent-terra)' }}/>
            Запомнить
          </label>
          <a style={{ color: 'var(--accent-terra)', textDecoration: 'none', fontWeight: 500 }}>Забыли?</a>
        </div>

        <button type="submit" style={{
          width: '100%', padding: '13px 16px',
          background: 'var(--ink)',
          color: 'var(--surface)',
          border: 'var(--tile-border)',
          borderRadius: 'var(--radius-button)',
          fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 14,
          boxShadow: 'var(--shadow-sm)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          {stage === 'submitting' ? (
            <>
              <span style={{ display: 'inline-flex', animation: 'sync-spin 1.1s linear infinite' }}><I.Sync size={15} stroke={2.4}/></span>
              Подключаемся…
            </>
          ) : (
            <>
              Войти <I.Arrow size={15} stroke={2.2}/>
            </>
          )}
        </button>

        <div style={{
          margin: '18px 0 14px',
          display: 'flex', alignItems: 'center', gap: 10,
          color: 'var(--ink-faint)', fontSize: 11, fontFamily: 'var(--font-mono)',
        }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }}/>
          ИЛИ
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }}/>
        </div>

        <button type="button" style={{
          width: '100%', padding: '11px 16px',
          background: 'var(--surface-2)', color: 'var(--ink)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-button)',
          fontFamily: 'var(--font-head)', fontWeight: 500, fontSize: 13,
        }}>
          Создать новый аккаунт
        </button>
      </form>
    </div>
  );
}

const fieldInputStyle = {
  flex: 1, border: 'none', background: 'transparent', outline: 'none',
  fontSize: 14, color: 'var(--ink)', fontFamily: 'var(--font-head)',
  padding: 0,
};

function Field({ label, icon, trailing, children }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-soft)', marginBottom: 6, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </span>
      <span style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '11px 13px',
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-button)',
        color: 'var(--ink-soft)',
      }}>
        {icon}
        {children}
        {trailing}
      </span>
    </label>
  );
}

// Decorative tiles tilted in the background of the login screen
function DecorTiles() {
  const items = [
    { x: '-2%',  y: '8%',   r: -6, c: 'var(--accent-terra)',   w: 220, h: 140, txt: 'Подготовить отчёт' },
    { x: '78%',  y: '14%',  r: 5,  c: 'var(--accent-indigo)',  w: 200, h: 110, txt: 'Созвон 15:00' },
    { x: '4%',   y: '70%',  r: 7,  c: 'var(--accent-olive)',   w: 180, h: 100, txt: 'Полить растения' },
    { x: '74%',  y: '74%',  r: -8, c: 'var(--accent-mustard)', w: 220, h: 130, txt: 'Подарок маме' },
  ];
  return (
    <>
      {items.map((it, i) => (
        <div key={i} style={{
          position: 'absolute',
          left: it.x, top: it.y,
          width: it.w, height: it.h,
          background: it.c,
          color: '#fffaf0',
          borderRadius: 'var(--radius-tile)',
          border: 'var(--tile-border)',
          boxShadow: 'var(--shadow-md)',
          transform: `rotate(${it.r}deg)`,
          padding: 16,
          fontFamily: 'var(--font-head)',
          fontWeight: 600,
          fontSize: 16,
          opacity: 0.75,
          filter: 'blur(0.3px)',
          zIndex: 1,
        }}>
          {it.txt}
          <div style={{
            position: 'absolute', left: 12, right: 12, bottom: 10, height: 6,
            background: 'rgba(0,0,0,0.18)', borderRadius: 4, overflow: 'hidden',
          }}>
            <div style={{ width: `${30 + i * 18}%`, height: '100%', background: 'rgba(255,255,255,0.6)' }}/>
          </div>
        </div>
      ))}
    </>
  );
}

window.LoginScreen = LoginScreen;
