import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { pathToFileURL } from 'node:url';
import type Database from 'better-sqlite3';
import { getDb } from './index.js';

interface TeamSeed { code: string; name: string; grp: string }

const TEAMS: TeamSeed[] = [
  { code: 'MEX', name: 'México', grp: 'A' },
  { code: 'USA', name: 'Estados Unidos', grp: 'B' },
  { code: 'CAN', name: 'Canadá', grp: 'C' },
  { code: 'ARG', name: 'Argentina', grp: 'D' },
  { code: 'BRA', name: 'Brasil', grp: 'E' },
  { code: 'FRA', name: 'Francia', grp: 'F' },
  { code: 'ESP', name: 'España', grp: 'G' },
  { code: 'ENG', name: 'Inglaterra', grp: 'H' },
  { code: 'GER', name: 'Alemania', grp: 'A' },
  { code: 'POR', name: 'Portugal', grp: 'B' },
  { code: 'NED', name: 'Países Bajos', grp: 'C' },
  { code: 'URU', name: 'Uruguay', grp: 'D' },
];

/** Convierte una probabilidad en cuota decimal aplicando el margen de la casa. */
function priceFromProb(p: number, margin = 0.07): number {
  const raw = 1 / p;
  const priced = raw / (1 + margin);
  return Math.max(1.01, Math.round(priced * 100) / 100);
}

export function seed(db: Database.Database): void {
  const existing = db.prepare(`SELECT COUNT(*) AS n FROM matches`).get() as { n: number };
  if (existing.n > 0) {
    console.log('[seed] La base de datos ya contiene partidos; no se vuelve a sembrar.');
    return;
  }

  const insertTeam = db.prepare(`INSERT INTO teams (id, name, code, grp) VALUES (?, ?, ?, ?)`);
  const teamIds = new Map<string, string>();

  const insertMatch = db.prepare(
    `INSERT INTO matches (id, stage, grp, home_team, away_team, kickoff, venue, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertMarket = db.prepare(`INSERT INTO markets (id, match_id, type, name, status) VALUES (?, ?, ?, ?, 'open')`);
  const insertSel = db.prepare(`INSERT INTO selections (id, market_id, name, odds) VALUES (?, ?, ?, ?)`);

  const run = db.transaction(() => {
    for (const t of TEAMS) {
      const id = nanoid();
      teamIds.set(t.code, id);
      insertTeam.run(id, t.name, t.code, t.grp);
    }

    // Partidos de ejemplo (jornada inaugural y otros) con kickoff en el futuro.
    const fixtures: Array<[string, string, string, string, string]> = [
      // home, away, stage, venue, kickoffISO
      ['MEX', 'GER', 'group', 'Estadio Azteca, CDMX', '2026-06-11T18:00:00Z'],
      ['USA', 'POR', 'group', 'SoFi Stadium, Los Ángeles', '2026-06-12T20:00:00Z'],
      ['CAN', 'NED', 'group', 'BMO Field, Toronto', '2026-06-13T22:00:00Z'],
      ['ARG', 'URU', 'group', 'MetLife Stadium, Nueva York', '2026-06-14T18:00:00Z'],
      ['BRA', 'FRA', 'group', 'AT&T Stadium, Dallas', '2026-06-15T21:00:00Z'],
      ['ESP', 'ENG', 'group', 'Mercedes-Benz Stadium, Atlanta', '2026-06-16T19:00:00Z'],
    ];

    // Fuerza relativa para fijar probabilidades (cuanto mayor, más favorito).
    const strength: Record<string, number> = {
      ARG: 92, BRA: 91, FRA: 93, ESP: 90, ENG: 88, GER: 86, POR: 85,
      NED: 84, URU: 80, USA: 75, MEX: 74, CAN: 70,
    };

    for (const [home, away, stage, venue, kickoff] of fixtures) {
      const matchId = nanoid();
      insertMatch.run(matchId, stage, TEAMS.find((t) => t.code === home)!.grp, teamIds.get(home)!, teamIds.get(away)!, kickoff, venue, 'scheduled');

      const sh = strength[home] ?? 75;
      const sa = strength[away] ?? 75;
      // Probabilidades base con ventaja de localía implícita.
      const total = sh * 1.1 + sa + 30; // 30 ~ peso del empate
      const pHome = (sh * 1.1) / total;
      const pAway = sa / total;
      const pDraw = 30 / total;

      // Mercado 1x2
      const m1 = nanoid();
      insertMarket.run(m1, matchId, '1x2', 'Resultado (1X2)');
      insertSel.run(nanoid(), m1, 'Local', priceFromProb(pHome));
      insertSel.run(nanoid(), m1, 'Empate', priceFromProb(pDraw));
      insertSel.run(nanoid(), m1, 'Visitante', priceFromProb(pAway));

      // Mercado Over/Under 2.5
      const m2 = nanoid();
      insertMarket.run(m2, matchId, 'over_under_2_5', 'Total de goles 2.5');
      insertSel.run(nanoid(), m2, 'Más de 2.5', priceFromProb(0.52));
      insertSel.run(nanoid(), m2, 'Menos de 2.5', priceFromProb(0.48));

      // Mercado Ambos equipos marcan
      const m3 = nanoid();
      insertMarket.run(m3, matchId, 'btts', 'Ambos equipos marcan');
      insertSel.run(nanoid(), m3, 'Sí', priceFromProb(0.55));
      insertSel.run(nanoid(), m3, 'No', priceFromProb(0.45));
    }

    // Usuario administrador para liquidaciones.
    const adminId = nanoid();
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    db.prepare(
      `INSERT INTO users (id, email, password_hash, full_name, date_of_birth, jurisdiction, currency,
        role, kyc_status, daily_deposit_limit, terms_accepted_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'admin', 'verified', 1000000, ?, ?)`,
    ).run(adminId, 'admin@betmundial2026.test', bcrypt.hashSync('Admin1234!', 10), 'Administrador', '1980-01-01', 'ES', 'EUR', now, now);
    db.prepare(`INSERT INTO wallets (user_id, balance, currency) VALUES (?, 0, 'EUR')`).run(adminId);
  });
  run();

  console.log(`[seed] Sembrados ${TEAMS.length} equipos, 6 partidos con 3 mercados cada uno y 1 usuario admin.`);
  console.log('[seed] Admin: admin@betmundial2026.test / Admin1234!');
}

// Permite ejecutar como script: `npm run seed`.
const invokedDirectly =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const db = getDb();
  seed(db);
  db.close();
}
