import { sql, type SQL } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  Pool,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from "pg";

import * as schema from "./schema/index.js";

export type PlatformDatabase = NodePgDatabase<typeof schema>;

export interface PlatformPoolClient {
  query<Row extends QueryResultRow = QueryResultRow>(
    queryText: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface PlatformPool extends PlatformPoolClient {
  db: PlatformDatabase;
  $client: Pool;
  end(): Promise<void>;
}

export interface PlatformDatabaseContext {
  pool: PlatformPool;
  db: PlatformDatabase;
}

export interface PlatformPoolOptions {
  connectionString: string;
  applicationName?: string;
  maxConnections?: number;
  idleTimeoutMs?: number;
  statementTimeoutMs?: number;
  ssl?: PoolConfig["ssl"];
}

export function createPlatformPool(options: PlatformPoolOptions): PlatformPool {
  if (!options.connectionString.trim()) {
    throw new Error("Platform PostgreSQL connection string is required");
  }
  const rawPool = new Pool({
    connectionString: options.connectionString,
    application_name: options.applicationName ?? "radius-platform",
    max: options.maxConnections ?? 10,
    idleTimeoutMillis: options.idleTimeoutMs ?? 30_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    ssl: options.ssl,
  });
  const db = drizzle(rawPool, { schema });
  return {
    db,
    $client: rawPool,
    query: queryAdapter(db),
    end: () => rawPool.end(),
  };
}

export function createPlatformDatabase(
  options: PlatformPoolOptions,
): PlatformDatabaseContext {
  const pool = createPlatformPool(options);
  return { pool, db: pool.db };
}

export async function withPlatformTransaction<T>(
  pool: PlatformPool,
  work: (client: PlatformPoolClient) => Promise<T>,
): Promise<T> {
  return pool.db.transaction((transaction) =>
    work({ query: queryAdapter(transaction) }),
  );
}

function queryAdapter(executor: {
  execute(statement: SQL): Promise<unknown>;
}): PlatformPoolClient["query"] {
  return async <Row extends QueryResultRow = QueryResultRow>(
    queryText: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> => {
    const result = await executor.execute(parameterizedSql(queryText, values));
    return normalizeQueryResult(result as QueryResult<Row>);
  };
}

function normalizeQueryResult<Row extends QueryResultRow>(
  result: QueryResult<Row>,
): QueryResult<Row> {
  for (const row of result.rows) {
    for (const [column, value] of Object.entries(row)) {
      if (!column.endsWith("_at") || typeof value !== "string") continue;
      const timestamp = Date.parse(value);
      if (Number.isFinite(timestamp)) {
        (row as Record<string, unknown>)[column] = new Date(timestamp);
      }
    }
  }
  return result;
}

function parameterizedSql(
  queryText: string,
  values: readonly unknown[],
): SQL {
  const statement = sql.empty();
  const placeholder = /\$(\d+)/g;
  let offset = 0;
  for (const match of queryText.matchAll(placeholder)) {
    const index = Number(match[1]) - 1;
    if (index < 0 || index >= values.length) {
      throw new Error(`Missing PostgreSQL query parameter ${match[0]}`);
    }
    statement.append(sql.raw(queryText.slice(offset, match.index)));
    statement.append(sql`${values[index]}`);
    offset = match.index! + match[0].length;
  }
  statement.append(sql.raw(queryText.slice(offset)));
  return statement;
}
