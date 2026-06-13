import type Database from 'better-sqlite3';
import type { Match, Market, Selection } from '../types.js';

export interface MarketWithSelections extends Market {
  selections: Selection[];
}

export interface MatchWithMarkets extends Match {
  homeTeamName: string;
  awayTeamName: string;
  markets: MarketWithSelections[];
}

export function listMatches(db: Database.Database, statusFilter?: string): MatchWithMarkets[] {
  const matches = (
    statusFilter
      ? db.prepare(`SELECT * FROM matches WHERE status = ? ORDER BY kickoff`).all(statusFilter)
      : db.prepare(`SELECT * FROM matches ORDER BY kickoff`).all()
  ) as Match[];

  return matches.map((m) => hydrateMatch(db, m));
}

export function getMatch(db: Database.Database, matchId: string): MatchWithMarkets | undefined {
  const m = db.prepare(`SELECT * FROM matches WHERE id = ?`).get(matchId) as Match | undefined;
  return m ? hydrateMatch(db, m) : undefined;
}

function hydrateMatch(db: Database.Database, m: Match): MatchWithMarkets {
  const home = db.prepare(`SELECT name FROM teams WHERE id = ?`).get(m.home_team) as { name: string } | undefined;
  const away = db.prepare(`SELECT name FROM teams WHERE id = ?`).get(m.away_team) as { name: string } | undefined;
  const markets = db.prepare(`SELECT * FROM markets WHERE match_id = ?`).all(m.id) as Market[];
  return {
    ...m,
    homeTeamName: home?.name ?? m.home_team,
    awayTeamName: away?.name ?? m.away_team,
    markets: markets.map((mk) => ({
      ...mk,
      selections: db.prepare(`SELECT * FROM selections WHERE market_id = ?`).all(mk.id) as Selection[],
    })),
  };
}
