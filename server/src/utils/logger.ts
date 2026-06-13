import { config } from '../config.js';

/**
 * Logger estructurado mínimo (JSON una línea por evento). Apto para recolección
 * por agregadores (Loki, ELK, CloudWatch). Sin dependencias para mantener baja
 * latencia y superficie reducida.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
// En pruebas silenciamos por debajo de error para no contaminar la salida.
const threshold = config.env === 'test' ? ORDER.error : (ORDER[config.logLevel as Level] ?? ORDER.info);

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < threshold) return;
  const entry = { ts: new Date().toISOString(), level, msg, ...fields };
  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
};
