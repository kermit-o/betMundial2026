import { useEffect, useState } from 'react';
import { Api, ApiError, setToken } from '../api.js';

export function AuthView({ onAuth }: { onAuth: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [jurisdictions, setJurisdictions] = useState<Array<{ code: string; name: string }>>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [dob, setDob] = useState('');
  const [jurisdiction, setJurisdiction] = useState('ES');
  const [acceptTerms, setAcceptTerms] = useState(false);

  useEffect(() => {
    Api.jurisdictions().then((r) => setJurisdictions(r.jurisdictions)).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res =
        mode === 'login'
          ? await Api.login({ email, password })
          : await Api.register({ email, password, fullName, dateOfBirth: dob, jurisdiction, acceptTerms });
      setToken(res.token);
      onAuth();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>⚽ Bet Mundial 2026</h1>
        <p className="muted">Apuestas deportivas — Copa Mundial 2026</p>

        <div className="seg">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Entrar</button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Crear cuenta</button>
        </div>

        <form onSubmit={submit}>
          <label>Correo electrónico
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          <label>Contraseña
            <input type="password" required minLength={mode === 'register' ? 8 : 1} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </label>

          {mode === 'register' && (
            <>
              <label>Nombre completo
                <input type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </label>
              <label>Fecha de nacimiento
                <input type="date" required value={dob} onChange={(e) => setDob(e.target.value)} />
              </label>
              <label>Jurisdicción
                <select value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)}>
                  {jurisdictions.map((j) => (
                    <option key={j.code} value={j.code}>{j.name} ({j.code})</option>
                  ))}
                </select>
              </label>
              <label className="check">
                <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} />
                Confirmo que soy mayor de edad y acepto los términos y la política de juego responsable.
              </label>
            </>
          )}

          {error && <div className="form-error">{error}</div>}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Procesando…' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}
          </button>
        </form>

        <p className="muted small">Demo admin: admin@betmundial2026.test / Admin1234!</p>
      </div>
    </div>
  );
}
