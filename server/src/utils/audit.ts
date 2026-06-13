import { nanoid } from 'nanoid';
import type { Executor } from '../db/index.js';
import { nowIso } from './time.js';

/**
 * Registro de auditoría inmutable de toda acción sensible (financiera, de cuenta,
 * de cumplimiento). Imprescindible para trazabilidad regulatoria y forense AML.
 */
export async function audit(
  db: Executor,
  action: string,
  opts: { userId?: string | null; detail?: unknown; ip?: string | null } = {},
): Promise<void> {
  await db.none(
    `INSERT INTO audit_log (id, user_id, action, detail, ip, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      nanoid(),
      opts.userId ?? null,
      action,
      opts.detail === undefined ? null : JSON.stringify(opts.detail),
      opts.ip ?? null,
      nowIso(),
    ],
  );
}
