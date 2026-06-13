import { useEffect, useState } from 'react';
import { Api, formatMoney } from '../api.js';

/**
 * Aviso de "reality check": recuerda periódicamente al usuario el tiempo y el
 * gasto de su sesión. Aquí se comprueba cada pocos minutos; en producción el
 * intervalo sería configurable por el usuario (requisito de juego responsable).
 */
const INTERVAL_MS = 5 * 60 * 1000; // 5 min

export function RealityCheck() {
  const [data, setData] = useState<{ betsCount: number; totalStaked: number; netResult: number } | null>(null);

  useEffect(() => {
    let active = true;
    async function check() {
      try {
        const r = await Api.realityCheck();
        if (active && r.betsCount > 0) setData(r);
      } catch { /* ignorar */ }
    }
    const t = setInterval(check, INTERVAL_MS);
    return () => { active = false; clearInterval(t); };
  }, []);

  if (!data) return null;

  return (
    <div className="banner reality">
      <span>
        🕒 Llevas una sesión activa: {data.betsCount} apuesta(s), {formatMoney(data.totalStaked)} apostado.
        {' '}Resultado neto última hora: <strong>{formatMoney(data.netResult)}</strong>. Juega con responsabilidad.
      </span>
      <button className="link" onClick={() => setData(null)}>Entendido</button>
    </div>
  );
}
