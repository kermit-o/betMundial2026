import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { buildRouter } from './routes/index.js';
import { rateLimit } from './middleware/rateLimit.js';
import { errorHandler } from './middleware/error.js';
import { requestLog } from './middleware/requestLog.js';
import { renderMetrics } from './observability/metrics.js';
import { config, isProd } from './config.js';

export function createApp(db: Database.Database): Express {
  const app = express();

  app.disable('x-powered-by');
  // Confiar en N saltos de proxy => req.ip refleja la IP real del cliente
  // (esencial para rate limiting y señales antifraude por IP detrás de un LB).
  app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      hsts: isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
      // CSP compatible con la SPA servida desde el mismo origen y el WebSocket.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          fontSrc: ["'self'", 'data:'],
        },
      },
    }),
  );

  // CORS: en producción, allowlist explícita; en dev, abierto.
  app.use(
    cors({
      origin: config.corsOrigins.length > 0 ? config.corsOrigins : true,
      credentials: true,
    }),
  );

  app.use(requestLog);

  // Sondas de salud (sin /api para que orquestadores las usen directamente).
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.get('/readyz', (_req, res) => {
    try {
      db.prepare('SELECT 1 AS ok').get();
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });
  if (config.metricsEnabled) {
    app.get('/metrics', (_req, res) => {
      res.setHeader('Content-Type', 'text/plain; version=0.0.4');
      res.send(renderMetrics(db));
    });
  }

  // Guardamos el cuerpo crudo para poder verificar firmas de webhooks.
  app.use(
    express.json({
      limit: '64kb',
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: string }).rawBody = buf.toString('utf-8');
      },
    }),
  );
  app.use(rateLimit()); // rate limit global por IP

  app.use('/api', buildRouter(db));

  // 404 para rutas /api desconocidas (no deben caer en la SPA).
  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'Recurso no encontrado.' } }));

  // Servir la SPA compilada si WEB_DIST existe (despliegue de un solo servicio).
  const webDist = process.env.WEB_DIST || path.resolve(process.cwd(), '../web/dist');
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    // Fallback SPA: cualquier GET no-API devuelve index.html.
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  // 404 genérico (sin SPA montada).
  app.use((_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'Recurso no encontrado.' } }));

  app.use(errorHandler);
  return app;
}
