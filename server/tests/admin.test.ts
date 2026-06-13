import { describe, it, expect } from 'vitest';
import { setMarketStatus, forceKycStatus, listUsers, adminStats } from '../src/admin/admin.service.js';
import { setDepositLimit, applyPendingLimits } from '../src/account/account.service.js';
import { placeBet } from '../src/betting/betting.service.js';
import { AppError } from '../src/types.js';
import { findUserById } from '../src/auth/users.repo.js';
import { freshDb, makeUser, makeMatchWith1x2 } from './helpers.js';

describe('administración', () => {
  it('suspende un mercado e impide apostar en él', async () => {
    const db = await freshDb();
    const admin = await makeUser(db, { role: 'admin' });
    const user = await makeUser(db);
    const { marketId, selHome, odds } = await makeMatchWith1x2(db);

    await setMarketStatus(db, marketId, 'suspended', admin.id);
    try {
      await placeBet(db, user, { legs: [{ selectionId: selHome, expectedOdds: odds.home }], stake: 1000 }, null);
      expect.fail('debería lanzar');
    } catch (e) {
      expect((e as AppError).code).toBe('market_closed');
    }
    await db.close();
  });

  it('fuerza el estado KYC de un usuario', async () => {
    const db = await freshDb();
    const admin = await makeUser(db, { role: 'admin' });
    const user = await makeUser(db, { kyc_status: 'pending' });
    await forceKycStatus(db, user.id, 'verified', admin.id);
    expect((await findUserById(db, user.id))!.kyc_status).toBe('verified');
    await db.close();
  });

  it('lista usuarios y agrega estadísticas', async () => {
    const db = await freshDb();
    await makeUser(db);
    await makeUser(db);
    expect((await listUsers(db)).length).toBe(2);
    expect((await adminStats(db)).users).toBe(2);
    await db.close();
  });
});

describe('juego responsable', () => {
  it('reducir el límite de depósito es inmediato', async () => {
    const db = await freshDb();
    const user = await makeUser(db, { daily_deposit_limit: 50_000 });
    const res = await setDepositLimit(db, user, 20_000, null);
    expect(res.applied).toBe(true);
    expect((await findUserById(db, user.id))!.daily_deposit_limit).toBe(20_000);
    await db.close();
  });

  it('subir el límite queda pendiente (cooling-off) y se aplica al vencer', async () => {
    const db = await freshDb();
    const user = await makeUser(db, { daily_deposit_limit: 20_000 });
    const res = await setDepositLimit(db, user, 80_000, null);
    expect(res.applied).toBe(false);
    expect(res.effectiveAt).toBeTruthy();
    expect((await findUserById(db, user.id))!.daily_deposit_limit).toBe(20_000);

    await db.none(`UPDATE users SET pending_deposit_effective = $1 WHERE id = $2`, [new Date(Date.now() - 60_000).toISOString(), user.id]);
    const reloaded = await applyPendingLimits(db, (await findUserById(db, user.id))!);
    expect(reloaded.daily_deposit_limit).toBe(80_000);
    await db.close();
  });
});
