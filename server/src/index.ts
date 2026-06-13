import http from 'node:http';
import { config } from './config.js';
import { getDb, closeDb } from './db/index.js';
import { createApp } from './app.js';
import { OddsEngine } from './realtime/oddsEngine.js';

const db = getDb();
const app = createApp(db);
const server = http.createServer(app);

const oddsEngine = new OddsEngine(db, server);
oddsEngine.start();

server.listen(config.port, () => {
  console.log(`[bet-mundial-2026] API escuchando en http://localhost:${config.port}`);
  console.log(`[bet-mundial-2026] WebSocket de cuotas en ws://localhost:${config.port}/ws/odds`);
  console.log(`[bet-mundial-2026] Entorno: ${config.env}`);
});

// Apagado controlado: cerrar conexiones, motor de cuotas y BD para no perder datos.
function shutdown(signal: string): void {
  console.log(`\n[bet-mundial-2026] Recibido ${signal}, cerrando...`);
  oddsEngine.stop();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  // Salida forzada si algo se cuelga.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
