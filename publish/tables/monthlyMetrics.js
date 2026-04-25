// Publish: monthly_metrics
//
// Source: getMonthlyMetrics() in src/web/queries/metrics.js, run against the
// local analytics DB. Writes one row per month into the published DB.
// Strategy: full-refresh (TRUNCATE + INSERT) inside the orchestrator's
// transaction. Cheap because monthly row counts are tiny (~24–36 rows).

import { getMonthlyMetrics } from '../../src/web/queries/metrics.js';

const COLUMNS = [
  'month',
  'active_groups',
  'total_meetings',
  'active_members',
  'new_groups',
  'new_members',
  'new_facilitators',
];

export async function publishMonthlyMetrics({ sourcePool, client, debug }) {
  const rows = await getMonthlyMetrics(sourcePool);
  debug(`monthly_metrics: pulled ${rows.length} rows from source`);

  await client.query('TRUNCATE monthly_metrics');

  if (rows.length === 0) return 0;

  const params = [];
  const valuePlaceholders = rows.map((row, i) => {
    const base = i * COLUMNS.length;
    params.push(
      row.month,
      Number(row.active_groups) || 0,
      Number(row.total_meetings) || 0,
      Number(row.active_members) || 0,
      Number(row.new_groups) || 0,
      Number(row.new_members) || 0,
      Number(row.new_facilitators) || 0
    );
    return `(${COLUMNS.map((_, c) => `$${base + c + 1}`).join(', ')})`;
  });

  const sql = `
    INSERT INTO monthly_metrics (${COLUMNS.join(', ')})
    VALUES ${valuePlaceholders.join(', ')}
  `;

  await client.query(sql, params);
  return rows.length;
}
