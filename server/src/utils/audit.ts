import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

/**
 * Registro de auditoría inmutable de toda acción sensible (financiera, de cuenta,
 * de cumplimiento). Imprescindible para trazabilidad regulatoria y forense AML.
 */
export function audit(
  db: Database.Database,
  action: string,
  opts: { userId?: string | null; detail?: unknown; ip?: string | null } = {},
): void {
  db.prepare(
    `INSERT INTO audit_log (id, user_id, action, detail, ip) VALUES (?, ?, ?, ?, ?)`,
  ).run(
    nanoid(),
    opts.userId ?? null,
    action,
    opts.detail === undefined ? null : JSON.stringify(opts.detail),
    opts.ip ?? null,
  );
}
