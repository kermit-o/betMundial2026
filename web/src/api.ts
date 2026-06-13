export interface Selection { id: string; market_id: string; name: string; odds: number; result: string }
export interface Market { id: string; match_id: string; type: string; name: string; status: string; selections: Selection[] }
export interface Match {
  id: string;
  stage: string;
  grp: string | null;
  homeTeamName: string;
  awayTeamName: string;
  kickoff: string;
  venue: string | null;
  status: string;
  home_score: number | null;
  away_score: number | null;
  markets: Market[];
}
export interface Profile {
  id: string;
  email: string;
  full_name: string;
  jurisdiction: string;
  currency: string;
  kyc_status: string;
  self_excluded_until: string | null;
  daily_deposit_limit: number;
  daily_loss_limit: number | null;
}
export interface Bet {
  id: string;
  stake: number;
  odds: number;
  potential_payout: number;
  status: string;
  placed_at: string;
  match_id: string;
}
export interface Transaction {
  id: string;
  type: string;
  amount: number;
  balance_after: number;
  created_at: string;
}

const TOKEN_KEY = 'bet_token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options.headers as Record<string, string>) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, { ...options, headers });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error ?? { code: 'unknown', message: 'Error de red' };
    throw new ApiError(err.code, err.message);
  }
  return body as T;
}

export const Api = {
  jurisdictions: () => api<{ jurisdictions: Array<{ code: string; name: string; minAge: number; currency: string }> }>('/jurisdictions'),
  register: (data: unknown) => api<{ token: string; user: Profile }>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  login: (data: unknown) => api<{ token: string; user: Profile }>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  me: () => api<{ user: Profile; balance: number }>('/me'),
  matches: () => api<{ matches: Match[] }>('/matches'),
  wallet: () => api<{ balance: number; transactions: Transaction[] }>('/wallet'),
  deposit: (amount: number) => api<{ balance: number }>('/wallet/deposit', { method: 'POST', body: JSON.stringify({ amount }) }),
  withdraw: (amount: number) => api<{ balance: number }>('/wallet/withdraw', { method: 'POST', body: JSON.stringify({ amount }) }),
  placeBet: (selectionId: string, stake: number, expectedOdds: number) =>
    api<{ bet: Bet; balance: number }>('/bets', { method: 'POST', body: JSON.stringify({ selectionId, stake, expectedOdds }) }),
  myBets: () => api<{ bets: Bet[] }>('/bets'),
  submitKyc: (data: unknown) => api<{ kyc_status: string }>('/me/kyc', { method: 'POST', body: JSON.stringify(data) }),
  setDepositLimit: (amount: number) => api<{ ok: boolean }>('/me/limits/deposit', { method: 'PUT', body: JSON.stringify({ amount }) }),
  setLossLimit: (amount: number | null) => api<{ ok: boolean }>('/me/limits/loss', { method: 'PUT', body: JSON.stringify({ amount }) }),
  selfExclude: (days: number) => api<{ until: string }>('/me/self-exclude', { method: 'POST', body: JSON.stringify({ days }) }),
};

export const formatMoney = (minor: number, currency = 'EUR') =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(minor / 100);
