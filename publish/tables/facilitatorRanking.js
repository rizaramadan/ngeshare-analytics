// Publish: facilitator_ranking
//
// Source: getFacilitatorRanking() in src/web/queries/facilitatorRanking.js,
// run against the local analytics DB. Writes one row per facilitator into the
// published DB, with `rank` materialized from the source row order (the query
// is `ORDER BY total_score DESC`).
//
// Strategy: full-refresh (TRUNCATE + INSERT). The source query is heavy (~26KB
// of SQL) so we run it once per publish.

import { getFacilitatorRanking } from '../../src/web/queries/facilitatorRanking.js';

const SOURCE_LIMIT = 10000;

const COLUMNS = [
  'facilitator_id',
  'rank',
  'email',
  'name',
  'groups_facilitated',
  'alumni_converted',
  'alumni_points',
  'own_members',
  'descendant_members',
  'member_points',
  'total_score',
];

export async function publishFacilitatorRanking({ sourcePool, client, debug }) {
  const rows = await getFacilitatorRanking(sourcePool, SOURCE_LIMIT);
  debug(`facilitator_ranking: pulled ${rows.length} rows from source`);

  await client.query('TRUNCATE facilitator_ranking');

  if (rows.length === 0) return 0;

  const params = [];
  const valuePlaceholders = rows.map((row, i) => {
    const base = i * COLUMNS.length;
    params.push(
      row.facilitator_id,
      i + 1,
      row.email ?? null,
      row.name ?? '',
      Number(row.groups_facilitated) || 0,
      Number(row.alumni_converted) || 0,
      Number(row.alumni_points) || 0,
      Number(row.own_members) || 0,
      Number(row.descendant_members) || 0,
      Number(row.member_points) || 0,
      Number(row.total_score) || 0
    );
    return `(${COLUMNS.map((_, c) => `$${base + c + 1}`).join(', ')})`;
  });

  const sql = `
    INSERT INTO facilitator_ranking (${COLUMNS.join(', ')})
    VALUES ${valuePlaceholders.join(', ')}
  `;

  await client.query(sql, params);
  return rows.length;
}
