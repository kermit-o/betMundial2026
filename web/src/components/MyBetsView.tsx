import { useEffect, useState } from 'react';
import { Api, formatMoney, type Bet, type Match, type Profile } from '../api.js';

const STATUS_LABEL: Record<string, string> = {
  open: 'Abierta', won: 'Ganada', lost: 'Perdida', void: 'Anulada',
};

export function MyBetsView({ profile }: { profile: Profile }) {
  const [bets, setBets] = useState<Bet[]>([]);
  const [matches, setMatches] = useState<Record<string, Match>>({});

  useEffect(() => {
    Promise.all([Api.myBets(), Api.matches()]).then(([b, m]) => {
      setBets(b.bets);
      setMatches(Object.fromEntries(m.matches.map((x) => [x.id, x])));
    }).catch(() => {});
  }, []);

  return (
    <div className="panel">
      <h2>Mis apuestas</h2>
      <table className="tx-table">
        <thead><tr><th>Fecha</th><th>Partido</th><th>Cuota</th><th>Importe</th><th>Pago pot.</th><th>Estado</th></tr></thead>
        <tbody>
          {bets.map((b) => {
            const m = matches[b.match_id];
            return (
              <tr key={b.id}>
                <td>{new Date(b.placed_at.replace(' ', 'T') + 'Z').toLocaleString('es-ES')}</td>
                <td>{m ? `${m.homeTeamName} vs ${m.awayTeamName}` : b.match_id}</td>
                <td>{b.odds.toFixed(2)}</td>
                <td>{formatMoney(b.stake, profile.currency)}</td>
                <td>{formatMoney(b.potential_payout, profile.currency)}</td>
                <td><span className={`badge ${b.status}`}>{STATUS_LABEL[b.status] ?? b.status}</span></td>
              </tr>
            );
          })}
          {bets.length === 0 && <tr><td colSpan={6} className="muted">Aún no has realizado apuestas.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
