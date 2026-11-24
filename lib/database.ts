import 'server-only';
import { Pool, types } from 'pg';
import { compileSql } from './sql';
types.setTypeParser(20, (value) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('Database count exceeds safe integer range');
  return n;
});
let pool: Pool | undefined;
function getPool() {
  if (!process.env.DATABASE_URL) throw new Error('Database connection is not configured.');
  return (pool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    ssl:
      process.env.DATABASE_SSL === 'disable'
        ? false
        : {
            rejectUnauthorized: true,
            ca: process.env.SUPABASE_DB_CA_CERT?.replace(/\\n/g, '\n'),
          },
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 10000,
  }));
}
export class Statement {
  constructor(
    public sql: string,
    public values: any[] = [],
  ) {}
  bind(...values: any[]) {
    return new Statement(this.sql, values);
  }
  async all() {
    const r = await getPool().query(compileSql(this.sql), this.values);
    return { results: r.rows };
  }
  async first<T = Record<string, unknown>>() {
    return ((await this.all()).results[0] as T) || null;
  }
  async run() {
    const r = await getPool().query(compileSql(this.sql), this.values);
    return { meta: { changes: r.rowCount } };
  }
}
export function database() {
  return {
    prepare: (sql: string) => new Statement(sql),
    async batch(statements: Statement[]) {
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        const results = [];
        for (const s of statements) {
          const r = await client.query(compileSql(s.sql), s.values);
          results.push({ meta: { changes: r.rowCount } });
        }
        await client.query('COMMIT');
        return results;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
  };
}
