// Facilitator ranking queries
// Ranking formula:
// - +3 for each member who became a facilitator (alumni conversion)
// - +1 for each member (own members + descendant facilitators' members)

// Common CTE fragments for reuse
const DEVELOPERS_CTE = `
    developers AS (
      SELECT replace(source_id, 'user:', '')::text as user_id
      FROM local_edges
      WHERE type = 'HAS_ROLE' AND label = 'developer'
    )`;

// Preserve explicit test flags, and also exclude groups outside the canonical
// counting boundary (non-self-learning Aqidah groups before episode 2).
const TEST_GROUPS_CTE = `
    test_groups AS (
      SELECT replace(id, 'group:', '') as group_id
      FROM local_nodes
      WHERE properties->>'is_test' = 'true'
      UNION
      SELECT hg.id
      FROM "HangoutGroup" hg
      WHERE NOT EXISTS (
        SELECT 1 FROM v_eligible_hangout_groups eligible WHERE eligible.id = hg.id
      )
    )`;

const ACTIVE_MEMBERS_CTE = `
    active_members AS (
      SELECT DISTINCT "userId"
      FROM "UserHangoutGroupAttendance"
    )`;

// Alumni: must have been a Hijrah MEMBER first, then became FACILITATOR after.
// Also excludes cases where the person was already a FACILITATOR before their MEMBER joinedAt (circular lineage fix).
const ALUMNI_CTE = `
    alumni AS (
      SELECT DISTINCT
        m."userId" as alumni_id,
        m."hangoutGroupId" as origin_group_id,
        f."userId" as mentor_facilitator_id
      FROM "UserHangoutGroup" m
      JOIN "HangoutGroup" hg_hijrah ON m."hangoutGroupId" = hg_hijrah.id
      JOIN "Hangout" h_hijrah ON hg_hijrah."hangoutId" = h_hijrah.id
      JOIN "UserHangoutGroup" f
        ON m."hangoutGroupId" = f."hangoutGroupId"
        AND f."hangoutGroupRole" = 'FACILITATOR'
      WHERE h_hijrah.name = 'Ngeshare Sesi Hijrah'
        AND m."hangoutGroupRole" = 'MEMBER'
        AND m."hangoutGroupId" NOT IN (SELECT group_id FROM test_groups)
        AND m."userId" NOT IN (SELECT user_id FROM developers)
        AND f."userId" NOT IN (SELECT user_id FROM developers)
        AND m."userId" IN (SELECT "userId" FROM active_members)
        AND (
          SELECT MIN(fac."joinedAt") FROM "UserHangoutGroup" fac
          WHERE fac."userId" = m."userId"
            AND fac."hangoutGroupRole" = 'FACILITATOR'
        ) > m."joinedAt"
        -- Fix circular lineage: exclude if they had a FACILITATOR role BEFORE their MEMBER joinedAt
        AND NOT EXISTS (
          SELECT 1 FROM "UserHangoutGroup" prior_fac
          WHERE prior_fac."userId" = m."userId"
            AND prior_fac."hangoutGroupRole" = 'FACILITATOR'
            AND prior_fac."joinedAt" < m."joinedAt"
        )
    )`;

/**
 * Get facilitator ranking with detailed breakdown
 * @param {Pool} pool - Database pool
 * @param {number} limit - Max results to return
 * @returns {Promise<Array>} Ranked facilitators
 */
