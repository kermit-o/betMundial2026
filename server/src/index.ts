import http from 'node:http';
import { config, assertProductionConfig } from './config.js';
import { getDb, closeDb } from './db/index.js';
import { closeRedis } from './infra/redis.js';
import { createApp } from './app.js';
import { OddsEngine } from './realtime/oddsEngine.js';
import { logger } from './utils/logger.js';

// Falla rápido si la configuración de producción es insegura.
assertProductionConfig();

const db = await getDb();
const app = createApp(db);
const server = http.createServer(app);

const oddsEngine = new OddsEngine(db, server);
oddsEngine.start();

server.listen(config.port, () => {
  logger.info('server_started', {
    port: config.port,
    env: config.env,
    ws: `ws://localhost:${config.port}/ws/odds`,
  });
});

// Apagado controlado: cerrar conexiones, motor de cuotas y BD para no perder datos.
let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('server_shutdown', { signal });
  oddsEngine.stop();
  server.close(() => {
    void Promise.allSettled([closeDb(), closeRedis()]).finally(() => process.exit(0));
  });
  // Salida forzada si algo se cuelga.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => logger.error('unhandled_rejection', { reason: String(reason) }));
process.on('uncaughtException', (err) => logger.error('uncaught_exception', { error: String(err) }));
