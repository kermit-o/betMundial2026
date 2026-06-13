export type Role = 'user' | 'admin';
export type KycStatus = 'pending' | 'verified' | 'rejected';

export interface User {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  date_of_birth: string;
  jurisdiction: string;
  currency: string;
  role: Role;
  kyc_status: KycStatus;
  email_verified: number;
  mfa_enabled: number;
  mfa_secret: string | null;
  self_excluded_until: string | null;
  daily_deposit_limit: number;
  daily_loss_limit: number | null;
  pending_deposit_limit: number | null;
  pending_deposit_effective: string | null;
  pending_loss_limit: number | null;
  pending_loss_effective: string | null;
  terms_accepted_at: string | null;
  signup_ip: string | null;
  created_at: string;
}

export type TransactionType = 'deposit' | 'withdrawal' | 'bet_stake' | 'bet_payout' | 'refund' | 'cashout';

export interface Transaction {
  id: string;
  user_id: string;
  type: TransactionType;
  amount: number;
  balance_after: number;
  ref_id: string | null;
  status: string;
  created_at: string;
}

export interface Match {
  id: string;
  stage: string;
  grp: string | null;
  home_team: string;
  away_team: string;
  kickoff: string;
  venue: string | null;
  status: 'scheduled' | 'live' | 'finished' | 'cancelled';
  home_score: number | null;
  away_score: number | null;
}

export interface Selection {
  id: string;
  market_id: string;
  name: string;
  odds: number;
  result: 'pending' | 'won' | 'lost' | 'void';
}

export interface Market {
  id: string;
  match_id: string;
  type: string;
  name: string;
  status: 'open' | 'suspended' | 'settled';
}

export type BetStatus = 'open' | 'won' | 'lost' | 'void' | 'cashed_out';
export type LegResult = 'pending' | 'won' | 'lost' | 'void';

export interface Bet {
  id: string;
  user_id: string;
  type: 'single' | 'combo';
  stake: number;
  total_odds: number;
  potential_payout: number;
  status: BetStatus;
  cash_out_value: number | null;
  risk_score: number;
  placed_at: string;
  settled_at: string | null;
}

export interface BetLeg {
  id: string;
  bet_id: string;
  selection_id: string;
  market_id: string;
  match_id: string;
  odds: number;
  result: LegResult;
}

export interface PaymentIntent {
  id: string;
  user_id: string;
  provider: string;
  type: 'deposit' | 'payout';
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed';
  idempotency_key: string;
  provider_ref: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  jurisdiction: string;
}

/** Error de negocio con código y estado HTTP, distinguible de fallos inesperados. */
export class AppError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