export async function getFacilitatorRanking(pool, limit = 50) {
  const result = await pool.query(
    `
    WITH RECURSIVE
    ${DEVELOPERS_CTE},
    ${TEST_GROUPS_CTE},
    ${ACTIVE_MEMBERS_CTE},
    ${ALUMNI_CTE},
    -- Step 2: Build lineage tree (facilitator -> descendant facilitators)
    lineage AS (
      -- Base: direct alumni
      SELECT
        mentor_facilitator_id as root_facilitator,
        alumni_id as descendant_id,
        1 as depth
      FROM alumni

      UNION ALL

      -- Recursive: descendants of alumni
      SELECT
        l.root_facilitator,
        a.alumni_id as descendant_id,
        l.depth + 1
      FROM lineage l
      JOIN alumni a ON l.descendant_id = a.mentor_facilitator_id
      WHERE l.depth < 10
    ),
    -- Step 3: Count direct alumni conversions per facilitator (+3 each)
    alumni_score AS (
      SELECT
        mentor_facilitator_id as facilitator_id,
        COUNT(DISTINCT alumni_id) as alumni_count,
        COUNT(DISTINCT alumni_id) * 3 as score
      FROM alumni
      GROUP BY mentor_facilitator_id
    ),
    -- Step 4: Facilitator's own direct members (with at least 1 attendance)
    own_members AS (
      SELECT
        f."userId" as facilitator_id,
        COUNT(DISTINCT m."userId") as member_count
      FROM "UserHangoutGroup" f
      JOIN "UserHangoutGroup" m ON f."hangoutGroupId" = m."hangoutGroupId"
      JOIN active_members am ON m."userId" = am."userId"
      WHERE f."hangoutGroupRole" = 'FACILITATOR'
        AND m."hangoutGroupRole" = 'MEMBER'
        AND f."hangoutGroupId" NOT IN (SELECT group_id FROM test_groups)
        AND m."userId" NOT IN (SELECT user_id FROM developers)
      GROUP BY f."userId"
    ),
    -- Step 5: Dedupe lineage (same descendant can be reached via multiple paths)
    lineage_deduped AS (
      SELECT DISTINCT root_facilitator, descendant_id
      FROM lineage
    ),
    -- Step 6: Descendant members (+1 each, with at least 1 attendance)
    descendant_members AS (
      SELECT
        l.root_facilitator as facilitator_id,
        COUNT(DISTINCT m."userId") as member_count
      FROM lineage_deduped l
      JOIN "UserHangoutGroup" f ON l.descendant_id = f."userId" AND f."hangoutGroupRole" = 'FACILITATOR'
      JOIN "UserHangoutGroup" m ON f."hangoutGroupId" = m."hangoutGroupId" AND m."hangoutGroupRole" = 'MEMBER'
      JOIN active_members am ON m."userId" = am."userId"
      WHERE f."hangoutGroupId" NOT IN (SELECT group_id FROM test_groups)
        AND m."userId" NOT IN (SELECT user_id FROM developers)
      GROUP BY l.root_facilitator
    ),
    -- Step 7: Count groups facilitated
    groups_facilitated AS (
      SELECT
        "userId" as facilitator_id,
        COUNT(DISTINCT "hangoutGroupId") as group_count
      FROM "UserHangoutGroup"
      WHERE "hangoutGroupRole" = 'FACILITATOR'
        AND "hangoutGroupId" NOT IN (SELECT group_id FROM test_groups)
      GROUP BY "userId"
    )
    -- Final ranking
    SELECT
      u.id as facilitator_id,
      u.email,
      COALESCE(up."fullName", u.email) as name,
      COALESCE(g.group_count, 0) as groups_facilitated,
      COALESCE(a.alumni_count, 0) as alumni_converted,
      COALESCE(a.score, 0) as alumni_points,
      COALESCE(o.member_count, 0) as own_members,
      COALESCE(d.member_count, 0) as descendant_members,
      COALESCE(o.member_count, 0) + COALESCE(d.member_count, 0) as member_points,
      COALESCE(a.score, 0) + COALESCE(o.member_count, 0) + COALESCE(d.member_count, 0) as total_score
    FROM (
      SELECT DISTINCT "userId" FROM "UserHangoutGroup"
      WHERE "hangoutGroupRole" = 'FACILITATOR'
        AND "userId" NOT IN (SELECT user_id FROM developers)
        AND "hangoutGroupId" NOT IN (SELECT group_id FROM test_groups)
    ) fac
    JOIN "User" u ON fac."userId" = u.id
    LEFT JOIN "UserProfile" up ON u.id = up."userId"
    LEFT JOIN alumni_score a ON fac."userId" = a.facilitator_id
    LEFT JOIN own_members o ON fac."userId" = o.facilitator_id
    LEFT JOIN descendant_members d ON fac."userId" = d.facilitator_id
    LEFT JOIN groups_facilitated g ON fac."userId" = g.facilitator_id
    ORDER BY total_score DESC
    LIMIT $1
  `,
    [limit]
  );

  return result.rows;
}

