import { useEffect, useState } from 'react';
import { Api, ApiError, setToken, type Branding } from '../api.js';

type Mode = 'login' | 'register' | 'forgot' | 'reset';

export function AuthView({ onAuth, branding }: { onAuth: () => void; branding?: Branding | null }) {
  const [mode, setMode] = useState<Mode>('login');
  const [jurisdictions, setJurisdictions] = useState<Array<{ code: string; name: string }>>([]);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [dob, setDob] = useState('');
  const [jurisdiction, setJurisdiction] = useState('ES');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaNeeded, setMfaNeeded] = useState(false);
  const [resetToken, setResetToken] = useState('');

  useEffect(() => {
    Api.jurisdictions().then((r) => setJurisdictions(r.jurisdictions)).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    setBusy(true);
    try {
      if (mode === 'login') {
        const res = await Api.login({ email, password, ...(mfaCode ? { mfaCode } : {}) });
        setToken(res.token);
        onAuth();
      } else if (mode === 'register') {
        const res = await Api.register({ email, password, fullName, dateOfBirth: dob, jurisdiction, acceptTerms });
        setToken(res.token);
        onAuth();
      } else if (mode === 'forgot') {
        const res = await Api.forgotPassword(email);
        setInfo('Si el correo existe, recibirás instrucciones.');
        if (res.devToken) {
          setResetToken(res.devToken);
          setMode('reset');
          setInfo('(Demo) Token generado; introduce tu nueva contraseña.');
        }
      } else if (mode === 'reset') {
        await Api.resetPassword(resetToken, password);
        setInfo('Contraseña actualizada. Ya puedes entrar.');
        setMode('login');
        setPassword('');
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'mfa_required') {
        setMfaNeeded(true);
        setError('Introduce tu código de verificación (MFA).');
      } else {
        setError(err instanceof ApiError ? err.message : 'Error inesperado');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>
          {branding?.logoUrl ? <img src={branding.logoUrl} alt="" className="brand-logo" /> : '⚽'} {branding?.displayName ?? 'Bet Mundial 2026'}
        </h1>
        <p className="muted">{branding?.tagline || 'Apuestas deportivas — Copa Mundial 2026'}</p>

        {(mode === 'login' || mode === 'register') && (
          <div className="seg">
            <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Entrar</button>
            <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Crear cuenta</button>
          </div>
        )}

        <form onSubmit={submit}>
          {mode !== 'reset' && (
            <label>Correo electrónico
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </label>
          )}
          {mode !== 'forgot' && (
            <label>{mode === 'reset' ? 'Nueva contraseña' : 'Contraseña'}
              <input type="password" required minLength={mode === 'login' ? 1 : 8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            </label>
          )}

          {mode === 'login' && mfaNeeded && (
            <label>Código MFA
              <input type="text" inputMode="numeric" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} placeholder="000000" />
            </label>
          )}

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
          {info && <div className="slip-message">{info}</div>}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Procesando…' : mode === 'login' ? 'Entrar' : mode === 'register' ? 'Crear cuenta' : mode === 'forgot' ? 'Recuperar contraseña' : 'Guardar contraseña'}
          </button>
        </form>

        {mode === 'login' && (
          <p className="muted small">
            <button className="link" onClick={() => { setMode('forgot'); setError(''); setInfo(''); }}>¿Olvidaste tu contraseña?</button>
          </p>
        )}
        {(mode === 'forgot' || mode === 'reset') && (
          <p className="muted small"><button className="link" onClick={() => setMode('login')}>Volver a entrar</button></p>
        )}
        <p className="muted small">Demo admin: admin@betmundial2026.test / Admin1234!</p>
      </div>
    </div>
  );
}
