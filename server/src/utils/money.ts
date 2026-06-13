/**
 * Utilidades monetarias. Operamos siempre con enteros (minor units / céntimos)
 * para evitar errores de coma flotante. La conversión a/desde decimales sólo
 * ocurre en los bordes (entrada de usuario y presentación).
 */

export function toMinor(majorAmount: number): number {
  return Math.round(majorAmount * 100);
}

export function toMajor(minorAmount: number): number {
  return minorAmount / 100;
}

/**
 * Calcula el pago potencial bruto a partir de stake (minor units) y cuota decimal.
 * Trunca hacia abajo al céntimo para no pagar de más por redondeo.
 */
export function computePayout(stakeMinor: number, decimalOdds: number): number {
  return Math.floor(stakeMinor * decimalOdds);
}

export function formatMinor(minorAmount: number, currency: string): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(toMajor(minorAmount));
}
