import { describe, it, expect } from 'vitest';
import { ageFromDob, meetsMinAge, isSelfExcluded, assertCanBet } from '../src/compliance/compliance.service.js';
import { isJurisdictionAllowed } from '../src/compliance/jurisdictions.js';
import { AppError } from '../src/types.js';
import { freshDb, makeUser } from './helpers.js';

describe('cumplimiento normativo', () => {
  it('calcula la edad correctamente', () => {
    const now = new Date('2026-06-13T00:00:00Z');
    expect(ageFromDob('2008-06-12', now)).toBe(18);
    expect(ageFromDob('2008-06-14', now)).toBe(17);
  });

  it('rechaza a menores de edad según la jurisdicción', () => {
    const now = new Date('2026-06-13T00:00:00Z');
    expect(meetsMinAge('2009-01-01', 'ES', now)).toBe(false);
    expect(meetsMinAge('2000-01-01', 'ES', now)).toBe(true);
  });

  it('bloquea jurisdicciones no permitidas', () => {
    expect(isJurisdictionAllowed('ES')).toBe(true);
    expect(isJurisdictionAllowed('XX')).toBe(false);
  });

  it('detecta autoexclusión vigente', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(isSelfExcluded({ self_excluded_until: future })).toBe(true);
    expect(isSelfExcluded({ self_excluded_until: past })).toBe(false);
    expect(isSelfExcluded({ self_excluded_until: null })).toBe(false);
  });

  it('assertCanBet exige KYC verificado', () => {
    const db = freshDb();
    const user = makeUser(db, { kyc_status: 'pending' });
    expect(() => assertCanBet(db, user)).toThrowError(AppError);
  });

  it('assertCanBet bloquea usuario autoexcluido', () => {
    const db = freshDb();
    const user = makeUser(db, { self_excluded_until: new Date(Date.now() + 86_400_000).toISOString() });
    try {
      assertCanBet(db, user);
      expect.fail('debería lanzar');
    } catch (e) {
      expect((e as AppError).code).toBe('self_excluded');
    }
  });
});
