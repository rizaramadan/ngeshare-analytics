// Publish: monthly_groups_by_city
//
// Same shape as monthly_groups_by_province but one row per (month, province,
// city). Powers the city-breakdown drill-down on the map page.
//
// Same end_date computation as the province table: 1 week after last
// attendance, default to start_month if no attendance.

const COLUMNS = [
  'month',
  'province',
  'city',
  'new_groups',
  'cumulative_groups',
  'active_groups',
];

const SOURCE_SQL = `
  WITH group_locations AS (
    SELECT
      hg.id,
      UPPER(TRIM(hg.province)) AS province,
      UPPER(TRIM(hg.city))     AS city,
      DATE_TRUNC('month', COALESCE(hg."startDate", hg."createdAt"))::date AS start_month,
      DATE_TRUNC('month',
        COALESCE(
          (
            SELECT MAX(a."attendedAt") + INTERVAL '7 days'
            FROM "UserHangoutGroupAttendance" a
            WHERE a."hangoutGroupId" = hg.id
          ),
          COALESCE(hg."startDate", hg."createdAt")
        )
      )::date AS end_month
    FROM v_eligible_hangout_groups hg
    WHERE hg.province IS NOT NULL AND TRIM(hg.province) != ''
      AND hg.city     IS NOT NULL AND TRIM(hg.city)     != ''
  ),
  province_cities AS (
    SELECT DISTINCT province, city FROM group_locations
  ),
  bounds AS (
    SELECT MIN(start_month) AS first_m, DATE_TRUNC('month', NOW())::date AS last_m
    FROM group_locations
  ),
  months AS (
    SELECT generate_series(first_m, last_m, '1 month'::interval)::date AS month
    FROM bounds
  ),
  month_pc AS (
    SELECT m.month, pc.province, pc.city
    FROM months m CROSS JOIN province_cities pc
  ),
  new_per_month AS (
    SELECT start_month AS month, province, city, COUNT(*)::int AS new_groups
    FROM group_locations
    GROUP BY 1, 2, 3
  ),
  active_per_month AS (
    SELECT mpc.month, mpc.province, mpc.city, COUNT(gl.id)::int AS active_groups
    FROM month_pc mpc
    LEFT JOIN group_locations gl
      ON gl.province = mpc.province
     AND gl.city     = mpc.city
     AND gl.start_month <= mpc.month
     AND gl.end_month   >= mpc.month
    GROUP BY mpc.month, mpc.province, mpc.city
  )
  SELECT
    mpc.month,
    mpc.province,
    mpc.city,
    COALESCE(npm.new_groups, 0) AS new_groups,
    SUM(COALESCE(npm.new_groups, 0)) OVER (
      PARTITION BY mpc.province, mpc.city ORDER BY mpc.month
    )::int AS cumulative_groups,
    COALESCE(apm.active_groups, 0) AS active_groups
  FROM month_pc mpc
  LEFT JOIN new_per_month npm
    ON npm.month = mpc.month AND npm.province = mpc.province AND npm.city = mpc.city
  LEFT JOIN active_per_month apm
    ON apm.month = mpc.month AND apm.province = mpc.province AND apm.city = mpc.city
  ORDER BY mpc.month, mpc.province, mpc.city
`;

export async function publishMonthlyGroupsByCity({
  sourcePool,
  client,
  debug,
}) {
  const result = await sourcePool.query(SOURCE_SQL);
  const rows = result.rows;
  debug(`monthly_groups_by_city: pulled ${rows.length} rows from source`);

  await client.query('TRUNCATE monthly_groups_by_city');

  if (rows.length === 0) return 0;

  const params = [];
  const valuePlaceholders = rows.map((row, i) => {
    const base = i * COLUMNS.length;
    params.push(
      row.month,
      String(row.province),
      String(row.city),
      Number(row.new_groups) || 0,
      Number(row.cumulative_groups) || 0,
      Number(row.active_groups) || 0
    );
    return `(${COLUMNS.map((_, c) => `$${base + c + 1}`).join(', ')})`;
  });

  const sql = `
    INSERT INTO monthly_groups_by_city (${COLUMNS.join(', ')})
    VALUES ${valuePlaceholders.join(', ')}
  `;

  await client.query(sql, params);
  return rows.length;
}