/**
 * Get facilitator lineage tree (who mentored whom)
 * @param {Pool} pool - Database pool
 * @param {string} facilitatorId - Optional: filter by specific facilitator
 * @returns {Promise<Array>} Lineage relationships
 */
export async function getFacilitatorLineage(pool, facilitatorId = null) {
  const params = [];
  let whereClause = '';

  if (facilitatorId) {
    params.push(facilitatorId);
    whereClause = 'WHERE mentor.id = $1 OR alumni_user.id = $1';
  }

  const result = await pool.query(
    `
    WITH
    ${DEVELOPERS_CTE},
    ${TEST_GROUPS_CTE},
    ${ACTIVE_MEMBERS_CTE},
    alumni AS (
      SELECT DISTINCT
        m."userId" as alumni_id,
        f."userId" as mentor_id,
        m."joinedAt" as member_joined,
        (
          SELECT MIN(fac."joinedAt")
          FROM "UserHangoutGroup" fac
          WHERE fac."userId" = m."userId"
            AND fac."hangoutGroupRole" = 'FACILITATOR'
        ) as facilitator_joined
      FROM "UserHangoutGroup" m
      JOIN "HangoutGroup" hg_hijrah ON m."hangoutGroupId" = hg_hijrah.id
      JOIN "Hangout" h_hijrah ON hg_hijrah."hangoutId" = h_hijrah.id
      JOIN "UserHangoutGroup" f
        ON m."hangoutGroupId" = f."hangoutGroupId"
        AND f."hangoutGroupRole" = 'FACILITATOR'
      WHERE h_hijrah.name = 'Ngeshare Sesi Hijrah'
        AND m."hangoutGroupRole" = 'MEMBER'
        AND m."hangoutGroupId" NOT IN (SELECT group_id FROM test_groups)
        AND m."userId" NOT IN (SELECT user_id FROM developers)
        AND f."userId" NOT IN (SELECT user_id FROM developers)
        AND m."userId" IN (SELECT "userId" FROM active_members)
        AND (
          SELECT MIN(fac."joinedAt") FROM "UserHangoutGroup" fac
          WHERE fac."userId" = m."userId"
            AND fac."hangoutGroupRole" = 'FACILITATOR'
        ) > m."joinedAt"
        AND NOT EXISTS (
          SELECT 1 FROM "UserHangoutGroup" prior_fac
          WHERE prior_fac."userId" = m."userId"
            AND prior_fac."hangoutGroupRole" = 'FACILITATOR'
            AND prior_fac."joinedAt" < m."joinedAt"
        )
    )
    SELECT
      mentor.id as mentor_id,
      mentor.email as mentor_email,
      COALESCE(mp."fullName", mentor.email) as mentor_name,
      alumni_user.id as alumni_id,
      alumni_user.email as alumni_email,
      COALESCE(ap."fullName", alumni_user.email) as alumni_name,
      a.member_joined,
      a.facilitator_joined
    FROM alumni a
    JOIN "User" mentor ON a.mentor_id = mentor.id
    LEFT JOIN "UserProfile" mp ON mentor.id = mp."userId"
    JOIN "User" alumni_user ON a.alumni_id = alumni_user.id
    LEFT JOIN "UserProfile" ap ON alumni_user.id = ap."userId"
    ${whereClause}
    ORDER BY a.facilitator_joined DESC
  `,
    params
  );

  return result.rows;
}

/**
 * Get detailed breakdown for a specific facilitator
 * Shows all alumni (direct converts), own members, and descendant tree
 * @param {Pool} pool - Database pool
 * @param {string} facilitatorId - Facilitator user ID
 * @returns {Promise<Object>} Detailed breakdown
 */
