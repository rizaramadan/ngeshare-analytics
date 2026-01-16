// Dashboard metrics queries

export async function getDashboardMetrics(pool, dateFrom = null, dateTo = null) {
  // If no date range provided, use existing view
  if (!dateFrom && !dateTo) {
    const result = await pool.query('SELECT * FROM v_dashboard_metrics');
    return result.rows[0];
  }

  // Date-filtered metrics based on last meeting date
  const result = await pool.query(`
    WITH filtered_groups AS (
      SELECT
        gs.*,
        gp.last_meeting_date
      FROM v_group_status gs
      LEFT JOIN v_group_progress gp ON gs.group_id = gp.group_id
      WHERE ($1::timestamp IS NULL OR gp.last_meeting_date >= $1::timestamp)
        AND ($2::timestamp IS NULL OR gp.last_meeting_date <= $2::timestamp)
    )
    SELECT
      (SELECT COUNT(*) FROM filtered_groups WHERE computed_status = 'ACTIVE') AS active_groups,
      (SELECT COUNT(*) FROM filtered_groups WHERE computed_status = 'GRADUATED') AS graduated_groups,
      (SELECT COUNT(*) FROM filtered_groups WHERE computed_status = 'STALLED') AS stalled_groups,
      (SELECT COUNT(*) FROM filtered_groups) AS total_groups,
      (SELECT COUNT(DISTINCT facilitator_id) FROM filtered_groups WHERE facilitator_id IS NOT NULL) AS total_facilitators,
      (SELECT COUNT(DISTINCT f.facilitator_id)
       FROM filtered_groups fg
       JOIN v_facilitator_stats f ON fg.facilitator_id = f.facilitator_id
       WHERE f.is_alumni = TRUE) AS alumni_facilitators,
      (SELECT COUNT(DISTINCT uhg."userId")
       FROM "UserHangoutGroup" uhg
       WHERE uhg."hangoutGroupRole" = 'MEMBER'
         AND uhg."userId" IS NOT NULL
         AND uhg."hangoutGroupId" IN (SELECT group_id FROM filtered_groups)) AS total_members
  `, [dateFrom, dateTo]);

  return result.rows[0];
}

export async function getCurriculumFunnel(pool, dateFrom = null, dateTo = null) {
  // If no date range, use existing view
  if (!dateFrom && !dateTo) {
    const result = await pool.query(`
      SELECT course_name, sequence_order, computed_status, group_count
      FROM v_curriculum_funnel
      ORDER BY sequence_order, computed_status
    `);
    return result.rows;
  }

  // Date-filtered funnel
  const result = await pool.query(`
    WITH filtered_groups AS (
      SELECT
        gs.*,
        gp.last_meeting_date
      FROM v_group_status gs
      LEFT JOIN v_group_progress gp ON gs.group_id = gp.group_id
      WHERE ($1::timestamp IS NULL OR gp.last_meeting_date >= $1::timestamp)
        AND ($2::timestamp IS NULL OR gp.last_meeting_date <= $2::timestamp)
    )
    SELECT
      course_name,
      sequence_order,
      computed_status,
      COUNT(*) AS group_count
    FROM filtered_groups
    WHERE course_name IS NOT NULL
    GROUP BY course_name, sequence_order, computed_status
    ORDER BY sequence_order, computed_status
  `, [dateFrom, dateTo]);

  return result.rows;
}

