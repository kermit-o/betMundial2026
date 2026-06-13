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
  role: string;
  kyc_status: string;
  email_verified: number;
  mfa_enabled: number;
  self_excluded_until: string | null;
  daily_deposit_limit: number;
  daily_loss_limit: number | null;
  pending_deposit_limit: number | null;
  pending_deposit_effective: string | null;
  pending_loss_limit: number | null;
  pending_loss_effective: string | null;
}
export interface BetLeg {
  id: string;
  selection_id: string;
  market_id: string;
  match_id: string;
  odds: number;
  result: string;
}
export interface Bet {
  id: string;
  type: string;
  stake: number;
  total_odds: number;
  potential_payout: number;
  status: string;
  cash_out_value: number | null;
  placed_at: string;
  legs: BetLeg[];
  cashOutValue: number | null;
}
export interface Transaction {
  id: string;
  type: string;
  amount: number;
  balance_after: number;
  created_at: string;
}
export interface PaymentIntent {
  id: string;
  type: string;
  amount: number;
  status: string;
  provider: string;
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

export interface BetLegInput { selectionId: string; expectedOdds: number }

export const Api = {
  jurisdictions: () => api<{ jurisdictions: Array<{ code: string; name: string; minAge: number; currency: string }> }>('/jurisdictions'),
  register: (data: unknown) => api<{ token: string; user: Profile }>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  login: (data: unknown) => api<{ token: string; user: Profile }>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  forgotPassword: (email: string) => api<{ ok: boolean; devToken?: string }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token: string, newPassword: string) => api<{ ok: boolean }>('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, newPassword }) }),
  verifyEmail: (token: string) => api<{ ok: boolean }>('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }),

  me: () => api<{ user: Profile; balance: number }>('/me'),
  realityCheck: () => api<{ windowMinutes: number; betsCount: number; totalStaked: number; netResult: number }>('/me/reality-check'),
  matches: () => api<{ matches: Match[] }>('/matches'),

  wallet: () => api<{ balance: number; transactions: Transaction[]; payments: PaymentIntent[] }>('/wallet'),
  deposit: (amount: number) => api<{ intent: PaymentIntent; balance: number; redirectUrl?: string }>('/wallet/deposit', { method: 'POST', body: JSON.stringify({ amount }) }),
  withdraw: (amount: number) => api<{ intent: PaymentIntent; balance: number }>('/wallet/withdraw', { method: 'POST', body: JSON.stringify({ amount }) }),

  placeBet: (legs: BetLegInput[], stake: number) =>
    api<{ bet: Bet; balance: number }>('/bets', { method: 'POST', body: JSON.stringify({ legs, stake }) }),
  myBets: () => api<{ bets: Bet[] }>('/bets'),
  cashOut: (betId: string) => api<{ value: number; balance: number }>(`/bets/${betId}/cashout`, { method: 'POST' }),

  submitKyc: (data: unknown) => api<{ kyc_status: string }>('/me/kyc', { method: 'POST', body: JSON.stringify(data) }),
  requestEmailVerify: () => api<{ ok: boolean; devToken: string }>('/me/email/verify-request', { method: 'POST' }),
  setDepositLimit: (amount: number) => api<{ applied: boolean; effectiveAt?: string }>('/me/limits/deposit', { method: 'PUT', body: JSON.stringify({ amount }) }),
  setLossLimit: (amount: number | null) => api<{ applied: boolean; effectiveAt?: string }>('/me/limits/loss', { method: 'PUT', body: JSON.stringify({ amount }) }),
  selfExclude: (days: number) => api<{ until: string }>('/me/self-exclude', { method: 'POST', body: JSON.stringify({ days }) }),

  mfaSetup: () => api<{ secret: string; otpauthUrl: string }>('/me/mfa/setup', { method: 'POST' }),
  mfaEnable: (code: string) => api<{ ok: boolean }>('/me/mfa/enable', { method: 'POST', body: JSON.stringify({ code }) }),
  mfaDisable: (code: string) => api<{ ok: boolean }>('/me/mfa/disable', { method: 'POST', body: JSON.stringify({ code }) }),

  // Admin
  adminStats: () => api<{ users: number; openBets: number; fraudFlags: number; openLiability: number }>('/admin/stats'),
  adminFraud: () => api<{ flags: Array<Record<string, unknown>> }>('/admin/fraud-flags'),
  adminAudit: () => api<{ entries: Array<Record<string, unknown>> }>('/admin/audit'),
  adminUsers: () => api<{ users: Array<Record<string, unknown>> }>('/admin/users'),
  adminSettle: (matchId: string, homeScore: number, awayScore: number) =>
    api<{ settledBets: number; totalPaidOut: number }>(`/admin/matches/${matchId}/settle`, { method: 'POST', body: JSON.stringify({ homeScore, awayScore }) }),
  adminMarketStatus: (marketId: string, status: 'open' | 'suspended') =>
    api<{ id: string; status: string }>(`/admin/markets/${marketId}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  adminForceKyc: (userId: string, status: string) =>
    api<{ userId: string; kyc_status: string }>(`/admin/users/${userId}/kyc`, { method: 'POST', body: JSON.stringify({ status }) }),
};

export const formatMoney = (minor: number, currency = 'EUR') =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(minor / 100);
