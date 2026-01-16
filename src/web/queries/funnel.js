// Funnel-specific queries for conversion analysis

/**
 * Get stage-by-stage funnel metrics with totals
 * Returns count of groups at each stage (any status)
 */
export async function getFunnelStages(pool, dateFrom = null, dateTo = null) {
  const result = await pool.query(`
    WITH filtered_groups AS (
      SELECT
        gs.*,
        gp.last_meeting_date
      FROM v_group_status gs
      LEFT JOIN v_group_progress gp ON gs.group_id = gp.group_id
      WHERE ($1::timestamp IS NULL OR gp.last_meeting_date >= $1::timestamp)
        AND ($2::timestamp IS NULL OR gp.last_meeting_date <= $2::timestamp)
        AND gs.course_name IS NOT NULL
    )
    SELECT
      course_name,
      sequence_order,
      COUNT(*) AS total_groups,
      COUNT(*) FILTER (WHERE computed_status = 'ACTIVE') AS active_count,
      COUNT(*) FILTER (WHERE computed_status = 'GRADUATED') AS graduated_count,
      COUNT(*) FILTER (WHERE computed_status = 'STALLED') AS stalled_count,
      ROUND(AVG(progress_pct), 1) AS avg_progress_pct
    FROM filtered_groups
    GROUP BY course_name, sequence_order
    ORDER BY sequence_order
  `, [dateFrom, dateTo]);

  return result.rows;
}

/**
 * Calculate conversion rates between stages
 * Shows what % of groups from stage N progressed to stage N+1
 */
export async function getFunnelConversions(pool, dateFrom = null, dateTo = null) {
  const result = await pool.query(`
    WITH filtered_groups AS (
      SELECT
        gs.group_id,
        gs.course_name,
        gs.sequence_order,
        gs.facilitator_id,
        gp.last_meeting_date
      FROM v_group_status gs
      LEFT JOIN v_group_progress gp ON gs.group_id = gp.group_id
      WHERE ($1::timestamp IS NULL OR gp.last_meeting_date >= $1::timestamp)
        AND ($2::timestamp IS NULL OR gp.last_meeting_date <= $2::timestamp)
        AND gs.course_name IS NOT NULL
    ),
    -- Count groups at each stage
    stage_counts AS (
      SELECT
        sequence_order,
        course_name,
        COUNT(*) AS groups_at_stage
      FROM filtered_groups
      GROUP BY sequence_order, course_name
    ),
    -- Count facilitators who progressed to next stage
    -- A facilitator "converted" if they facilitated groups in consecutive stages
    conversions AS (
      SELECT
        curr.sequence_order,
        curr.course_name,
        COUNT(DISTINCT curr.facilitator_id) AS facilitators_current,
        COUNT(DISTINCT next.facilitator_id) AS facilitators_progressed
      FROM filtered_groups curr
      LEFT JOIN filtered_groups next
        ON curr.facilitator_id = next.facilitator_id
        AND next.sequence_order = curr.sequence_order + 1
      WHERE curr.facilitator_id IS NOT NULL
      GROUP BY curr.sequence_order, curr.course_name
    )
    SELECT
      sc.sequence_order,
      sc.course_name,
      sc.groups_at_stage,
      COALESCE(c.facilitators_current, 0) AS facilitators_at_stage,
      COALESCE(c.facilitators_progressed, 0) AS facilitators_progressed,
      CASE
        WHEN COALESCE(c.facilitators_current, 0) > 0
        THEN ROUND((c.facilitators_progressed::NUMERIC / c.facilitators_current) * 100, 1)
        ELSE 0
      END AS conversion_rate_pct
    FROM stage_counts sc
    LEFT JOIN conversions c ON sc.sequence_order = c.sequence_order
    ORDER BY sc.sequence_order
  `, [dateFrom, dateTo]);

  return result.rows;
}

/**
 * Get time-based progression metrics
 * Shows average time groups take at each stage before progressing
 */
export async function getFunnelTimeline(pool, dateFrom = null, dateTo = null) {
  const result = await pool.query(`
    WITH filtered_groups AS (
      SELECT
        hg.id AS group_id,
        hg."createdAt" AS created_at,
        h.name AS course_name,
        cc.sequence_order,
        gp.last_meeting_date,
        gp.total_meetings,
        gp.max_episode_reached,
        cc.max_episodes,
        gs.computed_status
      FROM "HangoutGroup" hg
      LEFT JOIN "Hangout" h ON hg."hangoutId" = h.id
      LEFT JOIN course_config cc ON h.name = cc.course_name
      LEFT JOIN v_group_progress gp ON hg.id = gp.group_id
      LEFT JOIN v_group_status gs ON hg.id = gs.group_id
      WHERE ($1::timestamp IS NULL OR gp.last_meeting_date >= $1::timestamp)
        AND ($2::timestamp IS NULL OR gp.last_meeting_date <= $2::timestamp)
        AND h.name IS NOT NULL
    ),
    stage_duration AS (
      SELECT
        sequence_order,
        course_name,
        -- Average days from creation to last meeting
        ROUND(AVG(EXTRACT(EPOCH FROM (last_meeting_date - created_at)) / 86400)::NUMERIC, 1) AS avg_days_active,
        -- Average number of meetings
        ROUND(AVG(total_meetings), 1) AS avg_meetings,
        -- Average completion rate
        ROUND(AVG(CASE WHEN max_episodes > 0 THEN (max_episode_reached::NUMERIC / max_episodes) * 100 ELSE 0 END), 1) AS avg_completion_pct,
        COUNT(*) AS group_count
      FROM filtered_groups
      WHERE last_meeting_date IS NOT NULL
      GROUP BY sequence_order, course_name
    )
    SELECT
      sequence_order,
      course_name,
      COALESCE(avg_days_active, 0) AS avg_days_active,
      COALESCE(avg_meetings, 0) AS avg_meetings,
      COALESCE(avg_completion_pct, 0) AS avg_completion_pct,
      group_count
    FROM stage_duration
    ORDER BY sequence_order
  `, [dateFrom, dateTo]);

  return result.rows;
}

