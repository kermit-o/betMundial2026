import type { Executor } from '../db/index.js';
import type { Match, Market, Selection } from '../types.js';

export interface MarketWithSelections extends Market {
  selections: Selection[];
}

export interface MatchWithMarkets extends Match {
  homeTeamName: string;
  awayTeamName: string;
  markets: MarketWithSelections[];
}

export async function listMatches(db: Executor, statusFilter?: string): Promise<MatchWithMarkets[]> {
  const matches = statusFilter
    ? await db.query<Match>(`SELECT * FROM matches WHERE status = $1 ORDER BY kickoff`, [statusFilter])
    : await db.query<Match>(`SELECT * FROM matches ORDER BY kickoff`);
  const out: MatchWithMarkets[] = [];
  for (const m of matches) out.push(await hydrateMatch(db, m));
  return out;
}

export async function getMatch(db: Executor, matchId: string): Promise<MatchWithMarkets | undefined> {
  const m = await db.oneOrNone<Match>(`SELECT * FROM matches WHERE id = $1`, [matchId]);
  return m ? hydrateMatch(db, m) : undefined;
}

async function hydrateMatch(db: Executor, m: Match): Promise<MatchWithMarkets> {
  const home = await db.oneOrNone<{ name: string }>(`SELECT name FROM teams WHERE id = $1`, [m.home_team]);
  const away = await db.oneOrNone<{ name: string }>(`SELECT name FROM teams WHERE id = $1`, [m.away_team]);
  const markets = await db.query<Market>(`SELECT * FROM markets WHERE match_id = $1`, [m.id]);
  const marketsWith: MarketWithSelections[] = [];
  for (const mk of markets) {
    const selections = await db.query<Selection>(`SELECT * FROM selections WHERE market_id = $1`, [mk.id]);
    marketsWith.push({ ...mk, selections });
  }
  return {
    ...m,
    homeTeamName: home?.name ?? m.home_team,
    awayTeamName: away?.name ?? m.away_team,
    markets: marketsWith,
  };
}
