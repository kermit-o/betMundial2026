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

  function notify(text: string) { setMsg(text); }
  function handle(fn: () => Promise<unknown>, ok: string) {
    return async () => {
      setMsg('');
      try { await fn(); onUpdated(); notify(ok); }
      catch (e) { notify(`⛔ ${e instanceof ApiError ? e.message : 'Error'}`); }
    };
  }

  return (
    <div className="panel account">
      <h2>Cuenta y juego responsable</h2>

      <section className="card">
        <h3>Verificación de identidad (KYC)</h3>
        <p className="muted">Estado actual: <strong className={`kyc ${profile.kyc_status}`}>{profile.kyc_status}</strong></p>
        {profile.kyc_status !== 'verified' && (
          <div className="form-grid">
            <label>Tipo de documento
              <select value={docType} onChange={(e) => setDocType(e.target.value)}>
                <option value="national_id">DNI / Documento nacional</option>
                <option value="passport">Pasaporte</option>
                <option value="driver_license">Permiso de conducir</option>
              </select>
            </label>
            <label>Número de documento
              <input value={docNumber} onChange={(e) => setDocNumber(e.target.value)} />
            </label>
            <label>Nombre en el documento
              <input value={docName} onChange={(e) => setDocName(e.target.value)} />
            </label>
            <button className="primary" onClick={handle(() => Api.submitKyc({ documentType: docType, documentNumber: docNumber, fullNameOnDocument: docName }), '✅ KYC enviado.')}>
              Verificar
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <h3>Límites responsables</h3>
        <p className="muted">Establece límites para controlar tu juego. Reducirlos es inmediato.</p>
        <div className="form-grid">
          <label>Límite de depósito diario ({profile.currency})
            <input type="number" min="0" step="1" value={depositLimit} onChange={(e) => setDepositLimit(e.target.value)} />
          </label>
          <button className="ghost" onClick={handle(() => Api.setDepositLimit(Math.round((parseFloat(depositLimit) || 0) * 100)), '✅ Límite de depósito actualizado.')}>
            Guardar límite de depósito
          </button>
          <label>Límite de pérdida diaria ({profile.currency}) — vacío = sin límite
            <input type="number" min="0" step="1" value={lossLimit} onChange={(e) => setLossLimit(e.target.value)} />
          </label>
          <button className="ghost" onClick={handle(() => Api.setLossLimit(lossLimit === '' ? null : Math.round(parseFloat(lossLimit) * 100)), '✅ Límite de pérdida actualizado.')}>
            Guardar límite de pérdida
          </button>
        </div>
        <p className="muted small">Actual: depósito {formatMoney(profile.daily_deposit_limit, profile.currency)} · pérdida {profile.daily_loss_limit != null ? formatMoney(profile.daily_loss_limit, profile.currency) : 'sin límite'}</p>
      </section>

      <section className="card danger-zone">
        <h3>Autoexclusión</h3>
        <p className="muted">Si necesitas un descanso, puedes autoexcluirte. Durante ese periodo no podrás apostar.</p>
        <div className="form-grid">
          <label>Días de autoexclusión
            <input type="number" min="1" max="3650" value={excludeDays} onChange={(e) => setExcludeDays(e.target.value)} />
          </label>
          <button className="danger" onClick={handle(() => Api.selfExclude(parseInt(excludeDays, 10)), '✅ Autoexclusión activada.')}>
            Activar autoexclusión
          </button>
        </div>
      </section>

      {msg && <div className="slip-message">{msg}</div>}
    </div>
  );
}
