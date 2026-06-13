import type Database from 'better-sqlite3';

/**
 * Métricas en proceso expuestas en formato de texto Prometheus. Cubre tráfico
 * HTTP (contador + histograma de latencia) y gauges de negocio recolectados de
 * la BD en el momento del scrape. Sin dependencias.
 */

type Labels = Record<string, string>;

const counters = new Map<string, number>();
const LATENCY_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]; // ms
const histogramBuckets = new Map<string, number[]>();
const histogramSum = new Map<string, number>();
const histogramCount = new Map<string, number>();

function key(name: string, labels?: Labels): string {
  if (!labels || Object.keys(labels).length === 0) return name;
  const parts = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, '')}"`)
    .join(',');
  return `${name}{${parts}}`;
}

export function incCounter(name: string, labels?: Labels, by = 1): void {
  const k = key(name, labels);
  counters.set(k, (counters.get(k) ?? 0) + by);
}

export function observeLatency(name: string, labels: Labels, ms: number): void {
  const k = key(name, labels);
  let buckets = histogramBuckets.get(k);
  if (!buckets) {
    buckets = new Array(LATENCY_BUCKETS.length).fill(0);
    histogramBuckets.set(k, buckets);
  }
  for (let i = 0; i < LATENCY_BUCKETS.length; i++) {
    if (ms <= LATENCY_BUCKETS[i]) buckets[i]++;
  }
  histogramSum.set(k, (histogramSum.get(k) ?? 0) + ms);
  histogramCount.set(k, (histogramCount.get(k) ?? 0) + 1);
}

/** Gauges de negocio leídos de la BD en el momento del scrape. */
function businessGauges(db: Database.Database): string[] {
  const out: string[] = [];
  const q = (sql: string): number => (db.prepare(sql).get() as { v: number }).v;
  try {
    out.push('# HELP bet_users_total Número de usuarios registrados.');
    out.push('# TYPE bet_users_total gauge');
    out.push(`bet_users_total ${q('SELECT COUNT(*) AS v FROM users')}`);

    out.push('# HELP bet_open_bets_total Apuestas abiertas.');
    out.push('# TYPE bet_open_bets_total gauge');
    out.push(`bet_open_bets_total ${q("SELECT COUNT(*) AS v FROM bets WHERE status='open'")}`);

    out.push('# HELP bet_open_liability_minor Exposición abierta (pago potencial, minor units).');
    out.push('# TYPE bet_open_liability_minor gauge');
    out.push(`bet_open_liability_minor ${q("SELECT COALESCE(SUM(potential_payout),0) AS v FROM bets WHERE status='open'")}`);

    out.push('# HELP bet_fraud_flags_total Banderas de fraude registradas.');
    out.push('# TYPE bet_fraud_flags_total gauge');
    out.push(`bet_fraud_flags_total ${q('SELECT COUNT(*) AS v FROM fraud_flags')}`);

    out.push('# HELP bet_wallet_balance_minor Suma de saldos de carteras (minor units).');
    out.push('# TYPE bet_wallet_balance_minor gauge');
    out.push(`bet_wallet_balance_minor ${q('SELECT COALESCE(SUM(balance),0) AS v FROM wallets')}`);
  } catch {
    /* la BD podría no estar lista; omitir gauges */
  }
  return out;
}

export function renderMetrics(db: Database.Database): string {
  const lines: string[] = [];

  lines.push('# HELP bet_http_requests_total Total de peticiones HTTP.');
  lines.push('# TYPE bet_http_requests_total counter');
  for (const [k, v] of counters) {
    if (k.startsWith('bet_http_requests_total')) lines.push(`${k} ${v}`);
  }

  lines.push('# HELP bet_http_request_duration_ms Latencia de peticiones HTTP (histograma).');
  lines.push('# TYPE bet_http_request_duration_ms histogram');
  for (const [k, buckets] of histogramBuckets) {
    const base = k.slice('bet_http_request_duration_ms'.length); // {labels} o ''
    const inner = base.startsWith('{') ? base.slice(1, -1) : '';
    for (let i = 0; i < LATENCY_BUCKETS.length; i++) {
      const le = LATENCY_BUCKETS[i];
      const lbl = inner ? `${inner},le="${le}"` : `le="${le}"`;
      lines.push(`bet_http_request_duration_ms_bucket{${lbl}} ${buckets[i]}`);
    }
    const lblInf = inner ? `${inner},le="+Inf"` : `le="+Inf"`;
    lines.push(`bet_http_request_duration_ms_bucket{${lblInf}} ${histogramCount.get(k) ?? 0}`);
    const suffix = inner ? `{${inner}}` : '';
    lines.push(`bet_http_request_duration_ms_sum${suffix} ${histogramSum.get(k) ?? 0}`);
    lines.push(`bet_http_request_duration_ms_count${suffix} ${histogramCount.get(k) ?? 0}`);
  }

  lines.push(...businessGauges(db));
  return lines.join('\n') + '\n';
}

/** Sólo para pruebas: reinicia el estado de métricas. */
export function resetMetrics(): void {
  counters.clear();
  histogramBuckets.clear();
  histogramSum.clear();
  histogramCount.clear();
}
