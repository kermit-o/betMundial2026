import { useCallback, useEffect, useState } from 'react';
import {
  PlatformApi,
  PlatformApiError,
  getPlatformToken,
  setPlatformToken,
  clearPlatformToken,
  parseBranding,
  type Branding,
  type Operator,
} from './api.js';

export function PlatformApp() {
  const [authed, setAuthed] = useState(!!getPlatformToken());
  if (!authed) return <PlatformLogin onAuth={() => setAuthed(true)} />;
  return (
    <PlatformDashboard
      onLogout={() => {
        clearPlatformToken();
        setAuthed(false);
      }}
    />
  );
}

function PlatformLogin({ onAuth }: { onAuth: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await PlatformApi.login(email, password);
      setPlatformToken(res.token);
      onAuth();
    } catch (err) {
      setError(err instanceof PlatformApiError ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>🛠️ Panel de plataforma</h1>
        <p className="muted">Administración de operadores (super-admin)</p>
        <form onSubmit={submit}>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Contraseña
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}

function PlatformDashboard({ onLogout }: { onLogout: () => void }) {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [msg, setMsg] = useState('');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Operator | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await PlatformApi.listOperators();
      setOperators(r.operators);
    } catch (err) {
      if (err instanceof PlatformApiError && err.code === 'invalid_token') {
        clearPlatformToken();
        onLogout();
        return;
      }
      setMsg(`⛔ ${err instanceof PlatformApiError ? err.message : 'Error'}`);
    }
  }, [onLogout]);

  useEffect(() => {
    load();
  }, [load]);

  // Sugerir un slug a partir del nombre (minúsculas, guiones).
  function onNameChange(v: string) {
    setName(v);
    setSlug(
      v
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32),
    );
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    setBusy(true);
    try {
      const r = await PlatformApi.createOperator(name, slug);
      setMsg(`✅ Operador creado: ${r.operator.name} (${r.operator.slug}).`);
      setName('');
      setSlug('');
      await load();
    } catch (err) {
      setMsg(`⛔ ${err instanceof PlatformApiError ? err.message : 'Error'}`);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(op: Operator) {
    const next = op.status === 'active' ? 'suspended' : 'active';
    try {
      await PlatformApi.setStatus(op.id, next);
      setMsg(`✅ ${op.name}: ${next === 'active' ? 'activado' : 'suspendido'}.`);
      await load();
    } catch (err) {
      setMsg(`⛔ ${err instanceof PlatformApiError ? err.message : 'Error'}`);
    }
  }

  const active = operators.filter((o) => o.status === 'active').length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">🛠️ Plataforma</div>
        <div className="user-area">
          <span className="email">super-admin</span>
          <button className="ghost" onClick={onLogout}>Salir</button>
        </div>
      </header>

      <main className="content">
        <div className="panel admin">
          <h2>Operadores</h2>
          <div className="stats-grid">
            <div className="stat"><span>Total</span><strong>{operators.length}</strong></div>
            <div className="stat"><span>Activos</span><strong>{active}</strong></div>
            <div className="stat"><span>Suspendidos</span><strong>{operators.length - active}</strong></div>
          </div>

          <form className="row" onSubmit={create} style={{ marginTop: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label>Nombre<input value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="Casino Estrella" required /></label>
            <label>Slug (subdominio)<input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="casino-estrella" required /></label>
            <button className="primary" type="submit" disabled={busy}>{busy ? 'Creando…' : 'Crear operador'}</button>
          </form>

          {msg && <div className="slip-message">{msg}</div>}

          <table className="tx-table" style={{ marginTop: 16 }}>
            <thead><tr><th>Nombre</th><th>Slug</th><th>Estado</th><th>Creado</th><th>Acción</th></tr></thead>
            <tbody>
              {operators.map((o) => (
                <tr key={o.id}>
                  <td>{o.name}</td>
                  <td className="mono">{o.slug}</td>
                  <td><span className={`badge ${o.status === 'active' ? 'won' : 'lost'}`}>{o.status}</span></td>
                  <td className="mono">{o.created_at.slice(0, 10)}</td>
                  <td>
                    <button className="link" onClick={() => setEditing(o)}>Marca</button>
                    {o.id !== 'op_default' && (
                      <>
                        {' · '}
                        <button className="link" onClick={() => toggle(o)}>
                          {o.status === 'active' ? 'Suspender' : 'Activar'}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {operators.length === 0 && <tr><td colSpan={5} className="muted">Sin operadores.</td></tr>}
            </tbody>
          </table>

          {editing && (
            <BrandingEditor
              operator={editing}
              onClose={() => setEditing(null)}
              onSaved={async () => {
                setEditing(null);
                setMsg('✅ Marca guardada.');
                await load();
              }}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function BrandingEditor({ operator, onClose, onSaved }: { operator: Operator; onClose: () => void; onSaved: () => void }) {
  const [b, setB] = useState<Branding>(() => {
    const parsed = parseBranding(operator.branding);
    return { ...parsed, displayName: parsed.displayName || operator.name };
  });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      await PlatformApi.updateBranding(operator.id, b);
      onSaved();
    } catch (err) {
      setMsg(`⛔ ${err instanceof PlatformApiError ? err.message : 'Error'}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ marginTop: 16, background: 'var(--bg-2)' }}>
      <h3>Marca de {operator.name}</h3>
      <form onSubmit={save}>
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label>Nombre visible<input value={b.displayName} maxLength={40} onChange={(e) => setB({ ...b, displayName: e.target.value })} required /></label>
          <label>Color principal<input type="color" value={b.primaryColor} onChange={(e) => setB({ ...b, primaryColor: e.target.value })} /></label>
          <label>Lema<input value={b.tagline} maxLength={80} onChange={(e) => setB({ ...b, tagline: e.target.value })} placeholder="Tu casa de apuestas" /></label>
          <label style={{ flex: 1, minWidth: 220 }}>Logo (URL)<input value={b.logoUrl ?? ''} onChange={(e) => setB({ ...b, logoUrl: e.target.value || null })} placeholder="https://…/logo.png" /></label>
        </div>

        {/* Vista previa de la cabecera del operador */}
        <div className="brand-preview" style={{ borderColor: b.primaryColor }}>
          <span className="brand">
            {b.logoUrl ? <img src={b.logoUrl} alt="" className="brand-logo" /> : '⚽'} {b.displayName || operator.name}
          </span>
          <button type="button" className="primary" style={{ background: b.primaryColor, borderColor: b.primaryColor }}>Apostar</button>
        </div>

        {msg && <div className="slip-message">{msg}</div>}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar marca'}</button>
          <button type="button" className="ghost" onClick={onClose}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}
