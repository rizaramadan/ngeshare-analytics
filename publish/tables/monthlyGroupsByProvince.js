// Publish: monthly_groups_by_province
//
// One row per (month, province) with three counts:
//   new_groups        — created in that month
//   cumulative_groups — created on or before that month (running total)
//   active_groups     — start_month ≤ M and end_month ≥ M (group was alive in M)
//
// HangoutGroup.endDate is never populated in source data, so end_date is
// COMPUTED here: 1 week after the group's last recorded attendance. Groups
// with no attendance default to ending on their own start month.
//
// Powers the analytics Indonesia map page with month slider + 3-mode toggle
// (cumulative / new / active).

const COLUMNS = ['month', 'province', 'new_groups', 'cumulative_groups', 'active_groups'];

const SOURCE_SQL = `
  WITH group_locations AS (
    SELECT
      hg.id,
      UPPER(TRIM(hg.province)) AS province,
      DATE_TRUNC('month', COALESCE(hg."startDate", hg."createdAt"))::date AS start_month,
      -- end_month: 1 week after last attendance (computed locally because
      -- HangoutGroup.endDate is always NULL in source data). Groups with no
      -- attendance use their start month (treated as immediately ended).
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
  ),
  provinces AS (
    SELECT DISTINCT province FROM group_locations
  ),
  bounds AS (
    SELECT MIN(start_month) AS first_m, DATE_TRUNC('month', NOW())::date AS last_m
    FROM group_locations
  ),
  months AS (
    SELECT generate_series(first_m, last_m, '1 month'::interval)::date AS month
    FROM bounds
  ),
  month_province AS (
    SELECT m.month, p.province FROM months m CROSS JOIN provinces p
  ),
  new_per_month AS (
    SELECT start_month AS month, province, COUNT(*)::int AS new_groups
    FROM group_locations
    GROUP BY 1, 2
  ),
  active_per_month AS (
    SELECT mp.month, mp.province, COUNT(gl.id)::int AS active_groups
    FROM month_province mp
    LEFT JOIN group_locations gl
      ON gl.province = mp.province
     AND gl.start_month <= mp.month
     AND gl.end_month   >= mp.month
    GROUP BY mp.month, mp.province
  )
  SELECT
    mp.month,
    mp.province,
    COALESCE(npm.new_groups, 0) AS new_groups,
    SUM(COALESCE(npm.new_groups, 0)) OVER (
      PARTITION BY mp.province ORDER BY mp.month
    )::int AS cumulative_groups,
    COALESCE(apm.active_groups, 0) AS active_groups
  FROM month_province mp
  LEFT JOIN new_per_month npm    ON npm.month = mp.month AND npm.province = mp.province
  LEFT JOIN active_per_month apm ON apm.month = mp.month AND apm.province = mp.province
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

  const params = [];
  const valuePlaceholders = rows.map((row, i) => {
    const base = i * COLUMNS.length;
    params.push(
      row.month,
      String(row.province),
      Number(row.new_groups) || 0,
      Number(row.cumulative_groups) || 0,
      Number(row.active_groups) || 0
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
