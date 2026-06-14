import { useCallback, useEffect, useState } from 'react';
import { Api, clearToken, getToken, type Branding, type Profile } from './api.js';
import { AuthView } from './components/AuthView.js';
import { MatchesView } from './components/MatchesView.js';
import { WalletView } from './components/WalletView.js';
import { AccountView } from './components/AccountView.js';
import { MyBetsView } from './components/MyBetsView.js';
import { AdminView } from './components/AdminView.js';
import { RealityCheck } from './components/RealityCheck.js';

type Tab = 'matches' | 'wallet' | 'bets' | 'account' | 'admin';

/** Aplica la marca del operador: color principal y título de la pestaña. */
function applyBranding(b: Branding): void {
  document.documentElement.style.setProperty('--primary', b.primaryColor);
  document.title = b.displayName;
}

export function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [balance, setBalance] = useState(0);
  const [tab, setTab] = useState<Tab>('matches');
  const [loading, setLoading] = useState(true);
  const [branding, setBranding] = useState<Branding | null>(null);

  useEffect(() => {
    Api.branding()
      .then((b) => {
        setBranding(b);
        applyBranding(b);
      })
      .catch(() => {});
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const { user, balance } = await Api.me();
      setProfile(user);
      setBalance(balance);
    } catch {
      clearToken();
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    if (getToken()) refreshMe().finally(() => setLoading(false));
    else setLoading(false);
  }, [refreshMe]);

  function onLogout() {
    clearToken();
    setProfile(null);
    setTab('matches');
  }

  if (loading) return <div className="centered">Cargando…</div>;
  if (!profile) return <AuthView onAuth={() => refreshMe()} branding={branding} />;

  const isAdmin = profile.role === 'admin';
  const brandName = branding?.displayName ?? 'Bet Mundial 2026';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          {branding?.logoUrl ? <img src={branding.logoUrl} alt="" className="brand-logo" /> : '⚽'} {brandName}
        </div>
        <nav className="tabs">
          <button className={tab === 'matches' ? 'active' : ''} onClick={() => setTab('matches')}>Partidos</button>
          <button className={tab === 'bets' ? 'active' : ''} onClick={() => setTab('bets')}>Mis apuestas</button>
          <button className={tab === 'wallet' ? 'active' : ''} onClick={() => setTab('wallet')}>Cartera</button>
          <button className={tab === 'account' ? 'active' : ''} onClick={() => setTab('account')}>Cuenta</button>
          {isAdmin && <button className={tab === 'admin' ? 'active' : ''} onClick={() => setTab('admin')}>Admin</button>}
        </nav>
        <div className="user-area">
          <span className="balance" title="Saldo disponible">
            {(balance / 100).toLocaleString('es-ES', { style: 'currency', currency: profile.currency })}
          </span>
          <span className="email">{profile.email}</span>
          <button className="ghost" onClick={onLogout}>Salir</button>
        </div>
      </header>

      <RealityCheck />

      {profile.kyc_status !== 'verified' && (
        <div className="banner warn">
          Tu cuenta no está verificada (KYC). Verifícala en <button className="link" onClick={() => setTab('account')}>Cuenta</button> para poder apostar y retirar.
        </div>
      )}
      {profile.self_excluded_until && new Date(profile.self_excluded_until) > new Date() && (
        <div className="banner danger">
          Cuenta en autoexclusión hasta {new Date(profile.self_excluded_until).toLocaleDateString('es-ES')}. No puedes apostar.
        </div>
      )}

      <main className="content">
        {tab === 'matches' && <MatchesView profile={profile} onBalanceChange={setBalance} />}
        {tab === 'bets' && <MyBetsView profile={profile} onBalanceChange={setBalance} />}
        {tab === 'wallet' && <WalletView profile={profile} balance={balance} onBalanceChange={setBalance} />}
        {tab === 'account' && <AccountView profile={profile} onUpdated={refreshMe} />}
        {tab === 'admin' && isAdmin && <AdminView />}
      </main>

      <footer className="footer">
        <span>Juega con responsabilidad. +18. El juego puede causar adicción.</span>
        <span>Líneas de ayuda: 900 200 225 (ES) · jugarbien.es</span>
      </footer>
    </div>
  );
}
