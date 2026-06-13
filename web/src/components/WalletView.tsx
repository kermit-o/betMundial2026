import { useEffect, useState } from 'react';
import { Api, ApiError, formatMoney, type Profile, type Transaction } from '../api.js';

const TX_LABEL: Record<string, string> = {
  deposit: 'Depósito',
  withdrawal: 'Retiro',
  bet_stake: 'Apuesta',
  bet_payout: 'Premio',
  refund: 'Reembolso',
};

export function WalletView({ profile, balance, onBalanceChange }: { profile: Profile; balance: number; onBalanceChange: (b: number) => void }) {
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [amount, setAmount] = useState('20');
  const [message, setMessage] = useState('');

  async function load() {
    const w = await Api.wallet();
    setTxs(w.transactions);
    onBalanceChange(w.balance);
  }
  useEffect(() => { load().catch(() => {}); }, []);

  async function act(kind: 'deposit' | 'withdraw') {
    setMessage('');
    const minor = Math.round((parseFloat(amount) || 0) * 100);
    if (minor <= 0) return setMessage('Importe inválido.');
    try {
      const res = kind === 'deposit' ? await Api.deposit(minor) : await Api.withdraw(minor);
      onBalanceChange(res.balance);
      await load();
      setMessage(kind === 'deposit' ? '✅ Depósito realizado.' : '✅ Retiro solicitado.');
    } catch (err) {
      setMessage(`⛔ ${err instanceof ApiError ? err.message : 'Error'}`);
    }
  }

  return (
    <div className="panel">
      <h2>Cartera</h2>
      <div className="balance-big">{formatMoney(balance, profile.currency)}</div>

      <div className="row">
        <label>Importe ({profile.currency})
          <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <button className="primary" onClick={() => act('deposit')}>Depositar</button>
        <button className="ghost" onClick={() => act('withdraw')}>Retirar</button>
      </div>
      <p className="muted small">Límite de depósito diario: {formatMoney(profile.daily_deposit_limit, profile.currency)}. Los retiros requieren KYC verificado.</p>
      {message && <div className="slip-message">{message}</div>}

      <h3>Movimientos</h3>
      <table className="tx-table">
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Importe</th><th>Saldo</th></tr></thead>
        <tbody>
          {txs.map((t) => (
            <tr key={t.id}>
              <td>{new Date(t.created_at.replace(' ', 'T') + 'Z').toLocaleString('es-ES')}</td>
              <td>{TX_LABEL[t.type] ?? t.type}</td>
              <td className={t.amount >= 0 ? 'pos' : 'neg'}>{formatMoney(t.amount, profile.currency)}</td>
              <td>{formatMoney(t.balance_after, profile.currency)}</td>
            </tr>
          ))}
          {txs.length === 0 && <tr><td colSpan={4} className="muted">Sin movimientos.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
