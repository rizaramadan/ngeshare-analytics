/**
 * Get member flow data for Sankey diagram
 * Tracks individual members' progression through curriculum stages
 */
export async function getMemberFlow(pool, dateFrom = null, dateTo = null) {
  const query = `
    WITH member_courses AS (
      -- Get all courses each member participated in (MEMBER role only)
      SELECT DISTINCT
        uhg."userId",
        uhg."userEmail",
        h.name AS course_name,
        cc.sequence_order,
        cc.max_episodes,
        uhg."joinedAt",
        uhg."hangoutGroupId"
      FROM "UserHangoutGroup" uhg
      JOIN "HangoutGroup" hg ON uhg."hangoutGroupId" = hg.id
      JOIN "Hangout" h ON hg."hangoutId" = h.id
      JOIN course_config cc ON h.name = cc.course_name
      WHERE uhg."hangoutGroupRole" = 'MEMBER'
        AND uhg."userId" IS NOT NULL
        ${dateFrom ? "AND uhg.\"joinedAt\" >= $1" : ""}
        ${dateTo ? (dateFrom ? "AND uhg.\"joinedAt\" <= $2" : "AND uhg.\"joinedAt\" <= $1") : ""}
    ),
    member_progress AS (
      -- For each member, get their max attendance per course
      SELECT
        mc."userId",
        mc."userEmail",
        mc.course_name,
        mc.sequence_order,
        mc.max_episodes,
        mc."joinedAt",
        COALESCE(MAX(he."order"), 0) AS max_episode_reached,
        MAX(att."attendedAt") AS last_attendance
      FROM member_courses mc
      LEFT JOIN "UserHangoutGroupAttendance" att
        ON att."userId" = mc."userId"
        AND att."hangoutGroupId" = mc."hangoutGroupId"
      LEFT JOIN "HangoutEpisode" he ON att."hangoutEpisodeId" = he.id
      GROUP BY mc."userId", mc."userEmail", mc.course_name, mc.sequence_order, mc.max_episodes, mc."joinedAt"
    ),
    member_stages AS (
      -- Determine which stages each member reached
      SELECT
        "userId",
        "userEmail",
        MAX(CASE WHEN sequence_order = 1 THEN 1 ELSE 0 END) AS reached_aqidah,
        MAX(CASE WHEN sequence_order = 2 THEN 1 ELSE 0 END) AS reached_hijrah,
        MAX(CASE WHEN sequence_order = 3 THEN 1 ELSE 0 END) AS reached_sejarah,
        MAX(CASE WHEN sequence_order = 4 THEN 1 ELSE 0 END) AS reached_dakwah,
        MAX(CASE WHEN sequence_order = 1 AND max_episode_reached >= max_episodes THEN 1 ELSE 0 END) AS completed_aqidah,
        MAX(CASE WHEN sequence_order = 2 AND max_episode_reached >= max_episodes THEN 1 ELSE 0 END) AS completed_hijrah,
        MAX(CASE WHEN sequence_order = 3 AND max_episode_reached >= max_episodes THEN 1 ELSE 0 END) AS completed_sejarah,
        MAX(CASE WHEN sequence_order = 4 AND max_episode_reached >= max_episodes THEN 1 ELSE 0 END) AS completed_dakwah,
        MAX(sequence_order) AS highest_stage_reached
      FROM member_progress
      GROUP BY "userId", "userEmail"
    )
    -- Generate Sankey flow data
    SELECT
      'Started Aqidah' AS source,
      CASE
        WHEN reached_hijrah = 1 THEN 'Continued to Hijrah'
        ELSE 'Dropped after Aqidah'
      END AS target,
      COUNT(*) AS value
    FROM member_stages
    WHERE reached_aqidah = 1
    GROUP BY target

    UNION ALL

    SELECT
      'Continued to Hijrah' AS source,
      CASE
        WHEN reached_sejarah = 1 THEN 'Continued to Sejarah'
        ELSE 'Dropped after Hijrah'
      END AS target,
      COUNT(*) AS value
    FROM member_stages
    WHERE reached_hijrah = 1
    GROUP BY target

    UNION ALL

    SELECT
      'Continued to Sejarah' AS source,
      CASE
        WHEN reached_dakwah = 1 THEN 'Continued to Dakwah'
        ELSE 'Dropped after Sejarah'
      END AS target,
      COUNT(*) AS value
    FROM member_stages
    WHERE reached_sejarah = 1
    GROUP BY target

    UNION ALL

    SELECT
      'Continued to Dakwah' AS source,
      CASE
        WHEN completed_dakwah = 1 THEN 'Completed All Stages'
        ELSE 'In Progress / Stopped'
      END AS target,
      COUNT(*) AS value
    FROM member_stages
    WHERE reached_dakwah = 1
    GROUP BY target

    ORDER BY source, target;
  `;

  const params = [];
  if (dateFrom) params.push(dateFrom);
  if (dateTo) params.push(dateTo);

  const result = await pool.query(query, params);
  return result.rows;
}

