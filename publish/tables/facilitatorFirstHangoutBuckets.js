// Publish: facilitator_first_hangout_buckets
//
// For every person who has become a facilitator, classify them by how long
// it took to reach their first EPISODE 2 attendance. Output: count per
// (bucket, is_alumni).
//
// Why episode 2 (not episode 1): episode 1 is typically a kickoff/intro
// session that happens the same day the group is set up. Episode 2 is
// the first "real" curriculum session and a much better signal of actual
// activation. Groups that did episode 1 but never reached episode 2 show
// up as "not yet started" — the real drop-off signal.
//
// Bucket boundaries:
//   first_month         (0–30 days)
//   one_to_three_months (31–90 days)
//   three_to_six_months (91–180 days)
//   beyond_six_months   (181+ days)
//   not_yet_started     (never reached episode 2)

const COLUMNS = ['bucket', 'is_alumni', 'facilitator_count'];

const SOURCE_SQL = `
  WITH facilitator_starts AS (
    SELECT
      "userId" AS facilitator_id,
      MIN("joinedAt") AS first_facilitator_date
    FROM "UserHangoutGroup"
    WHERE "hangoutGroupRole" = 'FACILITATOR'
    GROUP BY "userId"
  ),
  first_hangouts AS (
    -- First EPISODE 2 attendance in any group this facilitator facilitates,
    -- restricted to attendances on/after they became a facilitator (so a
    -- member who later becomes a facilitator doesn't get credited for
    -- hangouts that happened before they were promoted).
    SELECT
      fs.facilitator_id,
      MIN(a."attendedAt") AS first_hangout_date
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
    GROUP BY fs.facilitator_id
  ),
  classified AS (
    SELECT
      fs.facilitator_id,
      COALESCE(vfs.is_alumni, FALSE) AS is_alumni,
      CASE
        WHEN fh.first_hangout_date IS NULL THEN 'not_yet_started'
        WHEN (fh.first_hangout_date - fs.first_facilitator_date) <= INTERVAL '30 days'
          THEN 'first_month'
        WHEN (fh.first_hangout_date - fs.first_facilitator_date) <= INTERVAL '90 days'
          THEN 'one_to_three_months'
        WHEN (fh.first_hangout_date - fs.first_facilitator_date) <= INTERVAL '180 days'
          THEN 'three_to_six_months'
        ELSE 'beyond_six_months'
      END AS bucket
    FROM facilitator_starts fs
    LEFT JOIN first_hangouts fh ON fh.facilitator_id = fs.facilitator_id
    LEFT JOIN v_facilitator_stats vfs ON vfs.facilitator_id = fs.facilitator_id
  )
  SELECT bucket, is_alumni, COUNT(*)::int AS facilitator_count
  FROM classified
  GROUP BY bucket, is_alumni
  ORDER BY bucket, is_alumni DESC
`;

export async function publishFacilitatorFirstHangoutBuckets({
  sourcePool,
  client,
  debug,
}) {
  const result = await sourcePool.query(SOURCE_SQL);
  const rows = result.rows;
  debug(`facilitator_first_hangout_buckets: pulled ${rows.length} rows`);

  await client.query('TRUNCATE facilitator_first_hangout_buckets');

  if (rows.length === 0) return 0;

  const params = [];
  const valuePlaceholders = rows.map((row, i) => {
    const base = i * COLUMNS.length;
    params.push(
      String(row.bucket),
      Boolean(row.is_alumni),
      Number(row.facilitator_count) || 0
    );
    return `(${COLUMNS.map((_, c) => `$${base + c + 1}`).join(', ')})`;
  });

  const sql = `
    INSERT INTO facilitator_first_hangout_buckets (${COLUMNS.join(', ')})
    VALUES ${valuePlaceholders.join(', ')}
  `;

  await client.query(sql, params);
  return rows.length;
}
