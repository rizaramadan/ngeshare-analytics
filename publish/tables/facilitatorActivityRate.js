// Publish: facilitator_activity_rate
//
// One row per month. Per-origin counts of active facilitators vs total
// (cumulative through that month). Powers origin-trend charts 5 and 6.
// Source: getFacilitatorActivityRate().

import { getFacilitatorActivityRate } from '../../src/web/queries/metrics.js';

const COLUMNS = [
  'month',
  'total_promoted',
  'total_ngeslow',
  'active_promoted',
  'active_ngeslow',
];

export async function publishFacilitatorActivityRate({
  sourcePool,
  client,
  debug,
}) {
  const rows = await getFacilitatorActivityRate(sourcePool);
  debug(`facilitator_activity_rate: pulled ${rows.length} rows from source`);

  await client.query('TRUNCATE facilitator_activity_rate');

  if (rows.length === 0) return 0;

  const params = [];
  const valuePlaceholders = rows.map((row, i) => {
    const base = i * COLUMNS.length;
    params.push(
      row.month,
      Number(row.total_promoted) || 0,
      Number(row.total_ngeslow) || 0,
      Number(row.active_promoted) || 0,
      Number(row.active_ngeslow) || 0
    );
    return `(${COLUMNS.map((_, c) => `$${base + c + 1}`).join(', ')})`;
  });

  const sql = `
    INSERT INTO facilitator_activity_rate (${COLUMNS.join(', ')})
    VALUES ${valuePlaceholders.join(', ')}
  `;

  await client.query(sql, params);
  return rows.length;
}
