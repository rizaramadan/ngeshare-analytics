// Mirror already-computed analytics rows from the LOCAL published Postgres
// (`ngeshare_analytics_published`) to the Neon published Postgres.
//
// Use this after `pnpm run publish` has populated the local store. It does
// NOT recompute heavy SQL — it just SELECTs and INSERTs, so it is fast and
// independent of pg server versions.
//
// Per-table tx: BEGIN → TRUNCATE → bulk INSERT → COMMIT. Mirrors the
// transactional pattern in publish/tables/*.js so the dashboard never sees a
// half-written table.
//
// Usage:
//   LOCAL_PUBLISHED_URL='postgresql://analytics_writer:...@localhost:5432/ngeshare_analytics_published' \
//   NEON_PUBLISHED_URL='postgresql://analytics_writer:...@ep-...-pooler.aws.neon.tech/neondb?sslmode=require' \
//   node publish/mirror-to-neon.js

import 'dotenv/config';
import pg from 'pg';

const TABLES = [
  'monthly_metrics',
  'facilitator_ranking',
  'monthly_metrics_by_origin',
  'monthly_promotions',
  'facilitator_activity_rate',
  'monthly_groups_by_province',
  'monthly_groups_by_city',
  'facilitator_first_hangout_buckets',
  'facilitator_recent_activity',
];

const SRC = process.env.LOCAL_PUBLISHED_URL;
const DST = process.env.NEON_PUBLISHED_URL;

if (!SRC || !DST) {
  console.error('LOCAL_PUBLISHED_URL and NEON_PUBLISHED_URL are required.');
  process.exit(1);
}

function log(...a) {
  console.log(`[mirror ${new Date().toISOString()}]`, ...a);
}

function makePool(url, label) {
  return new pg.Pool({
    connectionString: url,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
    application_name: `mirror-to-neon:${label}`,
  });
}

async function getColumns(pool, table) {
  const { rows } = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table]
  );
  return rows.map((r) => r.column_name);
}

async function mirrorTable(srcPool, dstPool, table) {
  const cols = await getColumns(dstPool, table);
  if (cols.length === 0) throw new Error(`destination table public.${table} not found`);
  const colList = cols.map((c) => `"${c}"`).join(', ');

  const { rows } = await srcPool.query(`SELECT ${colList} FROM public.${table}`);

  const client = await dstPool.connect();
  const start = Date.now();
  try {
    await client.query('BEGIN');
    await client.query(`TRUNCATE public.${table}`);

    if (rows.length > 0) {
      // Chunk to stay well under Postgres' 65535 bound parameter limit.
      const CHUNK = Math.max(1, Math.floor(50_000 / cols.length));
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        const params = [];
        const valuePh = slice.map((row, j) => {
          const base = j * cols.length;
          for (const c of cols) params.push(row[c]);
          return `(${cols.map((_, k) => `$${base + k + 1}`).join(', ')})`;
        });
        await client.query(
          `INSERT INTO public.${table} (${colList}) VALUES ${valuePh.join(', ')}`,
          params
        );
      }
    }

    await client.query('COMMIT');
    log(`✓ ${table}: ${rows.length} rows in ${Date.now() - start}ms`);
    return rows.length;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    log(`✗ ${table} failed in ${Date.now() - start}ms:`, err.message);
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const totalStart = Date.now();
  const srcPool = makePool(SRC, 'src');
  const dstPool = makePool(DST, 'dst');

  try {
    log(`mirroring ${TABLES.length} tables`);
    let total = 0;
    for (const t of TABLES) {
      total += await mirrorTable(srcPool, dstPool, t);
    }
    log(`done: ${total} total rows in ${Date.now() - totalStart}ms`);
  } finally {
    await srcPool.end().catch(() => {});
    await dstPool.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error('mirror failed:', err);
  process.exit(1);
});