export async function getFacilitatorDetails(pool, facilitatorId) {
  // Get facilitator info
  const facilitatorResult = await pool.query(
    `SELECT u.id, u.email, COALESCE(up."fullName", u.email) as name
     FROM "User" u LEFT JOIN "UserProfile" up ON u.id = up."userId"
     WHERE u.id = $1`,
    [facilitatorId]
  );
  const facilitator = facilitatorResult.rows[0];
  if (!facilitator) return null;

  // Get groups facilitated (exclude test groups)
  const groupsResult = await pool.query(
    `
    WITH
    ${TEST_GROUPS_CTE}
    SELECT
      hg.id as group_id,
      hg.name as group_name,
      h.name as course_name
    FROM "UserHangoutGroup" uhg
    JOIN "HangoutGroup" hg ON uhg."hangoutGroupId" = hg.id
    LEFT JOIN "Hangout" h ON hg."hangoutId" = h.id
    WHERE uhg."userId" = $1 AND uhg."hangoutGroupRole" = 'FACILITATOR'
      AND uhg."hangoutGroupId" NOT IN (SELECT group_id FROM test_groups)
    ORDER BY hg."createdAt" DESC
    `,
    [facilitatorId]
  );

  // Get own members (direct members in facilitator's groups) - deduplicated, with at least 1 attendance
  const ownMembersResult = await pool.query(
    `
    WITH
    ${DEVELOPERS_CTE},
    ${TEST_GROUPS_CTE},
    ${ACTIVE_MEMBERS_CTE},
    member_raw AS (
      SELECT DISTINCT
        u.id as user_id,
        u.email,
        COALESCE(up."fullName", u.email) as name,
        hg.name as group_name,
        h.name as course_name,
        m."joinedAt" as joined_at
      FROM "UserHangoutGroup" f
      JOIN "UserHangoutGroup" m ON f."hangoutGroupId" = m."hangoutGroupId"
      JOIN "User" u ON m."userId" = u.id
      LEFT JOIN "UserProfile" up ON u.id = up."userId"
      JOIN "HangoutGroup" hg ON f."hangoutGroupId" = hg.id
      LEFT JOIN "Hangout" h ON hg."hangoutId" = h.id
      JOIN active_members am ON m."userId" = am."userId"
      WHERE f."userId" = $1
        AND f."hangoutGroupRole" = 'FACILITATOR'
        AND m."hangoutGroupRole" = 'MEMBER'
        AND f."hangoutGroupId" NOT IN (SELECT group_id FROM test_groups)
        AND m."userId" NOT IN (SELECT user_id FROM developers)
    )
    SELECT
      user_id,
      email,
      name,
      array_agg(DISTINCT group_name ORDER BY group_name) as groups,
      array_agg(DISTINCT course_name ORDER BY course_name) as courses,
      MIN(joined_at) as first_joined
    FROM member_raw
    GROUP BY user_id, email, name
    ORDER BY first_joined DESC
    `,
    [facilitatorId]
  );

  // Get direct alumni (members who became facilitators) - deduplicated with aggregated groups
  const alumniResult = await pool.query(
    `
    WITH
    ${DEVELOPERS_CTE},
    ${TEST_GROUPS_CTE},
    ${ACTIVE_MEMBERS_CTE},
    alumni_raw AS (
      SELECT DISTINCT
        u.id as user_id,
        u.email,
        COALESCE(up."fullName", u.email) as name,
        hg.name as origin_group_name,
        h.name as course_name,
        m."joinedAt" as member_joined,
        (
          SELECT MIN(fac."joinedAt")
          FROM "UserHangoutGroup" fac
          WHERE fac."userId" = m."userId"
            AND fac."hangoutGroupRole" = 'FACILITATOR'
        ) as facilitator_joined
      FROM "UserHangoutGroup" f
      JOIN "UserHangoutGroup" m ON f."hangoutGroupId" = m."hangoutGroupId"
      JOIN "HangoutGroup" hg ON f."hangoutGroupId" = hg.id
      JOIN "Hangout" h ON hg."hangoutId" = h.id
      JOIN "User" u ON m."userId" = u.id
      LEFT JOIN "UserProfile" up ON u.id = up."userId"
      JOIN active_members am ON m."userId" = am."userId"
      WHERE f."userId" = $1
        AND f."hangoutGroupRole" = 'FACILITATOR'
        AND m."hangoutGroupRole" = 'MEMBER'
        AND h.name = 'Ngeshare Sesi Hijrah'
        AND f."hangoutGroupId" NOT IN (SELECT group_id FROM test_groups)
        AND m."userId" NOT IN (SELECT user_id FROM developers)
        AND (
          SELECT MIN(fac."joinedAt") FROM "UserHangoutGroup" fac
          WHERE fac."userId" = m."userId"
            AND fac."hangoutGroupRole" = 'FACILITATOR'
        ) > m."joinedAt"
        AND NOT EXISTS (
          SELECT 1 FROM "UserHangoutGroup" prior_fac
          WHERE prior_fac."userId" = m."userId"
            AND prior_fac."hangoutGroupRole" = 'FACILITATOR'
            AND prior_fac."joinedAt" < m."joinedAt"
        )
    )
    SELECT
      user_id,
      email,
      name,
      array_agg(DISTINCT origin_group_name ORDER BY origin_group_name) as origin_groups,
      array_agg(DISTINCT course_name ORDER BY course_name) as courses,
      MIN(member_joined) as first_member_joined,
      MIN(facilitator_joined) as facilitator_joined
    FROM alumni_raw
    GROUP BY user_id, email, name
    ORDER BY facilitator_joined DESC
    `,
    [facilitatorId]
  );

  // Get descendant tree (recursive)
  const descendantsResult = await pool.query(
    `
    WITH RECURSIVE
    ${DEVELOPERS_CTE},
    ${TEST_GROUPS_CTE},
    ${ACTIVE_MEMBERS_CTE},
    alumni AS (
      SELECT DISTINCT
        m."userId" as alumni_id,
        f."userId" as mentor_id
      FROM "UserHangoutGroup" m
      JOIN "HangoutGroup" hg_hijrah ON m."hangoutGroupId" = hg_hijrah.id
      JOIN "Hangout" h_hijrah ON hg_hijrah."hangoutId" = h_hijrah.id
      JOIN "UserHangoutGroup" f
        ON m."hangoutGroupId" = f."hangoutGroupId"
        AND f."hangoutGroupRole" = 'FACILITATOR'
      WHERE h_hijrah.name = 'Ngeshare Sesi Hijrah'
        AND m."hangoutGroupRole" = 'MEMBER'
        AND m."hangoutGroupId" NOT IN (SELECT group_id FROM test_groups)
        AND m."userId" NOT IN (SELECT user_id FROM developers)
        AND f."userId" NOT IN (SELECT user_id FROM developers)
        AND m."userId" IN (SELECT "userId" FROM active_members)
        AND (
          SELECT MIN(fac."joinedAt") FROM "UserHangoutGroup" fac
          WHERE fac."userId" = m."userId"
            AND fac."hangoutGroupRole" = 'FACILITATOR'
        ) > m."joinedAt"
        AND NOT EXISTS (
          SELECT 1 FROM "UserHangoutGroup" prior_fac
          WHERE prior_fac."userId" = m."userId"
            AND prior_fac."hangoutGroupRole" = 'FACILITATOR'
            AND prior_fac."joinedAt" < m."joinedAt"
        )
    ),
    lineage AS (
      SELECT
        mentor_id as root,
        alumni_id as descendant_id,
        1 as depth,
        ARRAY[mentor_id, alumni_id] as path
      FROM alumni
      WHERE mentor_id = $1

      UNION ALL

      SELECT
        l.root,
        a.alumni_id as descendant_id,
        l.depth + 1,
        l.path || a.alumni_id
      FROM lineage l
      JOIN alumni a ON l.descendant_id = a.mentor_id
      WHERE l.depth < 10
        AND NOT a.alumni_id = ANY(l.path)
    )
    SELECT
      l.descendant_id as descendant_id,
      u.id as descendant_user_id,
      u.email as descendant_email,
      COALESCE(up."fullName", u.email) as descendant_name,
      l.depth,
      mentor.email as direct_mentor_email,
      COALESCE(mp."fullName", mentor.email) as direct_mentor_name
    FROM lineage l
    JOIN "User" u ON l.descendant_id = u.id
    LEFT JOIN "UserProfile" up ON u.id = up."userId"
    JOIN alumni a ON l.descendant_id = a.alumni_id
    JOIN "User" mentor ON a.mentor_id = mentor.id
    LEFT JOIN "UserProfile" mp ON mentor.id = mp."userId"
    ORDER BY l.depth, u.email
    `,
    [facilitatorId]
  );

  // Get members of descendants - deduplicated by member, grouped by descendant, with at least 1 attendance
  const descendantMembersResult = await pool.query(
    `
    WITH RECURSIVE
    ${DEVELOPERS_CTE},
    ${TEST_GROUPS_CTE},
    ${ACTIVE_MEMBERS_CTE},
    alumni AS (
      SELECT DISTINCT
        m."userId" as alumni_id,
        f."userId" as mentor_id
      FROM "UserHangoutGroup" m
      JOIN "HangoutGroup" hg_hijrah ON m."hangoutGroupId" = hg_hijrah.id
      JOIN "Hangout" h_hijrah ON hg_hijrah."hangoutId" = h_hijrah.id
      JOIN "UserHangoutGroup" f
        ON m."hangoutGroupId" = f."hangoutGroupId"
        AND f."hangoutGroupRole" = 'FACILITATOR'
      WHERE h_hijrah.name = 'Ngeshare Sesi Hijrah'
        AND m."hangoutGroupRole" = 'MEMBER'
        AND m."hangoutGroupId" NOT IN (SELECT group_id FROM test_groups)
        AND m."userId" NOT IN (SELECT user_id FROM developers)
        AND f."userId" NOT IN (SELECT user_id FROM developers)
        AND m."userId" IN (SELECT "userId" FROM active_members)
        AND (
          SELECT MIN(fac."joinedAt") FROM "UserHangoutGroup" fac
          WHERE fac."userId" = m."userId"
            AND fac."hangoutGroupRole" = 'FACILITATOR'
        ) > m."joinedAt"
        AND NOT EXISTS (
          SELECT 1 FROM "UserHangoutGroup" prior_fac
          WHERE prior_fac."userId" = m."userId"
            AND prior_fac."hangoutGroupRole" = 'FACILITATOR'
            AND prior_fac."joinedAt" < m."joinedAt"
        )
    ),
    lineage AS (
      SELECT mentor_id as root, alumni_id as descendant_id, 1 as depth
      FROM alumni WHERE mentor_id = $1
      UNION ALL
      SELECT l.root, a.alumni_id, l.depth + 1
      FROM lineage l JOIN alumni a ON l.descendant_id = a.mentor_id
      WHERE l.depth < 10
    ),
    lineage_deduped AS (
      SELECT DISTINCT root, descendant_id, MIN(depth) as depth
      FROM lineage GROUP BY root, descendant_id
    ),
    member_details AS (
      SELECT DISTINCT
        desc_user.email as descendant_email,
        COALESCE(dp."fullName", desc_user.email) as descendant_name,
        l.depth as descendant_depth,
        member_user.id as member_id,
        member_user.email as member_email,
        COALESCE(mp."fullName", member_user.email) as member_name,
        array_agg(DISTINCT hg.name ORDER BY hg.name) as groups
      FROM lineage_deduped l
      JOIN "User" desc_user ON l.descendant_id = desc_user.id
      LEFT JOIN "UserProfile" dp ON desc_user.id = dp."userId"
      JOIN "UserHangoutGroup" f ON l.descendant_id = f."userId" AND f."hangoutGroupRole" = 'FACILITATOR'
      JOIN "UserHangoutGroup" m ON f."hangoutGroupId" = m."hangoutGroupId" AND m."hangoutGroupRole" = 'MEMBER'
      JOIN "User" member_user ON m."userId" = member_user.id
      LEFT JOIN "UserProfile" mp ON member_user.id = mp."userId"
      JOIN "HangoutGroup" hg ON f."hangoutGroupId" = hg.id
      JOIN active_members am ON m."userId" = am."userId"
      WHERE f."hangoutGroupId" NOT IN (SELECT group_id FROM test_groups)
        AND m."userId" NOT IN (SELECT user_id FROM developers)
      GROUP BY desc_user.email, dp."fullName", l.depth, member_user.id, member_user.email, mp."fullName"
    )
    SELECT * FROM member_details
    ORDER BY descendant_depth, descendant_email, member_email
    `,
    [facilitatorId]
  );

  // Get accurate summary using same logic as ranking query (with attendance filter)
  const summaryResult = await pool.query(
    `
    WITH RECURSIVE
    ${DEVELOPERS_CTE},
    ${TEST_GROUPS_CTE},
    ${ACTIVE_MEMBERS_CTE},
    alumni AS (
      SELECT DISTINCT
        m."userId" as alumni_id,
        f."userId" as mentor_facilitator_id
      FROM "UserHangoutGroup" m
      JOIN "HangoutGroup" hg_hijrah ON m."hangoutGroupId" = hg_hijrah.id
      JOIN "Hangout" h_hijrah ON hg_hijrah."hangoutId" = h_hijrah.id
      JOIN "UserHangoutGroup" f
        ON m."hangoutGroupId" = f."hangoutGroupId"
        AND f."hangoutGroupRole" = 'FACILITATOR'
      WHERE h_hijrah.name = 'Ngeshare Sesi Hijrah'
        AND m."hangoutGroupRole" = 'MEMBER'
        AND m."hangoutGroupId" NOT IN (SELECT group_id FROM test_groups)
        AND m."userId" NOT IN (SELECT user_id FROM developers)
        AND f."userId" NOT IN (SELECT user_id FROM developers)
        AND m."userId" IN (SELECT "userId" FROM active_members)
        AND (
          SELECT MIN(fac."joinedAt") FROM "UserHangoutGroup" fac
          WHERE fac."userId" = m."userId"
            AND fac."hangoutGroupRole" = 'FACILITATOR'
        ) > m."joinedAt"
        AND NOT EXISTS (
          SELECT 1 FROM "UserHangoutGroup" prior_fac
          WHERE prior_fac."userId" = m."userId"
            AND prior_fac."hangoutGroupRole" = 'FACILITATOR'
            AND prior_fac."joinedAt" < m."joinedAt"
        )
    ),
    lineage AS (
      SELECT mentor_facilitator_id as root, alumni_id as descendant_id, 1 as depth
      FROM alumni WHERE mentor_facilitator_id = $1
      UNION ALL
      SELECT l.root, a.alumni_id, l.depth + 1
      FROM lineage l JOIN alumni a ON l.descendant_id = a.mentor_facilitator_id
      WHERE l.depth < 10
    ),
    lineage_deduped AS (
      SELECT DISTINCT root, descendant_id FROM lineage
    ),
    own_members AS (
      SELECT COUNT(DISTINCT m."userId") as cnt
      FROM "UserHangoutGroup" f
      JOIN "UserHangoutGroup" m ON f."hangoutGroupId" = m."hangoutGroupId"
      JOIN active_members am ON m."userId" = am."userId"
      WHERE f."userId" = $1 AND f."hangoutGroupRole" = 'FACILITATOR' AND m."hangoutGroupRole" = 'MEMBER'
        AND f."hangoutGroupId" NOT IN (SELECT group_id FROM test_groups)
        AND m."userId" NOT IN (SELECT user_id FROM developers)
    ),
    direct_alumni AS (
      SELECT COUNT(DISTINCT alumni_id) as cnt FROM alumni WHERE mentor_facilitator_id = $1
    ),
    descendant_members AS (
      SELECT COUNT(DISTINCT m."userId") as cnt
      FROM lineage_deduped l
      JOIN "UserHangoutGroup" f ON l.descendant_id = f."userId" AND f."hangoutGroupRole" = 'FACILITATOR'
      JOIN "UserHangoutGroup" m ON f."hangoutGroupId" = m."hangoutGroupId" AND m."hangoutGroupRole" = 'MEMBER'
      JOIN active_members am ON m."userId" = am."userId"
      WHERE f."hangoutGroupId" NOT IN (SELECT group_id FROM test_groups)
        AND m."userId" NOT IN (SELECT user_id FROM developers)
    )
    SELECT
      (SELECT cnt FROM own_members) as own_members_count,
      (SELECT cnt FROM direct_alumni) as alumni_count,
      (SELECT COUNT(DISTINCT descendant_id) FROM lineage_deduped) as descendants_count,
      (SELECT cnt FROM descendant_members) as descendant_members_count
    `,
    [facilitatorId]
  );
  const stats = summaryResult.rows[0];

  const ownMembersCount = parseInt(stats.own_members_count) || 0;
  const alumniCount = parseInt(stats.alumni_count) || 0;
  const descendantsCount = parseInt(stats.descendants_count) || 0;
  const descendantMembersCount = parseInt(stats.descendant_members_count) || 0;

  return {
    facilitator,
    groups: groupsResult.rows,
    ownMembers: ownMembersResult.rows,
    alumni: alumniResult.rows,
    descendants: descendantsResult.rows,
    descendantMembers: descendantMembersResult.rows,
    summary: {
      groupsCount: groupsResult.rows.length,
      ownMembersCount,
      ownMembersRaw: ownMembersResult.rows.length,
      alumniCount,
      alumniRaw: alumniResult.rows.length,
      descendantsCount,
      descendantMembersCount,
      descendantMembersRaw: descendantMembersResult.rows.length,
      alumniPoints: alumniCount * 3,
      memberPoints: ownMembersCount + descendantMembersCount,
      totalScore: (alumniCount * 3) + ownMembersCount + descendantMembersCount
    }
  };
}

