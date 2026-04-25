// Publish: monthly_groups_by_province
//
// One row per (month, province): new_groups (created that month) and
// cumulative_groups (created on or before that month). Powers the
// Indonesia map page with a month slider.
//
// Source: HangoutGroup table directly. Province normalized to UPPERCASE.
// Uses COALESCE(startDate, createdAt) since 6% of rows have NULL startDate.

const COLUMNS = ['month', 'province', 'new_groups', 'cumulative_groups'];

const SOURCE_SQL = `
  WITH provinces AS (
    SELECT DISTINCT UPPER(TRIM(province)) AS province
    FROM "HangoutGroup"
    WHERE province IS NOT NULL AND TRIM(province) != ''
  ),
  bounds AS (
    SELECT
      DATE_TRUNC('month', MIN(COALESCE("startDate", "createdAt")))::date AS first_month,
      DATE_TRUNC('month', NOW())::date AS last_month
    FROM "HangoutGroup"
    WHERE province IS NOT NULL AND TRIM(province) != ''
  ),
  months AS (
    SELECT generate_series(first_month, last_month, '1 month'::interval)::date AS month
    FROM bounds
  ),
  month_province AS (
    SELECT m.month, p.province
    FROM months m CROSS JOIN provinces p
  ),
  new_per_month AS (
    SELECT
      DATE_TRUNC('month', COALESCE("startDate", "createdAt"))::date AS month,
      UPPER(TRIM(province)) AS province,
      COUNT(*)::int AS new_groups
    FROM "HangoutGroup"
    WHERE province IS NOT NULL AND TRIM(province) != ''
    GROUP BY 1, 2
  )
  SELECT
    mp.month,
    mp.province,
    COALESCE(npm.new_groups, 0) AS new_groups,
    SUM(COALESCE(npm.new_groups, 0)) OVER (
      PARTITION BY mp.province ORDER BY mp.month
    )::int AS cumulative_groups
  FROM month_province mp
  LEFT JOIN new_per_month npm
    ON npm.month = mp.month AND npm.province = mp.province
  ORDER BY mp.month, mp.province
`;

export async function publishMonthlyGroupsByProvince({
  sourcePool,
  client,
  debug,
}) {
  const result = await sourcePool.query(SOURCE_SQL);
  const rows = result.rows;
  debug(`monthly_groups_by_province: pulled ${rows.length} rows from source`);

  await client.query('TRUNCATE monthly_groups_by_province');

  if (rows.length === 0) return 0;

  // Postgres has a parameter limit (~65k); chunk if rows × 4 cols approaches it.
  // 30 months × 30 provinces × 4 cols = ~3600 params, well under.
  const params = [];
  const valuePlaceholders = rows.map((row, i) => {
    const base = i * COLUMNS.length;
    params.push(
      row.month,
      String(row.province),
      Number(row.new_groups) || 0,
      Number(row.cumulative_groups) || 0
    );
    return `(${COLUMNS.map((_, c) => `$${base + c + 1}`).join(', ')})`;
  });

  const sql = `
    INSERT INTO monthly_groups_by_province (${COLUMNS.join(', ')})
    VALUES ${valuePlaceholders.join(', ')}
  `;

  await client.query(sql, params);
  return rows.length;
}
