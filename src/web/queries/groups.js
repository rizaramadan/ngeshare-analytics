// Group-related queries

export async function getGroups(pool, filters = {}) {
  let query = `
    SELECT
      group_id,
      group_name,
      course_name,
      computed_status,
      facilitator_email,
      member_count,
      max_episode_reached,
      max_episodes,
      progress_pct,
      days_since_last_meeting,
      last_meeting_date,
      city,
      province
    FROM v_group_status
    WHERE 1=1
  `;
  const params = [];

  if (filters.course) {
    params.push(filters.course);
    query += ` AND course_name = $${params.length}`;
  }

  if (filters.status) {
    params.push(filters.status);
    query += ` AND computed_status = $${params.length}`;
  }

  query += ` ORDER BY last_meeting_date DESC NULLS LAST`;

  const result = await pool.query(query, params);
  return result.rows;
}

export async function getGroupById(pool, groupId) {
  const result = await pool.query(
    `SELECT * FROM v_group_status WHERE group_id = $1`,
    [groupId]
  );
  return result.rows[0];
}

export async function getGroupMembers(pool, groupId) {
  const result = await pool.query(
    `SELECT
      uhg."userId",
      uhg."userEmail",
      uhg."hangoutGroupRole" AS role,
      uhg."joinedAt",
      uhg.status
    FROM "UserHangoutGroup" uhg
    WHERE uhg."hangoutGroupId" = $1
    ORDER BY uhg."hangoutGroupRole", uhg."joinedAt"`,
    [groupId]
  );
  return result.rows;
}

export async function getRescueList(pool) {
  const result = await pool.query(`
    SELECT * FROM v_rescue_list
    ORDER BY days_since_last_meeting ASC NULLS LAST
  `);
  return result.rows;
}

export async function getCourseList(pool) {
  const result = await pool.query(`
    SELECT course_name, max_episodes, sequence_order
    FROM course_config
    ORDER BY sequence_order
  `);
  return result.rows;
}
