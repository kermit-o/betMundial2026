import { useEffect, useMemo, useState } from 'react';
import { Api, ApiError, formatMoney, type Match, type Profile, type Selection } from '../api.js';
import { useLiveOdds } from '../useLiveOdds.js';

interface SlipItem { selection: Selection; matchId: string; matchLabel: string; marketName: string; lockedOdds: number }

export function MatchesView({ profile, onBalanceChange }: { profile: Profile; onBalanceChange: (b: number) => void }) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [error, setError] = useState('');
  const [slip, setSlip] = useState<SlipItem[]>([]);
  const [stakeMajor, setStakeMajor] = useState('5');
  const [placing, setPlacing] = useState(false);
  const [message, setMessage] = useState('');
  const { odds: liveOdds, connected } = useLiveOdds();

  useEffect(() => {
    Api.matches().then((r) => setMatches(r.matches)).catch((e) => setError(e.message));
  }, []);

  const oddsFor = (sel: Selection): number => liveOdds.get(sel.id) ?? sel.odds;

  function toggleSelection(match: Match, marketName: string, sel: Selection) {
    setMessage('');
    setSlip((prev) => {
      const existingIdx = prev.findIndex((s) => s.selection.id === sel.id);
      if (existingIdx >= 0) return prev.filter((_, i) => i !== existingIdx); // quitar
      // Una combinada no admite dos selecciones del mismo partido: reemplazar.
      const withoutMatch = prev.filter((s) => s.matchId !== match.id);
      return [
        ...withoutMatch,
        { selection: sel, matchId: match.id, matchLabel: `${match.homeTeamName} vs ${match.awayTeamName}`, marketName, lockedOdds: oddsFor(sel) },
      ];
    });
  }

  const isCombo = slip.length > 1;
  // Cuota total en vivo (producto de cuotas actuales).
  const liveTotalOdds = useMemo(
    () => slip.reduce((acc, s) => acc * (liveOdds.get(s.selection.id) ?? s.lockedOdds), 1),
    [slip, liveOdds],
  );
  const stakeMinor = useMemo(() => Math.round((parseFloat(stakeMajor) || 0) * 100), [stakeMajor]);
  const potential = Math.floor(stakeMinor * liveTotalOdds);

  async function place() {
    if (slip.length === 0 || stakeMinor <= 0) return;
    setPlacing(true);
    setMessage('');
    try {
      const legs = slip.map((s) => ({ selectionId: s.selection.id, expectedOdds: liveOdds.get(s.selection.id) ?? s.lockedOdds }));
      const res = await Api.placeBet(legs, stakeMinor);
      onBalanceChange(res.balance);
      setMessage('✅ Apuesta aceptada.');
      setSlip([]);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'odds_changed') {
        // Refrescar las cuotas bloqueadas del boleto con las actuales.
        setSlip((prev) => prev.map((s) => ({ ...s, lockedOdds: liveOdds.get(s.selection.id) ?? s.lockedOdds })));
        setMessage('Las cuotas cambiaron; revisa el boleto y confirma de nuevo.');
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
                <div className="market-name">{mk.name}{mk.status !== 'open' && <span className="suspended"> · suspendido</span>}</div>
                <div className="selections">
                  {mk.selections.map((sel) => {
                    const o = oddsFor(sel);
                    const selected = slip.some((s) => s.selection.id === sel.id);
                    return (
                      <button
                        key={sel.id}
                        className={`odd ${selected ? 'selected' : ''}`}
                        disabled={mk.status !== 'open' || m.status === 'finished'}
                        onClick={() => toggleSelection(m, mk.name, sel)}
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
        <h3>Boleto {isCombo && <span className="combo-tag">Combinada ×{slip.length}</span>}</h3>
        {slip.length === 0 && <p className="muted">Selecciona una o varias cuotas. Varias selecciones de partidos distintos forman una combinada.</p>}

        {slip.map((s) => {
          const live = liveOdds.get(s.selection.id) ?? s.lockedOdds;
          const moved = Math.abs(live - s.lockedOdds) > 1e-9;
          return (
            <div className="slip-item" key={s.selection.id}>
              <div className="slip-match">{s.matchLabel}</div>
              <div className="slip-market">{s.marketName}</div>
              <div className="slip-sel">
                <strong>{s.selection.name}</strong>
                <span className={`slip-odds ${moved ? 'moved' : ''}`}>{live.toFixed(2)}</span>
              </div>
              <button className="link remove" onClick={() => setSlip((prev) => prev.filter((x) => x.selection.id !== s.selection.id))}>Quitar</button>
            </div>
          );
        })}

        {slip.length > 0 && (
          <div className="slip-footer">
            {isCombo && (
              <div className="slip-payout"><span>Cuota combinada</span><strong>{liveTotalOdds.toFixed(2)}</strong></div>
            )}
            <label className="stake-label">Importe ({profile.currency})
              <input type="number" min="0.01" step="0.01" value={stakeMajor} onChange={(e) => setStakeMajor(e.target.value)} />
            </label>
            <div className="slip-payout"><span>Ganancia potencial</span><strong>{formatMoney(potential, profile.currency)}</strong></div>
            <button className="primary" disabled={placing || stakeMinor <= 0} onClick={place}>{placing ? 'Enviando…' : 'Apostar'}</button>
            <button className="ghost" onClick={() => setSlip([])}>Vaciar boleto</button>
          </div>
        )}
        {message && <div className="slip-message">{message}</div>}
      </aside>
    </div>
  );
}
