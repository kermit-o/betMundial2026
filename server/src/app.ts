import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type Database from 'better-sqlite3';
import { buildRouter } from './routes/index.js';
import { rateLimit } from './middleware/rateLimit.js';
import { errorHandler } from './middleware/error.js';

export function createApp(db: Database.Database): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors());
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

  // 404 para rutas desconocidas bajo la API.
  app.use((_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'Recurso no encontrado.' } }));

  app.use(errorHandler);
  return app;
}
