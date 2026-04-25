// Publish: monthly_promotions
//
// One row per month. New facilitator promotions (members who became
// facilitators that month) + cumulative running total. Powers origin-trend
// chart 7. Source: getPromotionTimeline().

import { getPromotionTimeline } from '../../src/web/queries/metrics.js';

const COLUMNS = ['month', 'new_promoted', 'cumulative_promoted'];

export async function publishMonthlyPromotions({ sourcePool, client, debug }) {
  const rows = await getPromotionTimeline(sourcePool);
  debug(`monthly_promotions: pulled ${rows.length} rows from source`);

  await client.query('TRUNCATE monthly_promotions');

  if (rows.length === 0) return 0;

  const params = [];
  const valuePlaceholders = rows.map((row, i) => {
    const base = i * COLUMNS.length;
    params.push(
      row.month,
      Number(row.new_promoted) || 0,
      Number(row.cumulative_promoted) || 0
    );
    return `(${COLUMNS.map((_, c) => `$${base + c + 1}`).join(', ')})`;
  });

  const sql = `
    INSERT INTO monthly_promotions (${COLUMNS.join(', ')})
    VALUES ${valuePlaceholders.join(', ')}
  `;

  await client.query(sql, params);
  return rows.length;
}
