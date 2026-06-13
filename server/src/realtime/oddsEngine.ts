import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { Db } from '../db/index.js';
import type { Selection } from '../types.js';
import { logger } from '../utils/logger.js';

/**
 * Motor de cuotas en vivo. Ajusta ligeramente las cuotas de los mercados abiertos
 * a intervalos cortos y publica los cambios por WebSocket para baja latencia.
 */
export class OddsEngine {
  private wss: WebSocketServer;
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private db: Db,
    server: Server,
    private intervalMs = 3000,
  ) {
    this.wss = new WebSocketServer({ server, path: '/ws/odds' });
    this.wss.on('connection', (ws) => {
      this.snapshot()
        .then((data) => ws.send(JSON.stringify({ type: 'snapshot', data })))
        .catch(() => {});
    });
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const client of this.wss.clients) client.close();
    this.wss.close();
  }

  private async snapshot(): Promise<Array<{ selectionId: string; marketId: string; odds: number }>> {
    return this.db.query<{ selectionId: string; marketId: string; odds: number }>(
      `SELECT s.id AS "selectionId", s.market_id AS "marketId", s.odds AS odds
         FROM selections s JOIN markets m ON m.id = s.market_id
        WHERE m.status = 'open'`,
    );
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const open = await this.db.query<Selection>(
        `SELECT s.* FROM selections s JOIN markets m ON m.id = s.market_id WHERE m.status = 'open'`,
      );
      if (open.length === 0) return;

      const updates: Array<{ selectionId: string; marketId: string; odds: number }> = [];
      for (const sel of open) {
        if (Math.random() > 0.3) continue;
        const driftPct = (Math.random() - 0.5) * 0.04; // ±2%
        let next = Math.round(sel.odds * (1 + driftPct) * 100) / 100;
        next = Math.min(Math.max(next, 1.01), 100);
        if (next !== sel.odds) {
          await this.db.none(`UPDATE selections SET odds = $1 WHERE id = $2`, [next, sel.id]);
          updates.push({ selectionId: sel.id, marketId: sel.market_id, odds: next });
        }
      }
      if (updates.length > 0) this.broadcast({ type: 'odds', data: updates });
    } catch (err) {
      logger.warn('odds_tick_error', { error: String(err) });
    } finally {
      this.ticking = false;
    }
  }

  private broadcast(message: unknown): void {
    const payload = JSON.stringify(message);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }
}
