// Publish step: reads pre-aggregated data from the local analytics DB
// (heavy SQL output) and writes the results to the published DB (Neon in
// production, a second local Postgres DB during local dev).
//
// Architecture: see misc/move-analysis-to-faster-web.md.
//
// Local dev URL (after running publish/init/setup_published_db.sql):
//   postgresql://analytics_writer:analytics_writer_local_password@localhost:5433/ngeshare_analytics_published

import 'dotenv/config';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDestPool, closePools } from '../src/db/pools.js';
import { publishMonthlyMetrics } from './tables/monthlyMetrics.js';
import { publishFacilitatorRanking } from './tables/facilitatorRanking.js';
import { publishMonthlyMetricsByOrigin } from './tables/monthlyMetricsByOrigin.js';
import { publishMonthlyPromotions } from './tables/monthlyPromotions.js';
import { publishFacilitatorActivityRate } from './tables/facilitatorActivityRate.js';
import { publishMonthlyGroupsByProvince } from './tables/monthlyGroupsByProvince.js';
import { publishMonthlyGroupsByCity } from './tables/monthlyGroupsByCity.js';
import { publishFacilitatorFirstHangoutBuckets } from './tables/facilitatorFirstHangoutBuckets.js';
import { publishFacilitatorRecentActivity } from './tables/facilitatorRecentActivity.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEBUG = process.env.DEBUG === 'true';

const TABLES = [
  { name: 'monthly_metrics', publish: publishMonthlyMetrics },
  { name: 'facilitator_ranking', publish: publishFacilitatorRanking },
  { name: 'monthly_metrics_by_origin', publish: publishMonthlyMetricsByOrigin },
  { name: 'monthly_promotions', publish: publishMonthlyPromotions },
  { name: 'facilitator_activity_rate', publish: publishFacilitatorActivityRate },
  { name: 'monthly_groups_by_province', publish: publishMonthlyGroupsByProvince },
  { name: 'monthly_groups_by_city', publish: publishMonthlyGroupsByCity },
  { name: 'facilitator_first_hangout_buckets', publish: publishFacilitatorFirstHangoutBuckets },
  { name: 'facilitator_recent_activity', publish: publishFacilitatorRecentActivity },
];

function log(...args) {
  console.log(`[publish ${new Date().toISOString()}]`, ...args);
}

function debug(...args) {
  if (DEBUG) console.log(`[publish:debug ${new Date().toISOString()}]`, ...args);
}

function getPublishedPool() {
  const url = process.env.NEON_ANALYTICS_WRITE_URL;
  if (!url) {
    throw new Error(
      'NEON_ANALYTICS_WRITE_URL is required. For local dev, set it to the URL ' +
        'printed by publish/init/setup_published_db.sql.'
    );
  }
  return new pg.Pool({
    connectionString: url,
    max: 4,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  });
}

async function applySchema(publishedPool) {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  const start = Date.now();
  await publishedPool.query(sql);
  log(`schema applied in ${Date.now() - start}ms`);
}

async function publishOneTable(table, sourcePool, publishedPool) {
  const client = await publishedPool.connect();
  const start = Date.now();
  try {
    await client.query('BEGIN');
    const rowCount = await table.publish({ sourcePool, client, debug });
    await client.query('COMMIT');
    log(`✓ ${table.name}: ${rowCount} rows in ${Date.now() - start}ms`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    log(`✗ ${table.name} failed in ${Date.now() - start}ms:`, err.message);
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const totalStart = Date.now();
  const sourcePool = await getDestPool(); // "dest" of sync = "source" for publish
  const publishedPool = getPublishedPool();

  try {
    log('starting publish');
    await applySchema(publishedPool);

    for (const table of TABLES) {
      await publishOneTable(table, sourcePool, publishedPool);
    }

    log(`done in ${Date.now() - totalStart}ms`);
  } finally {
    await publishedPool.end().catch(() => {});
    await closePools().catch(() => {});
  }
}

main().catch((err) => {
  console.error('publish failed:', err);
  process.exit(1);
});
