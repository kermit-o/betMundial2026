import { useCallback, useEffect, useState } from 'react';
import { Api, ApiError, formatMoney, type Bet, type Match, type Profile } from '../api.js';

const STATUS_LABEL: Record<string, string> = {
  open: 'Abierta', won: 'Ganada', lost: 'Perdida', void: 'Anulada', cashed_out: 'Cobrada',
};

export function MyBetsView({ profile, onBalanceChange }: { profile: Profile; onBalanceChange: (b: number) => void }) {
  const [bets, setBets] = useState<Bet[]>([]);
  const [matches, setMatches] = useState<Record<string, Match>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const [b, m] = await Promise.all([Api.myBets(), Api.matches()]);
    setBets(b.bets);
    setMatches(Object.fromEntries(m.matches.map((x) => [x.id, x])));
  }, []);

  useEffect(() => { load().catch(() => {}); }, [load]);

  async function doCashOut(bet: Bet) {
    setBusy(bet.id);
    setMessage('');
    try {
      const res = await Api.cashOut(bet.id);
      onBalanceChange(res.balance);
      setMessage(`✅ Cash-out cobrado: ${formatMoney(res.value, profile.currency)}`);
      await load();
    } catch (err) {
      setMessage(`⛔ ${err instanceof ApiError ? err.message : 'Error'}`);
    } finally {
      setBusy(null);
    }
  }

  function legLabel(matchId: string): string {
    const m = matches[matchId];
    return m ? `${m.homeTeamName} vs ${m.awayTeamName}` : matchId;
  }

  return (
    <div className="panel">
      <h2>Mis apuestas</h2>
      {message && <div className="slip-message">{message}</div>}
      <div className="bets-list">
        {bets.map((b) => (
          <div className="bet-row" key={b.id}>
            <div className="bet-head">
              <span className={`badge ${b.status}`}>{STATUS_LABEL[b.status] ?? b.status}</span>
              <span className="bet-type">{b.type === 'combo' ? `Combinada ×${b.legs.length}` : 'Simple'}</span>
              <span className="bet-odds">@ {b.total_odds.toFixed(2)}</span>
              <span className="bet-date">{new Date(b.placed_at.replace(' ', 'T') + 'Z').toLocaleString('es-ES')}</span>
            </div>
            <ul className="legs">
              {b.legs.map((l) => (
                <li key={l.id} className={`leg ${l.result}`}>
                  <span>{legLabel(l.match_id)}</span>
                  <span className="leg-odds">{l.odds.toFixed(2)} · {l.result}</span>
                </li>
              ))}
            </ul>
            <div className="bet-foot">
              <span>Importe: <strong>{formatMoney(b.stake, profile.currency)}</strong></span>
              {b.status === 'cashed_out' && b.cash_out_value != null ? (
                <span>Cobrado: <strong>{formatMoney(b.cash_out_value, profile.currency)}</strong></span>
              ) : (
                <span>Pago pot.: <strong>{formatMoney(b.potential_payout, profile.currency)}</strong></span>
              )}
              {b.status === 'open' && b.cashOutValue != null && (
                <button className="cashout-btn" disabled={busy === b.id} onClick={() => doCashOut(b)}>
                  {busy === b.id ? '…' : `Cash-out ${formatMoney(b.cashOutValue, profile.currency)}`}
                </button>
              )}
            </div>
          </div>
        ))}
        {bets.length === 0 && <p className="muted">Aún no has realizado apuestas.</p>}
      </div>
    </div>
  );
}