export async function getFacilitatorStats(pool, dateFrom = null, dateTo = null) {
  // If no date range, use existing view
  if (!dateFrom && !dateTo) {
    const result = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE is_alumni = TRUE) AS alumni,
        ROUND(COUNT(*) FILTER (WHERE is_alumni = TRUE)::NUMERIC / COUNT(*) * 100, 1) AS alumni_pct
      FROM v_facilitator_stats
    `);
    return result.rows[0];
  }

  // Date-filtered facilitators
  const result = await pool.query(`
    WITH filtered_groups AS (
      SELECT
        gs.group_id,
        gs.facilitator_id,
        gp.last_meeting_date
      FROM v_group_status gs
      LEFT JOIN v_group_progress gp ON gs.group_id = gp.group_id
      WHERE ($1::timestamp IS NULL OR gp.last_meeting_date >= $1::timestamp)
        AND ($2::timestamp IS NULL OR gp.last_meeting_date <= $2::timestamp)
    ),
    filtered_facilitators AS (
      SELECT DISTINCT f.*
      FROM v_facilitator_stats f
      WHERE f.facilitator_id IN (SELECT facilitator_id FROM filtered_groups WHERE facilitator_id IS NOT NULL)
    )
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE is_alumni = TRUE) AS alumni,
      ROUND(COUNT(*) FILTER (WHERE is_alumni = TRUE)::NUMERIC / COUNT(*) * 100, 1) AS alumni_pct
    FROM filtered_facilitators
  `, [dateFrom, dateTo]);

  return result.rows[0];
}

// Monthly breakdown metrics
export async function getMonthlyMetrics(pool, dateFrom = null, dateTo = null) {
  const result = await pool.query(`
    WITH date_range AS (
      SELECT
        COALESCE($1::timestamp, MIN("attendedAt")) AS start_date,
        COALESCE($2::timestamp, MAX("attendedAt")) AS end_date
      FROM "UserHangoutGroupAttendance"
    ),
    monthly_meetings AS (
      SELECT
        DATE_TRUNC('month', a."attendedAt") AS month,
        COUNT(DISTINCT a."hangoutGroupId") AS active_groups,
        COUNT(DISTINCT a."attendedAt"::date) AS total_meetings,
        COUNT(DISTINCT a."userId") AS active_members
      FROM "UserHangoutGroupAttendance" a
      CROSS JOIN date_range dr
      WHERE a."attendedAt" >= dr.start_date
        AND a."attendedAt" <= dr.end_date
      GROUP BY DATE_TRUNC('month', a."attendedAt")
    ),
    monthly_new_groups AS (
      SELECT
        DATE_TRUNC('month', hg."createdAt") AS month,
        COUNT(*) AS new_groups
      FROM "HangoutGroup" hg
      CROSS JOIN date_range dr
      WHERE hg."createdAt" >= dr.start_date
        AND hg."createdAt" <= dr.end_date
      GROUP BY DATE_TRUNC('month', hg."createdAt")
    ),
    monthly_new_members AS (
      SELECT
        DATE_TRUNC('month', uhg."joinedAt") AS month,
        COUNT(*) FILTER (WHERE uhg."hangoutGroupRole" = 'MEMBER') AS new_members,
        COUNT(*) FILTER (WHERE uhg."hangoutGroupRole" = 'FACILITATOR') AS new_facilitators
      FROM "UserHangoutGroup" uhg
      CROSS JOIN date_range dr
      WHERE uhg."joinedAt" >= dr.start_date
        AND uhg."joinedAt" <= dr.end_date
        AND uhg."userId" IS NOT NULL
      GROUP BY DATE_TRUNC('month', uhg."joinedAt")
    )
    SELECT
      COALESCE(mm.month, ng.month, nm.month) AS month,
      COALESCE(mm.active_groups, 0) AS active_groups,
      COALESCE(mm.total_meetings, 0) AS total_meetings,
      COALESCE(mm.active_members, 0) AS active_members,
      COALESCE(ng.new_groups, 0) AS new_groups,
      COALESCE(nm.new_members, 0) AS new_members,
      COALESCE(nm.new_facilitators, 0) AS new_facilitators
    FROM monthly_meetings mm
    FULL OUTER JOIN monthly_new_groups ng ON mm.month = ng.month
    FULL OUTER JOIN monthly_new_members nm ON COALESCE(mm.month, ng.month) = nm.month
    ORDER BY month ASC
  `, [dateFrom, dateTo]);

  return result.rows;
}