/**
 * Get ranking summary statistics
 * @param {Pool} pool - Database pool
 * @returns {Promise<Object>} Summary stats
 */
export async function getRankingSummary(pool) {
  const result = await pool.query(`
    WITH
    ${DEVELOPERS_CTE},
    ${TEST_GROUPS_CTE},
    ${ACTIVE_MEMBERS_CTE},
    alumni AS (
      SELECT DISTINCT m."userId" as alumni_id
      FROM "UserHangoutGroup" m
      JOIN "HangoutGroup" hg_hijrah ON m."hangoutGroupId" = hg_hijrah.id
      JOIN "Hangout" h_hijrah ON hg_hijrah."hangoutId" = h_hijrah.id
      WHERE m."hangoutGroupRole" = 'MEMBER'
        AND h_hijrah.name = 'Ngeshare Sesi Hijrah'
        AND m."hangoutGroupId" NOT IN (SELECT group_id FROM test_groups)
        AND m."userId" NOT IN (SELECT user_id FROM developers)
        AND m."userId" IN (SELECT "userId" FROM active_members)
        AND (
          SELECT MIN(fac."joinedAt") FROM "UserHangoutGroup" fac
          WHERE fac."userId" = m."userId"
            AND fac."hangoutGroupRole" = 'FACILITATOR'
        ) > m."joinedAt"
        AND NOT EXISTS (
          SELECT 1 FROM "UserHangoutGroup" prior_fac
          WHERE prior_fac."userId" = m."userId"
            AND prior_fac."hangoutGroupRole" = 'FACILITATOR'
            AND prior_fac."joinedAt" < m."joinedAt"
        )
    )
    SELECT
      (SELECT COUNT(DISTINCT "userId") FROM "UserHangoutGroup"
       WHERE "hangoutGroupRole" = 'FACILITATOR'
         AND "userId" NOT IN (SELECT user_id FROM developers)
         AND "hangoutGroupId" NOT IN (SELECT group_id FROM test_groups)
      ) as total_facilitators,
      (SELECT COUNT(*) FROM alumni) as total_alumni,
      (SELECT COUNT(DISTINCT "userId") FROM "UserHangoutGroup"
       WHERE "hangoutGroupRole" = 'MEMBER'
         AND "userId" NOT IN (SELECT user_id FROM developers)
         AND "hangoutGroupId" NOT IN (SELECT group_id FROM test_groups)
      ) as total_members,
      (SELECT COUNT(DISTINCT "hangoutGroupId") FROM "UserHangoutGroup"
       WHERE "hangoutGroupRole" = 'FACILITATOR'
         AND "hangoutGroupId" NOT IN (SELECT group_id FROM test_groups)
      ) as total_groups,
      (SELECT MAX("joinedAt") FROM "UserHangoutGroup"
       WHERE "userId" NOT IN (SELECT user_id FROM developers)
         AND "hangoutGroupId" NOT IN (SELECT group_id FROM test_groups)
      ) as newest_member_joined_at,
      (SELECT MAX("attendedAt") FROM "UserHangoutGroupAttendance") as newest_attended_at
  `);

  return result.rows[0];
}
