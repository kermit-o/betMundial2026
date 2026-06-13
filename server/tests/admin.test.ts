import { describe, it, expect } from 'vitest';
import { setMarketStatus, forceKycStatus, listUsers, adminStats } from '../src/admin/admin.service.js';
import { setDepositLimit, applyPendingLimits } from '../src/account/account.service.js';
import { placeBet } from '../src/betting/betting.service.js';
import { AppError } from '../src/types.js';
import { findUserById } from '../src/auth/users.repo.js';
import { freshDb, makeUser, makeMatchWith1x2 } from './helpers.js';

describe('administración', () => {
  it('suspende un mercado e impide apostar en él', () => {
    const db = freshDb();
    const admin = makeUser(db, { role: 'admin' });
    const user = makeUser(db);
    const { marketId, selHome, odds } = makeMatchWith1x2(db);

    setMarketStatus(db, marketId, 'suspended', admin.id);
    try {
      placeBet(db, user, { legs: [{ selectionId: selHome, expectedOdds: odds.home }], stake: 1000 }, null);
      expect.fail('debería lanzar');
    } catch (e) {
      expect((e as AppError).code).toBe('market_closed');
    }
  });

  it('fuerza el estado KYC de un usuario', () => {
    const db = freshDb();
    const admin = makeUser(db, { role: 'admin' });
    const user = makeUser(db, { kyc_status: 'pending' });
    forceKycStatus(db, user.id, 'verified', admin.id);
    expect(findUserById(db, user.id)!.kyc_status).toBe('verified');
  });

  it('lista usuarios y agrega estadísticas', () => {
    const db = freshDb();
    makeUser(db);
    makeUser(db);
    expect(listUsers(db).length).toBe(2);
    expect(adminStats(db).users).toBe(2);
  });
});

describe('juego responsable', () => {
  it('reducir el límite de depósito es inmediato', () => {
    const db = freshDb();
    const user = makeUser(db, { daily_deposit_limit: 50_000 });
    const res = setDepositLimit(db, user, 20_000, null);
    expect(res.applied).toBe(true);
    expect(findUserById(db, user.id)!.daily_deposit_limit).toBe(20_000);
  });

  it('subir el límite queda pendiente (cooling-off) y se aplica al vencer', () => {
    const db = freshDb();
    const user = makeUser(db, { daily_deposit_limit: 20_000 });
    const res = setDepositLimit(db, user, 80_000, null);
    expect(res.applied).toBe(false);
    expect(res.effectiveAt).toBeTruthy();
    // Aún no se aplica.
    expect(findUserById(db, user.id)!.daily_deposit_limit).toBe(20_000);

    // Forzamos que el periodo de enfriamiento haya vencido.
    db.prepare(`UPDATE users SET pending_deposit_effective = datetime('now','-1 minute') WHERE id = ?`).run(user.id);
    const reloaded = applyPendingLimits(db, findUserById(db, user.id)!);
    expect(reloaded.daily_deposit_limit).toBe(80_000);
  });
});
