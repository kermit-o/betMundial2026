import { useEffect, useState } from 'react';
import { Api, ApiError, formatMoney, type Match } from '../api.js';

type Sub = 'matches' | 'fraud' | 'audit' | 'users';

export function AdminView() {
  const [sub, setSub] = useState<Sub>('matches');
  const [stats, setStats] = useState<{ users: number; openBets: number; fraudFlags: number; openLiability: number } | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => { Api.adminStats().then(setStats).catch(() => {}); }, [sub]);

  return (
    <div className="panel admin">
      <h2>Panel de administración</h2>
      {stats && (
        <div className="stats-grid">
          <div className="stat"><span>Usuarios</span><strong>{stats.users}</strong></div>
          <div className="stat"><span>Apuestas abiertas</span><strong>{stats.openBets}</strong></div>
          <div className="stat"><span>Banderas de fraude</span><strong>{stats.fraudFlags}</strong></div>
          <div className="stat"><span>Exposición abierta</span><strong>{formatMoney(stats.openLiability)}</strong></div>
        </div>
      )}

      <div className="seg admin-tabs">
        <button className={sub === 'matches' ? 'active' : ''} onClick={() => setSub('matches')}>Partidos</button>
        <button className={sub === 'fraud' ? 'active' : ''} onClick={() => setSub('fraud')}>Fraude</button>
        <button className={sub === 'audit' ? 'active' : ''} onClick={() => setSub('audit')}>Auditoría</button>
        <button className={sub === 'users' ? 'active' : ''} onClick={() => setSub('users')}>Usuarios</button>
      </div>

      {msg && <div className="slip-message">{msg}</div>}
      {sub === 'matches' && <AdminMatches onMsg={setMsg} />}
      {sub === 'fraud' && <AdminTable load={() => Api.adminFraud().then((r) => r.flags)} columns={['created_at', 'user_email', 'type', 'severity', 'detail']} />}
      {sub === 'audit' && <AdminTable load={() => Api.adminAudit().then((r) => r.entries)} columns={['created_at', 'user_email', 'action', 'detail', 'ip']} />}
      {sub === 'users' && <AdminUsers onMsg={setMsg} />}
    </div>
  );
}

function AdminMatches({ onMsg }: { onMsg: (s: string) => void }) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [scores, setScores] = useState<Record<string, { h: string; a: string }>>({});

  async function load() { const r = await Api.matches(); setMatches(r.matches); }
  useEffect(() => { load().catch(() => {}); }, []);

  async function settle(m: Match) {
    const s = scores[m.id] ?? { h: '0', a: '0' };
    try {
      const r = await Api.adminSettle(m.id, parseInt(s.h, 10) || 0, parseInt(s.a, 10) || 0);
      onMsg(`✅ Liquidado: ${r.settledBets} apuestas, pagado ${formatMoney(r.totalPaidOut)}.`);
      await load();
    } catch (e) { onMsg(`⛔ ${e instanceof ApiError ? e.message : 'Error'}`); }
  }

  async function toggleMarket(marketId: string, current: string) {
    try {
      await Api.adminMarketStatus(marketId, current === 'open' ? 'suspended' : 'open');
      onMsg('✅ Estado del mercado actualizado.');
      await load();
    } catch (e) { onMsg(`⛔ ${e instanceof ApiError ? e.message : 'Error'}`); }
  }

  return (
    <div className="admin-matches">
      {matches.map((m) => (
        <div className="admin-match" key={m.id}>
          <div className="admin-match-head">
            <strong>{m.homeTeamName} vs {m.awayTeamName}</strong>
            <span className={`badge ${m.status}`}>{m.status}</span>
          </div>
          {m.status !== 'finished' && (
            <div className="settle-row">
              <input type="number" min="0" placeholder="L" style={{ width: 56 }} value={scores[m.id]?.h ?? ''} onChange={(e) => setScores((s) => ({ ...s, [m.id]: { h: e.target.value, a: s[m.id]?.a ?? '' } }))} />
              <input type="number" min="0" placeholder="V" style={{ width: 56 }} value={scores[m.id]?.a ?? ''} onChange={(e) => setScores((s) => ({ ...s, [m.id]: { h: s[m.id]?.h ?? '', a: e.target.value } }))} />
              <button className="primary" onClick={() => settle(m)}>Liquidar</button>
            </div>
          )}
          <div className="admin-markets">
            {m.markets.map((mk) => (
              <button key={mk.id} className="link" disabled={mk.status === 'settled'} onClick={() => toggleMarket(mk.id, mk.status)}>
                {mk.name}: {mk.status} {mk.status !== 'settled' && '(cambiar)'}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AdminUsers({ onMsg }: { onMsg: (s: string) => void }) {
  const [users, setUsers] = useState<Array<Record<string, unknown>>>([]);
  async function load() { const r = await Api.adminUsers(); setUsers(r.users); }
  useEffect(() => { load().catch(() => {}); }, []);

  async function force(id: string, status: string) {
    try { await Api.adminForceKyc(id, status); onMsg('✅ KYC actualizado.'); await load(); }
    catch (e) { onMsg(`⛔ ${e instanceof ApiError ? e.message : 'Error'}`); }
  }

  return (
    <table className="tx-table">
      <thead><tr><th>Email</th><th>Jurisd.</th><th>Rol</th><th>KYC</th><th>Saldo</th><th>Acción</th></tr></thead>
      <tbody>
        {users.map((u) => (
          <tr key={String(u.id)}>
            <td>{String(u.email)}</td>
            <td>{String(u.jurisdiction)}</td>
            <td>{String(u.role)}</td>
            <td><span className={`kyc ${String(u.kyc_status)}`}>{String(u.kyc_status)}</span></td>
            <td>{formatMoney(Number(u.balance ?? 0), String(u.currency ?? 'EUR'))}</td>
            <td>
              {u.kyc_status !== 'verified'
                ? <button className="link" onClick={() => force(String(u.id), 'verified')}>Verificar</button>
                : <button className="link" onClick={() => force(String(u.id), 'rejected')}>Rechazar</button>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AdminTable({ load, columns }: { load: () => Promise<Array<Record<string, unknown>>>; columns: string[] }) {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  useEffect(() => { load().then(setRows).catch(() => {}); }, []);
  return (
    <table className="tx-table">
      <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>{columns.map((c) => <td key={c} className="mono">{row[c] == null ? '—' : String(row[c])}</td>)}</tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={columns.length} className="muted">Sin registros.</td></tr>}
      </tbody>
    </table>
  );
}