/**
 * Get drop-off analysis
 * Shows where groups typically stall or stop progressing
 */
export async function getFunnelDropoff(pool, dateFrom = null, dateTo = null) {
  const result = await pool.query(`
    WITH filtered_groups AS (
      SELECT
        gs.*,
        gp.last_meeting_date,
        gp.max_episode_reached
      FROM v_group_status gs
      LEFT JOIN v_group_progress gp ON gs.group_id = gp.group_id
      WHERE ($1::timestamp IS NULL OR gp.last_meeting_date >= $1::timestamp)
        AND ($2::timestamp IS NULL OR gp.last_meeting_date <= $2::timestamp)
        AND gs.course_name IS NOT NULL
    ),
    dropoff_by_stage AS (
      SELECT
        sequence_order,
        course_name,
        COUNT(*) AS total_groups,
        COUNT(*) FILTER (WHERE computed_status = 'STALLED') AS stalled_groups,
        ROUND((COUNT(*) FILTER (WHERE computed_status = 'STALLED')::NUMERIC / COUNT(*)) * 100, 1) AS stalled_pct,
        -- Average episode reached for stalled groups
        ROUND(AVG(max_episode_reached) FILTER (WHERE computed_status = 'STALLED'), 1) AS avg_stall_episode,
        max_episodes
      FROM filtered_groups
      GROUP BY sequence_order, course_name, max_episodes
    )
    SELECT
      sequence_order,
      course_name,
      total_groups,
      stalled_groups,
      COALESCE(stalled_pct, 0) AS stalled_pct,
      COALESCE(avg_stall_episode, 0) AS avg_stall_episode,
      max_episodes,
      -- Calculate at what % of the course groups typically stall
      CASE
        WHEN max_episodes > 0 AND avg_stall_episode > 0
        THEN ROUND((avg_stall_episode / max_episodes) * 100, 1)
        ELSE 0
      END AS stall_progress_pct
    FROM dropoff_by_stage
    ORDER BY sequence_order
  `, [dateFrom, dateTo]);

  return result.rows;
}

/**
 * Get overall funnel health metrics
 * Summary statistics for the entire funnel
 */
export async function getFunnelHealth(pool, dateFrom = null, dateTo = null) {
  const result = await pool.query(`
    WITH filtered_groups AS (
      SELECT
        gs.*,
        gp.last_meeting_date
      FROM v_group_status gs
      LEFT JOIN v_group_progress gp ON gs.group_id = gp.group_id
      WHERE ($1::timestamp IS NULL OR gp.last_meeting_date >= $1::timestamp)
        AND ($2::timestamp IS NULL OR gp.last_meeting_date <= $2::timestamp)
        AND gs.course_name IS NOT NULL
    ),
    stage_1_groups AS (
      SELECT COUNT(*) AS count FROM filtered_groups WHERE sequence_order = 1
    ),
    stage_4_groups AS (
      SELECT COUNT(*) AS count FROM filtered_groups WHERE sequence_order = 4
    ),
    graduated_stage_4 AS (
      SELECT COUNT(*) AS count FROM filtered_groups
      WHERE sequence_order = 4 AND computed_status = 'GRADUATED'
    ),
    facilitators_multi_stage AS (
      SELECT COUNT(DISTINCT facilitator_id) AS count
      FROM filtered_groups
      WHERE facilitator_id IS NOT NULL
      GROUP BY facilitator_id
      HAVING COUNT(DISTINCT sequence_order) > 1
    )
    SELECT
      (SELECT count FROM stage_1_groups) AS total_started,
      (SELECT count FROM stage_4_groups) AS reached_final_stage,
      (SELECT count FROM graduated_stage_4) AS completed_program,
      -- Overall completion rate (graduated from stage 4 / started at stage 1)
      CASE
        WHEN (SELECT count FROM stage_1_groups) > 0
        THEN ROUND(((SELECT count FROM graduated_stage_4)::NUMERIC / (SELECT count FROM stage_1_groups)) * 100, 1)
        ELSE 0
      END AS completion_rate_pct,
      -- Retention rate (reached stage 4 / started at stage 1)
      CASE
        WHEN (SELECT count FROM stage_1_groups) > 0
        THEN ROUND(((SELECT count FROM stage_4_groups)::NUMERIC / (SELECT count FROM stage_1_groups)) * 100, 1)
        ELSE 0
      END AS retention_rate_pct,
      -- Facilitator progression rate
      (SELECT COUNT(*) FROM facilitators_multi_stage) AS facilitators_progressed,
      (SELECT COUNT(DISTINCT facilitator_id) FROM filtered_groups WHERE facilitator_id IS NOT NULL) AS total_facilitators,
      CASE
        WHEN (SELECT COUNT(DISTINCT facilitator_id) FROM filtered_groups WHERE facilitator_id IS NOT NULL) > 0
        THEN ROUND(((SELECT COUNT(*) FROM facilitators_multi_stage)::NUMERIC /
                    (SELECT COUNT(DISTINCT facilitator_id) FROM filtered_groups WHERE facilitator_id IS NOT NULL)) * 100, 1)
        ELSE 0
      END AS facilitator_progression_pct
  `, [dateFrom, dateTo]);

  return result.rows[0];
}
