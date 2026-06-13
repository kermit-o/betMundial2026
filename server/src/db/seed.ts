import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { pathToFileURL } from 'node:url';
import type { Db, Executor } from './index.js';
import { getDb, closeDb } from './index.js';
import { nowIso } from '../utils/time.js';

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

export async function seed(db: Db): Promise<void> {
  const existing = await db.oneOrNone<{ n: number }>(`SELECT COUNT(*)::int AS n FROM matches`);
  if ((existing?.n ?? 0) > 0) {
    console.log('[seed] La base de datos ya contiene partidos; no se vuelve a sembrar.');
    return;
  }

  await db.tx(async (t: Executor) => {
    const teamIds = new Map<string, string>();
    for (const team of TEAMS) {
      const id = nanoid();
      teamIds.set(team.code, id);
      await t.none(`INSERT INTO teams (id, name, code, grp) VALUES ($1,$2,$3,$4)`, [id, team.name, team.code, team.grp]);
    }

    const fixtures: Array<[string, string, string, string, string]> = [
      ['MEX', 'GER', 'group', 'Estadio Azteca, CDMX', '2026-06-11T18:00:00Z'],
      ['USA', 'POR', 'group', 'SoFi Stadium, Los Ángeles', '2026-06-12T20:00:00Z'],
      ['CAN', 'NED', 'group', 'BMO Field, Toronto', '2026-06-13T22:00:00Z'],
      ['ARG', 'URU', 'group', 'MetLife Stadium, Nueva York', '2026-06-14T18:00:00Z'],
      ['BRA', 'FRA', 'group', 'AT&T Stadium, Dallas', '2026-06-15T21:00:00Z'],
      ['ESP', 'ENG', 'group', 'Mercedes-Benz Stadium, Atlanta', '2026-06-16T19:00:00Z'],
    ];

    const strength: Record<string, number> = {
      ARG: 92, BRA: 91, FRA: 93, ESP: 90, ENG: 88, GER: 86, POR: 85,
      NED: 84, URU: 80, USA: 75, MEX: 74, CAN: 70,
    };

    for (const [home, away, stage, venue, kickoff] of fixtures) {
      const matchId = nanoid();
      await t.none(
        `INSERT INTO matches (id,stage,grp,home_team,away_team,kickoff,venue,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled')`,
        [matchId, stage, TEAMS.find((x) => x.code === home)!.grp, teamIds.get(home)!, teamIds.get(away)!, kickoff, venue],
      );

      const sh = strength[home] ?? 75;
      const sa = strength[away] ?? 75;
      const total = sh * 1.1 + sa + 30;
      const pHome = (sh * 1.1) / total;
      const pAway = sa / total;
      const pDraw = 30 / total;

      const addMarket = async (type: string, name: string, sels: Array<[string, number]>) => {
        const marketId = nanoid();
        await t.none(`INSERT INTO markets (id,match_id,type,name,status) VALUES ($1,$2,$3,$4,'open')`, [marketId, matchId, type, name]);
        for (const [selName, odds] of sels) {
          await t.none(`INSERT INTO selections (id,market_id,name,odds) VALUES ($1,$2,$3,$4)`, [nanoid(), marketId, selName, odds]);
        }
      };

      await addMarket('1x2', 'Resultado (1X2)', [
        ['Local', priceFromProb(pHome)],
        ['Empate', priceFromProb(pDraw)],
        ['Visitante', priceFromProb(pAway)],
      ]);
      await addMarket('over_under_2_5', 'Total de goles 2.5', [
        ['Más de 2.5', priceFromProb(0.52)],
        ['Menos de 2.5', priceFromProb(0.48)],
      ]);
      await addMarket('btts', 'Ambos equipos marcan', [
        ['Sí', priceFromProb(0.55)],
        ['No', priceFromProb(0.45)],
      ]);
    }

    // Usuario administrador para liquidaciones.
    const adminId = nanoid();
    const now = nowIso();
    await t.none(
      `INSERT INTO users (id, email, password_hash, full_name, date_of_birth, jurisdiction, currency,
        role, kyc_status, email_verified, daily_deposit_limit, terms_accepted_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'admin','verified',1,1000000,$8,$8)`,
      [adminId, 'admin@betmundial2026.test', bcrypt.hashSync('Admin1234!', 10), 'Administrador', '1980-01-01', 'ES', 'EUR', now],
    );
    await t.none(`INSERT INTO wallets (user_id, balance, currency) VALUES ($1, 0, 'EUR')`, [adminId]);
  });

  console.log(`[seed] Sembrados ${TEAMS.length} equipos, 6 partidos con 3 mercados cada uno y 1 usuario admin.`);
  console.log('[seed] Admin: admin@betmundial2026.test / Admin1234!');
}

// Permite ejecutar como script: `npm run seed`.
const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const db = await getDb();
  await seed(db);
  await closeDb();
}
