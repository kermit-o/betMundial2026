import Redis from 'ioredis';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Capa Redis OPCIONAL. Si REDIS_URL no está definida, todo devuelve `null` y la
 * aplicación funciona en modo de una sola instancia (rate-limit en memoria,
 * difusión de cuotas local). Con REDIS_URL se habilita el modo multi-instancia.
 */
function build(label: string): Redis | null {
  if (!config.redisUrl) return null;
  const client = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 2,
  });
  client.on('error', (err) => logger.warn('redis_error', { label, error: String(err) }));
  client.on('connect', () => logger.info('redis_connected', { label }));
  return client;
}

let command: Redis | null = null;
let commandInit = false;

/** Cliente compartido para comandos normales (INCR, SET, etc.). */
export function getRedis(): Redis | null {
  if (!commandInit) {
    commandInit = true;
    command = build('command');
  }
  return command;
}

/**
 * Crea una conexión nueva (necesaria para suscripciones: un cliente en modo
 * subscribe no puede ejecutar comandos normales). Devuelve null sin REDIS_URL.
 */
export function createRedisConnection(label: string): Redis | null {
  return build(label);
}

export async function closeRedis(): Promise<void> {
  if (command) {
    await command.quit().catch(() => undefined);
    command = null;
    commandInit = false;
  }
}
