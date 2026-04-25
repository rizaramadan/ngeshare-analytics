// Publish: monthly_metrics_by_origin
//
// One row per (month, is_alumni). Source: getMonthlyMetricsByOrigin().
// Powers origin-trend charts 1–4.

import { getMonthlyMetricsByOrigin } from '../../src/web/queries/metrics.js';

const COLUMNS = [
  'month',
  'is_alumni',
  'active_groups',
  'active_members',
  'active_facilitators',
];

export async function publishMonthlyMetricsByOrigin({
  sourcePool,
  client,
  debug,
}) {
  const rows = await getMonthlyMetricsByOrigin(sourcePool);
  debug(`monthly_metrics_by_origin: pulled ${rows.length} rows from source`);

  await client.query('TRUNCATE monthly_metrics_by_origin');

  if (rows.length === 0) return 0;

  const params = [];
  const valuePlaceholders = rows.map((row, i) => {
    const base = i * COLUMNS.length;
    params.push(
      row.month,
      Boolean(row.is_alumni),
      Number(row.active_groups) || 0,
      Number(row.active_members) || 0,
      Number(row.active_facilitators) || 0
    );
    return `(${COLUMNS.map((_, c) => `$${base + c + 1}`).join(', ')})`;
  });

  const sql = `
    INSERT INTO monthly_metrics_by_origin (${COLUMNS.join(', ')})
    VALUES ${valuePlaceholders.join(', ')}
  `;

  await client.query(sql, params);
  return rows.length;
}