/**
 * Get detailed member progression stats
 */
export async function getMemberProgressionStats(pool, dateFrom = null, dateTo = null) {
  const query = `
    WITH member_courses AS (
      SELECT DISTINCT
        uhg."userId",
        uhg."userEmail",
        h.name AS course_name,
        cc.sequence_order,
        cc.max_episodes,
        uhg."joinedAt",
        uhg."hangoutGroupId"
      FROM "UserHangoutGroup" uhg
      JOIN "HangoutGroup" hg ON uhg."hangoutGroupId" = hg.id
      JOIN "Hangout" h ON hg."hangoutId" = h.id
      JOIN course_config cc ON h.name = cc.course_name
      WHERE uhg."hangoutGroupRole" = 'MEMBER'
        AND uhg."userId" IS NOT NULL
        ${dateFrom ? "AND uhg.\"joinedAt\" >= $1" : ""}
        ${dateTo ? (dateFrom ? "AND uhg.\"joinedAt\" <= $2" : "AND uhg.\"joinedAt\" <= $1") : ""}
    ),
    member_progress AS (
      SELECT
        mc."userId",
        mc."userEmail",
        mc.course_name,
        mc.sequence_order,
        mc.max_episodes,
        COALESCE(MAX(he."order"), 0) AS max_episode_reached
      FROM member_courses mc
      LEFT JOIN "UserHangoutGroupAttendance" att
        ON att."userId" = mc."userId"
        AND att."hangoutGroupId" = mc."hangoutGroupId"
      LEFT JOIN "HangoutEpisode" he ON att."hangoutEpisodeId" = he.id
      GROUP BY mc."userId", mc."userEmail", mc.course_name, mc.sequence_order, mc.max_episodes
    ),
    member_stages AS (
      SELECT
        "userId",
        MAX(CASE WHEN sequence_order = 1 THEN 1 ELSE 0 END) AS reached_aqidah,
        MAX(CASE WHEN sequence_order = 2 THEN 1 ELSE 0 END) AS reached_hijrah,
        MAX(CASE WHEN sequence_order = 3 THEN 1 ELSE 0 END) AS reached_sejarah,
        MAX(CASE WHEN sequence_order = 4 THEN 1 ELSE 0 END) AS reached_dakwah,
        MAX(CASE WHEN sequence_order = 1 AND max_episode_reached >= max_episodes THEN 1 ELSE 0 END) AS completed_aqidah,
        MAX(CASE WHEN sequence_order = 2 AND max_episode_reached >= max_episodes THEN 1 ELSE 0 END) AS completed_hijrah,
        MAX(CASE WHEN sequence_order = 3 AND max_episode_reached >= max_episodes THEN 1 ELSE 0 END) AS completed_sejarah,
        MAX(CASE WHEN sequence_order = 4 AND max_episode_reached >= max_episodes THEN 1 ELSE 0 END) AS completed_dakwah
      FROM member_progress
      GROUP BY "userId"
    )
    SELECT
      COUNT(*) FILTER (WHERE reached_aqidah = 1) AS total_started,
      COUNT(*) FILTER (WHERE reached_hijrah = 1) AS reached_hijrah,
      COUNT(*) FILTER (WHERE reached_sejarah = 1) AS reached_sejarah,
      COUNT(*) FILTER (WHERE reached_dakwah = 1) AS reached_dakwah,
      COUNT(*) FILTER (WHERE completed_dakwah = 1) AS completed_all,
      ROUND(100.0 * COUNT(*) FILTER (WHERE reached_hijrah = 1) / NULLIF(COUNT(*) FILTER (WHERE reached_aqidah = 1), 0), 1) AS aqidah_to_hijrah_pct,
      ROUND(100.0 * COUNT(*) FILTER (WHERE reached_sejarah = 1) / NULLIF(COUNT(*) FILTER (WHERE reached_hijrah = 1), 0), 1) AS hijrah_to_sejarah_pct,
      ROUND(100.0 * COUNT(*) FILTER (WHERE reached_dakwah = 1) / NULLIF(COUNT(*) FILTER (WHERE reached_sejarah = 1), 0), 1) AS sejarah_to_dakwah_pct,
      ROUND(100.0 * COUNT(*) FILTER (WHERE completed_dakwah = 1) / NULLIF(COUNT(*) FILTER (WHERE reached_aqidah = 1), 0), 1) AS overall_completion_pct
    FROM member_stages;
  `;

  const params = [];
  if (dateFrom) params.push(dateFrom);
  if (dateTo) params.push(dateTo);

  const result = await pool.query(query, params);
  return result.rows[0];
}
