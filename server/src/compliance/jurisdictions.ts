import { config } from '../config.js';

/**
 * Motor de reglas por jurisdicción. En un despliegue real estos parámetros
 * provendrían de la configuración legal vigente en cada mercado regulado.
 * Todos los importes monetarios están en "minor units" (céntimos).
 */
export interface JurisdictionRule {
  code: string;
  name: string;
  currency: string;
  minAge: number;
  /** Impuesto sobre la ganancia neta aplicado en la liquidación (0..1). */
  winningsTaxRate: number;
  /** Límite de depósito diario por defecto. El usuario puede fijar uno más estricto. */
  defaultDailyDepositLimit: number;
  /** Apuesta máxima por selección. */
  maxStake: number;
  /** Si la jurisdicción exige verificación KYC antes de apostar con dinero real. */
  kycRequiredBeforeBetting: boolean;
}

const RULES: Record<string, JurisdictionRule> = {
  ES: { code: 'ES', name: 'España', currency: 'EUR', minAge: 18, winningsTaxRate: 0, defaultDailyDepositLimit: 60_000, maxStake: 30_000, kycRequiredBeforeBetting: true },
  MX: { code: 'MX', name: 'México', currency: 'MXN', minAge: 18, winningsTaxRate: 0.06, defaultDailyDepositLimit: 50_000, maxStake: 25_000, kycRequiredBeforeBetting: true },
  CO: { code: 'CO', name: 'Colombia', currency: 'COP', minAge: 18, winningsTaxRate: 0, defaultDailyDepositLimit: 40_000, maxStake: 20_000, kycRequiredBeforeBetting: true },
  PE: { code: 'PE', name: 'Perú', currency: 'PEN', minAge: 18, winningsTaxRate: 0, defaultDailyDepositLimit: 40_000, maxStake: 20_000, kycRequiredBeforeBetting: true },
  AR: { code: 'AR', name: 'Argentina', currency: 'ARS', minAge: 18, winningsTaxRate: 0, defaultDailyDepositLimit: 40_000, maxStake: 20_000, kycRequiredBeforeBetting: true },
  CL: { code: 'CL', name: 'Chile', currency: 'CLP', minAge: 18, winningsTaxRate: 0, defaultDailyDepositLimit: 40_000, maxStake: 20_000, kycRequiredBeforeBetting: true },
  UK: { code: 'UK', name: 'Reino Unido', currency: 'GBP', minAge: 18, winningsTaxRate: 0, defaultDailyDepositLimit: 50_000, maxStake: 30_000, kycRequiredBeforeBetting: true },
  MT: { code: 'MT', name: 'Malta', currency: 'EUR', minAge: 18, winningsTaxRate: 0, defaultDailyDepositLimit: 60_000, maxStake: 30_000, kycRequiredBeforeBetting: true },
};

export function isJurisdictionAllowed(code: string): boolean {
  return config.allowedJurisdictions.includes(code.toUpperCase());
}

export function getJurisdictionRule(code: string): JurisdictionRule {
  const upper = code.toUpperCase();
  const rule = RULES[upper];
  if (rule) return rule;
  // Regla de respaldo conservadora para jurisdicciones permitidas sin ficha propia.
  return {
    code: upper,
    name: upper,
    currency: 'USD',
    minAge: config.minAge,
    winningsTaxRate: 0,
    defaultDailyDepositLimit: config.defaultDailyDepositLimit,
    maxStake: config.defaultMaxStake,
    kycRequiredBeforeBetting: true,
  };
}

export function listAllowedJurisdictions(): JurisdictionRule[] {
  return config.allowedJurisdictions.map(getJurisdictionRule);
}
