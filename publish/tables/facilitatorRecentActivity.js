// Publish: facilitator_recent_activity
//
// Among the activated facilitators (those who reached episode 2), classify
// them by whether they've had any attendance event in the last 21 days:
//   still_active — last attendance within 21 days
//   dormant      — last attendance > 21 days ago
//
// Split by is_alumni. "Activated" is the same definition as in
// facilitator_first_hangout_buckets (reached episode 2).

const COLUMNS = ['recent_status', 'is_alumni', 'facilitator_count'];

const SOURCE_SQL = `
  WITH facilitator_starts AS (
    SELECT
      "userId" AS facilitator_id,
      MIN("joinedAt") AS first_facilitator_date
    FROM "UserHangoutGroup"
    WHERE "hangoutGroupRole" = 'FACILITATOR'
    GROUP BY "userId"
  ),
  activated AS (
    -- Reached episode 2 at some point
    SELECT DISTINCT fs.facilitator_id
    FROM facilitator_starts fs
    JOIN "UserHangoutGroup" uhg
      ON uhg."userId" = fs.facilitator_id
     AND uhg."hangoutGroupRole" = 'FACILITATOR'
    JOIN "UserHangoutGroupAttendance" a
      ON a."hangoutGroupId" = uhg."hangoutGroupId"
     AND a."attendedAt" >= fs.first_facilitator_date
    JOIN "HangoutEpisode" he
      ON he.id = a."hangoutEpisodeId"
     AND he."order" = 2
  ),
  last_attendance AS (
    SELECT
      fs.facilitator_id,
      MAX(a."attendedAt") AS last_attendance_date
    FROM facilitator_starts fs
    JOIN "UserHangoutGroup" uhg
      ON uhg."userId" = fs.facilitator_id
     AND uhg."hangoutGroupRole" = 'FACILITATOR'
    JOIN "UserHangoutGroupAttendance" a
      ON a."hangoutGroupId" = uhg."hangoutGroupId"
    GROUP BY fs.facilitator_id
  ),
  classified AS (
    SELECT
      COALESCE(vfs.is_alumni, FALSE) AS is_alumni,
      CASE
        WHEN la.last_attendance_date >= NOW() - INTERVAL '21 days'
          THEN 'still_active'
        ELSE 'dormant'
      END AS recent_status
    FROM activated act
    LEFT JOIN last_attendance la ON la.facilitator_id = act.facilitator_id
    LEFT JOIN v_facilitator_stats vfs ON vfs.facilitator_id = act.facilitator_id
  )
  SELECT recent_status, is_alumni, COUNT(*)::int AS facilitator_count
  FROM classified
  GROUP BY recent_status, is_alumni
  ORDER BY recent_status, is_alumni DESC
`;

export async function publishFacilitatorRecentActivity({
  sourcePool,
  client,
  debug,
}) {
  const result = await sourcePool.query(SOURCE_SQL);
  const rows = result.rows;
  debug(`facilitator_recent_activity: pulled ${rows.length} rows`);

  await client.query('TRUNCATE facilitator_recent_activity');

  if (rows.length === 0) return 0;

  const params = [];
  const valuePlaceholders = rows.map((row, i) => {
    const base = i * COLUMNS.length;
    params.push(
      String(row.recent_status),
      Boolean(row.is_alumni),
      Number(row.facilitator_count) || 0
    );
    return `(${COLUMNS.map((_, c) => `$${base + c + 1}`).join(', ')})`;
  });

  const sql = `
    INSERT INTO facilitator_recent_activity (${COLUMNS.join(', ')})
    VALUES ${valuePlaceholders.join(', ')}
  `;

  await client.query(sql, params);
  return rows.length;
}
