import type Database from 'better-sqlite3';
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { Selection } from '../types.js';

/**
 * Motor de cuotas en vivo. Ajusta ligeramente las cuotas de los mercados abiertos
 * a intervalos cortos y publica los cambios por WebSocket para baja latencia
 * (los clientes no hacen polling). En producción el ajuste vendría del modelo de
 * trading/riesgo; aquí simulamos movimientos acotados y manteniendo el margen.
 */
export class OddsEngine {
  private wss: WebSocketServer;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private db: Database.Database,
    server: Server,
    private intervalMs = 3000,
  ) {
    this.wss = new WebSocketServer({ server, path: '/ws/odds' });
    this.wss.on('connection', (ws) => {
      ws.send(JSON.stringify({ type: 'snapshot', data: this.snapshot() }));
    });
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const client of this.wss.clients) client.close();
    this.wss.close();
  }

  /** Estado actual de cuotas de los mercados abiertos. */
  private snapshot(): Array<{ selectionId: string; marketId: string; odds: number }> {
    return this.db
      .prepare(
        `SELECT s.id AS selectionId, s.market_id AS marketId, s.odds AS odds
           FROM selections s JOIN markets m ON m.id = s.market_id
          WHERE m.status = 'open'`,
      )
      .all() as Array<{ selectionId: string; marketId: string; odds: number }>;
  }

  private tick(): void {
    const open = this.db
      .prepare(
        `SELECT s.* FROM selections s JOIN markets m ON m.id = s.market_id WHERE m.status = 'open'`,
      )
      .all() as Selection[];
    if (open.length === 0) return;

    const updates: Array<{ selectionId: string; marketId: string; odds: number }> = [];
    const update = this.db.prepare(`UPDATE selections SET odds = ? WHERE id = ?`);

    // Mover un subconjunto aleatorio de selecciones (mercado realista).
    for (const sel of open) {
      if (Math.random() > 0.3) continue;
      const driftPct = (Math.random() - 0.5) * 0.04; // ±2%
      let next = Math.round(sel.odds * (1 + driftPct) * 100) / 100;
      next = Math.min(Math.max(next, 1.01), 100); // límites de seguridad
      if (next !== sel.odds) {
        update.run(next, sel.id);
        updates.push({ selectionId: sel.id, marketId: sel.market_id, odds: next });
      }
    }

    if (updates.length > 0) this.broadcast({ type: 'odds', data: updates });
  }

  private broadcast(message: unknown): void {
    const payload = JSON.stringify(message);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }
}
