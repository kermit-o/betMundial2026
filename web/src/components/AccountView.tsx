import { useState } from 'react';
import { Api, ApiError, formatMoney, type Profile } from '../api.js';

export function AccountView({ profile, onUpdated }: { profile: Profile; onUpdated: () => void }) {
  const [docType, setDocType] = useState('national_id');
  const [docNumber, setDocNumber] = useState('');
  const [docName, setDocName] = useState(profile.full_name);
  const [depositLimit, setDepositLimit] = useState(String(profile.daily_deposit_limit / 100));
  const [lossLimit, setLossLimit] = useState(profile.daily_loss_limit != null ? String(profile.daily_loss_limit / 100) : '');
  const [excludeDays, setExcludeDays] = useState('30');
  const [msg, setMsg] = useState('');

  // MFA
  const [mfaSecret, setMfaSecret] = useState('');
  const [mfaUrl, setMfaUrl] = useState('');
  const [mfaCode, setMfaCode] = useState('');

  function handle(fn: () => Promise<unknown>, ok: (r: unknown) => string) {
    return async () => {
      setMsg('');
      try { const r = await fn(); onUpdated(); setMsg(ok(r)); }
      catch (e) { setMsg(`⛔ ${e instanceof ApiError ? e.message : 'Error'}`); }
    };
  }

  const limitMsg = (r: unknown) => {
    const res = r as { applied: boolean; effectiveAt?: string };
    return res.applied ? '✅ Límite actualizado.' : `⏳ Por seguridad, la subida se aplicará el ${new Date(res.effectiveAt!).toLocaleString('es-ES')}.`;
  };

  async function startMfa() {
    setMsg('');
    try { const r = await Api.mfaSetup(); setMfaSecret(r.secret); setMfaUrl(r.otpauthUrl); }
    catch (e) { setMsg(`⛔ ${e instanceof ApiError ? e.message : 'Error'}`); }
  }

  // Demo: solicita el token de verificación y lo consume de inmediato.
  async function verifyEmailFlow() {
    setMsg('');
    try {
      const { devToken } = await Api.requestEmailVerify();
      await Api.verifyEmail(devToken);
      onUpdated();
      setMsg('✅ Email verificado.');
    } catch (e) { setMsg(`⛔ ${e instanceof ApiError ? e.message : 'Error'}`); }
  }

  return (
    <div className="panel account">
      <h2>Cuenta y juego responsable</h2>

      <section className="card">
        <h3>Verificación de identidad (KYC)</h3>
        <p className="muted">Estado: <strong className={`kyc ${profile.kyc_status}`}>{profile.kyc_status}</strong>
          {' · '}Email: <strong>{profile.email_verified ? 'verificado' : 'sin verificar'}</strong></p>
        {!profile.email_verified && (
          <button className="ghost" onClick={verifyEmailFlow}>Verificar email (demo)</button>
        )}
        {profile.kyc_status !== 'verified' && (
          <div className="form-grid">
            <label>Tipo de documento
              <select value={docType} onChange={(e) => setDocType(e.target.value)}>
                <option value="national_id">DNI / Documento nacional</option>
                <option value="passport">Pasaporte</option>
                <option value="driver_license">Permiso de conducir</option>
              </select>
            </label>
            <label>Número de documento<input value={docNumber} onChange={(e) => setDocNumber(e.target.value)} /></label>
            <label>Nombre en el documento<input value={docName} onChange={(e) => setDocName(e.target.value)} /></label>
            <button className="primary" onClick={handle(() => Api.submitKyc({ documentType: docType, documentNumber: docNumber, fullNameOnDocument: docName }), () => '✅ KYC procesado.')}>Verificar</button>
          </div>
        )}
      </section>

      <section className="card">
        <h3>Autenticación en dos pasos (MFA)</h3>
        {profile.mfa_enabled ? (
          <div className="form-grid">
            <p className="muted">MFA activo. Para desactivarlo, introduce un código.</p>
            <label>Código<input value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} placeholder="000000" /></label>
            <button className="ghost" onClick={handle(() => Api.mfaDisable(mfaCode), () => '✅ MFA desactivado.')}>Desactivar MFA</button>
          </div>
        ) : !mfaSecret ? (
          <button className="ghost" onClick={startMfa}>Activar MFA (TOTP)</button>
        ) : (
          <div className="form-grid">
            <p className="muted">Añade este secreto a tu app de autenticación y confirma con un código:</p>
            <code className="mfa-secret">{mfaSecret}</code>
            <a className="muted small" href={mfaUrl}>Abrir en app autenticadora</a>
            <label>Código generado<input value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} placeholder="000000" /></label>
            <button className="primary" onClick={handle(() => Api.mfaEnable(mfaCode), () => '✅ MFA activado.')}>Confirmar y activar</button>
          </div>
        )}
      </section>

      <section className="card">
        <h3>Límites responsables</h3>
        <p className="muted">Reducir un límite es inmediato; subirlo se aplica tras 24h (enfriamiento).</p>
        <div className="form-grid">
          <label>Límite de depósito diario ({profile.currency})<input type="number" min="0" step="1" value={depositLimit} onChange={(e) => setDepositLimit(e.target.value)} /></label>
          <button className="ghost" onClick={handle(() => Api.setDepositLimit(Math.round((parseFloat(depositLimit) || 0) * 100)), limitMsg)}>Guardar depósito</button>
          <label>Límite de pérdida diaria ({profile.currency}) — vacío = sin límite<input type="number" min="0" step="1" value={lossLimit} onChange={(e) => setLossLimit(e.target.value)} /></label>
          <button className="ghost" onClick={handle(() => Api.setLossLimit(lossLimit === '' ? null : Math.round(parseFloat(lossLimit) * 100)), limitMsg)}>Guardar pérdida</button>
        </div>
        <p className="muted small">Actual: depósito {formatMoney(profile.daily_deposit_limit, profile.currency)} · pérdida {profile.daily_loss_limit != null ? formatMoney(profile.daily_loss_limit, profile.currency) : 'sin límite'}
          {profile.pending_deposit_limit != null && profile.pending_deposit_effective && ` · subida pendiente a ${formatMoney(profile.pending_deposit_limit, profile.currency)} el ${new Date(profile.pending_deposit_effective).toLocaleDateString('es-ES')}`}</p>
      </section>

      <section className="card danger-zone">
        <h3>Autoexclusión</h3>
        <p className="muted">Durante el periodo elegido no podrás apostar.</p>
        <div className="form-grid">
          <label>Días<input type="number" min="1" max="3650" value={excludeDays} onChange={(e) => setExcludeDays(e.target.value)} /></label>
          <button className="danger" onClick={handle(() => Api.selfExclude(parseInt(excludeDays, 10)), () => '✅ Autoexclusión activada.')}>Activar autoexclusión</button>
        </div>
      </section>

      {msg && <div className="slip-message">{msg}</div>}
    </div>
  );
}
