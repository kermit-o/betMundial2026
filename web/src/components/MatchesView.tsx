import { useEffect, useMemo, useState } from 'react';
import { Api, ApiError, formatMoney, type Match, type Profile, type Selection } from '../api.js';
import { useLiveOdds } from '../useLiveOdds.js';

interface SlipItem { selection: Selection; matchLabel: string; marketName: string; liveOdds: number }

export function MatchesView({ profile, onBalanceChange }: { profile: Profile; onBalanceChange: (b: number) => void }) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [error, setError] = useState('');
  const [slip, setSlip] = useState<SlipItem | null>(null);
  const [stakeMajor, setStakeMajor] = useState('5');
  const [placing, setPlacing] = useState(false);
  const [message, setMessage] = useState('');
  const { odds: liveOdds, connected } = useLiveOdds();

  useEffect(() => {
    Api.matches().then((r) => setMatches(r.matches)).catch((e) => setError(e.message));
  }, []);

  function oddsFor(sel: Selection): number {
    return liveOdds.get(sel.id) ?? sel.odds;
  }

  function addToSlip(match: Match, marketName: string, sel: Selection) {
    setMessage('');
    setSlip({
      selection: sel,
      matchLabel: `${match.homeTeamName} vs ${match.awayTeamName}`,
      marketName,
      liveOdds: oddsFor(sel),
    });
  }

  // Mantener la cuota del boleto sincronizada con la cuota en vivo.
  const slipLiveOdds = slip ? liveOdds.get(slip.selection.id) ?? slip.liveOdds : 0;
  const oddsMoved = slip ? Math.abs(slipLiveOdds - slip.liveOdds) > 1e-9 : false;

  const stakeMinor = useMemo(() => Math.round((parseFloat(stakeMajor) || 0) * 100), [stakeMajor]);
  const potential = slip ? Math.floor(stakeMinor * slipLiveOdds) : 0;

  async function place() {
    if (!slip || stakeMinor <= 0) return;
    setPlacing(true);
    setMessage('');
    try {
      const res = await Api.placeBet(slip.selection.id, stakeMinor, slipLiveOdds);
      onBalanceChange(res.balance);
      setMessage('✅ Apuesta aceptada.');
      setSlip(null);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'odds_changed') {
        // Refrescar boleto con la nueva cuota.
        setSlip((s) => (s ? { ...s, liveOdds: slipLiveOdds } : s));
        setMessage('La cuota cambió; revisa y confirma de nuevo.');
      } else {
        setMessage(`⛔ ${err instanceof ApiError ? err.message : 'Error'}`);
      }
    } finally {
      setPlacing(false);
    }
  }

  return (
    <div className="matches-layout">
      <section className="matches">
        <div className="section-head">
          <h2>Partidos</h2>
          <span className={`live-dot ${connected ? 'on' : 'off'}`}>{connected ? 'Cuotas en vivo' : 'Reconectando…'}</span>
        </div>
        {error && <div className="form-error">{error}</div>}
        {matches.map((m) => (
          <article className="match-card" key={m.id}>
            <header>
              <div className="teams">{m.homeTeamName} <span className="vs">vs</span> {m.awayTeamName}</div>
              <div className="kickoff">{new Date(m.kickoff).toLocaleString('es-ES')} · {m.venue}</div>
            </header>
            {m.markets.map((mk) => (
              <div className="market" key={mk.id}>
                <div className="market-name">{mk.name}</div>
                <div className="selections">
                  {mk.selections.map((sel) => {
                    const o = oddsFor(sel);
                    const selected = slip?.selection.id === sel.id;
                    return (
                      <button
                        key={sel.id}
                        className={`odd ${selected ? 'selected' : ''}`}
                        disabled={mk.status !== 'open' || m.status === 'finished'}
                        onClick={() => addToSlip(m, mk.name, sel)}
                      >
                        <span className="odd-name">{sel.name}</span>
                        <span className="odd-value">{o.toFixed(2)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </article>
        ))}
      </section>

      <aside className="betslip">
        <h3>Boleto</h3>
        {!slip && <p className="muted">Selecciona una cuota para añadirla al boleto.</p>}
        {slip && (
          <div className="slip-item">
            <div className="slip-match">{slip.matchLabel}</div>
            <div className="slip-market">{slip.marketName}</div>
            <div className="slip-sel">
              <strong>{slip.selection.name}</strong>
              <span className={`slip-odds ${oddsMoved ? 'moved' : ''}`}>{slipLiveOdds.toFixed(2)}</span>
            </div>
            {oddsMoved && <div className="slip-warn">La cuota se ha movido a {slipLiveOdds.toFixed(2)}.</div>}

            <label className="stake-label">Importe ({profile.currency})
              <input type="number" min="0.01" step="0.01" value={stakeMajor} onChange={(e) => setStakeMajor(e.target.value)} />
            </label>
            <div className="slip-payout">
              <span>Ganancia potencial</span>
              <strong>{formatMoney(potential, profile.currency)}</strong>
            </div>
            <button className="primary" disabled={placing || stakeMinor <= 0} onClick={place}>
              {placing ? 'Enviando…' : 'Apostar'}
            </button>
            <button className="ghost" onClick={() => setSlip(null)}>Quitar</button>
          </div>
        )}
        {message && <div className="slip-message">{message}</div>}
      </aside>
    </div>
  );
}
