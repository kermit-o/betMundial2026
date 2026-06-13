/** Marca de tiempo actual en ISO-8601 UTC (comparable lexicográfica = cronológicamente). */
export function nowIso(): string {
  return new Date().toISOString();
}

/** ISO de hace `ms` milisegundos (para ventanas temporales en consultas). */
export function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}
