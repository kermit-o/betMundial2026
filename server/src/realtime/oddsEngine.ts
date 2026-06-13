import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { Redis } from 'ioredis';
import { nanoid } from 'nanoid';
import type { Db } from '../db/index.js';
import type { Selection } from '../types.js';
import { getRedis, createRedisConnection } from '../infra/redis.js';
import { logger } from '../utils/logger.js';

const ODDS_CHANNEL = 'odds:updates';
const LEADER_KEY = 'odds:leader';

/**
 * Motor de cuotas en vivo. Ajusta ligeramente las cuotas de los mercados abiertos
 * a intervalos cortos y publica los cambios por WebSocket para baja latencia.
 *
 * Multi-instancia (con Redis): un único proceso "líder" calcula y persiste las
 * cuotas (un lock con TTL evita que N instancias multipliquen los cambios), y los
 * cambios se difunden por pub/sub para que TODAS las instancias los reenvíen a sus
 * clientes WebSocket. Sin Redis se comporta como una sola instancia local.
 */
export class OddsEngine {
  private wss: WebSocketServer;
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private readonly instanceId = nanoid(10);
  private readonly pub: Redis | null;
  private sub: Redis | null = null;
  private readonly leaderTtlMs: number;

  constructor(
    private db: Db,
    server: Server,
    private intervalMs = 3000,
  ) {
    this.pub = getRedis();
    // TTL del lock holgado respecto al intervalo para que un tick lento no haga
    // perder el liderazgo (se renueva en cada tick).
    this.leaderTtlMs = Math.max(intervalMs * 5, 5000);
    this.wss = new WebSocketServer({ server, path: '/ws/odds' });
    this.wss.on('connection', (ws) => {
      this.snapshot()
        .then((data) => ws.send(JSON.stringify({ type: 'snapshot', data })))
        .catch(() => {});
    });
  }

  start(): void {
    if (this.timer) return;
    // Suscripción de difusión: cada instancia reenvía a sus clientes los cambios
    // que cualquier instancia (el líder) publique.
    this.sub = createRedisConnection('odds-sub');
    if (this.sub) {
      this.sub.subscribe(ODDS_CHANNEL).catch((err) => logger.warn('odds_subscribe_error', { error: String(err) }));
      this.sub.on('message', (channel, message) => {
        if (channel !== ODDS_CHANNEL) return;
        try {
          this.broadcastLocal(JSON.parse(message));
        } catch {
          /* mensaje no válido: ignorar */
        }
      });
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.releaseLeadership();
    if (this.sub) {
      void this.sub.quit().catch(() => undefined);
      this.sub = null;
    }
    for (const client of this.wss.clients) client.close();
    this.wss.close();
  }

  /**
   * ¿Es esta instancia la que debe escribir las cuotas? Sin Redis, siempre.
   * Con Redis, mantiene un lock con TTL: lo adquiere si está libre o lo renueva
   * si ya es suyo; si pertenece a otra instancia, no escribe.
   */
  private async isLeader(): Promise<boolean> {
    if (!this.pub) return true;
    try {
      const acquired = await this.pub.set(LEADER_KEY, this.instanceId, 'PX', this.leaderTtlMs, 'NX');
      if (acquired === 'OK') return true;
      const holder = await this.pub.get(LEADER_KEY);
      if (holder === this.instanceId) {
        await this.pub.set(LEADER_KEY, this.instanceId, 'PX', this.leaderTtlMs); // renovar
        return true;
      }
      return false;
    } catch (err) {
      logger.warn('odds_leader_error', { error: String(err) });
      return false; // ante fallo de Redis, no escribir (evita duplicar cambios).
    }
  }

  private async releaseLeadership(): Promise<void> {
    if (!this.pub) return;
    try {
      const holder = await this.pub.get(LEADER_KEY);
      if (holder === this.instanceId) await this.pub.del(LEADER_KEY);
    } catch {
      /* mejor esfuerzo */
    }
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
      if (!(await this.isLeader())) return;

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
      if (updates.length > 0) await this.publish({ type: 'odds', data: updates });
    } catch (err) {
      logger.warn('odds_tick_error', { error: String(err) });
    } finally {
      this.ticking = false;
    }
  }

  /** Difunde a todas las instancias vía Redis, o local si no hay Redis. */
  private async publish(message: unknown): Promise<void> {
    if (this.pub) {
      // El propio 'sub' recibirá el mensaje y lo reenviará a los clientes locales.
      await this.pub.publish(ODDS_CHANNEL, JSON.stringify(message));
    } else {
      this.broadcastLocal(message);
    }
  }

  private broadcastLocal(message: unknown): void {
    const payload = JSON.stringify(message);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }
}
