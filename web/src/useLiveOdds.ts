import { useEffect, useRef, useState } from 'react';

export interface OddsUpdate { selectionId: string; marketId: string; odds: number }

/**
 * Suscripción a cuotas en vivo por WebSocket. Mantiene un mapa selectionId->odds
 * que se actualiza en tiempo real (baja latencia, sin polling). Reconecta
 * automáticamente con backoff si la conexión se cae.
 */
export function useLiveOdds(): { odds: Map<string, number>; connected: boolean } {
  const [odds, setOdds] = useState<Map<string, number>>(new Map());
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(1000);

  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout>;

    function connect() {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws/odds`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        retryRef.current = 1000;
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as { type: string; data: OddsUpdate[] };
        if (msg.type === 'snapshot' || msg.type === 'odds') {
          setOdds((prev) => {
            const next = new Map(prev);
            for (const u of msg.data) next.set(u.selectionId, u.odds);
            return next;
          });
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) {
          timer = setTimeout(connect, retryRef.current);
          retryRef.current = Math.min(retryRef.current * 2, 15_000);
        }
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      wsRef.current?.close();
    };
  }, []);

  return { odds, connected };
}
