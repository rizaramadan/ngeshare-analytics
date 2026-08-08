// Facilitator location queries

// Builds the WHERE fragment for location filtering. Mutates `params` by pushing
// the bind values in order. Returns the SQL fragment to append after WHERE 1=1.
// Case semantics: `provinces` / `cities` keep exact match (preserves legacy
// endpoint behavior); `region` uses LOWER(...) for case-insensitive matching
// against the lowercased tokens in regions.js.
function buildLocationFilter(params, { provinces = [], cities = [], region = null } = {}) {
  let fragment = '';
  if (provinces.length > 0) {
    params.push(provinces);
    fragment += ` AND up.province = ANY($${params.length})`;
  }
  if (cities.length > 0) {
    params.push(cities);
    fragment += ` AND up.city = ANY($${params.length})`;
  }
  if (region) {
    if (region.cities && region.cities.length > 0) {
      params.push(region.cities);
      fragment += ` AND LOWER(up.city) = ANY($${params.length})`;
    } else if (region.provinces && region.provinces.length > 0) {
      params.push(region.provinces);
      fragment += ` AND LOWER(up.province) = ANY($${params.length})`;
    }
  }
  return fragment;
}

export async function getProvinces(pool) {
  const result = await pool.query(`
    SELECT DISTINCT up.province
    FROM "UserProfile" up
    JOIN "UserHangoutGroup" uhg ON uhg."userId" = up."userId"
    JOIN v_eligible_hangout_groups eligible ON eligible.id = uhg."hangoutGroupId"
    WHERE uhg."hangoutGroupRole" = 'FACILITATOR'
      AND up.province IS NOT NULL
      AND up.province != ''
    ORDER BY up.province
  `);
  return result.rows.map(r => r.province);
}

export async function getCities(pool, provinces = []) {
  const params = [];
  let provinceFilter = '';
  if (provinces.length > 0) {
    params.push(provinces);
    provinceFilter = `AND up.province = ANY($${params.length})`;
  }

  const result = await pool.query(`
    SELECT DISTINCT up.city, up.province
    FROM "UserProfile" up
    JOIN "UserHangoutGroup" uhg ON uhg."userId" = up."userId"
    JOIN v_eligible_hangout_groups eligible ON eligible.id = uhg."hangoutGroupId"
    WHERE uhg."hangoutGroupRole" = 'FACILITATOR'
      AND up.city IS NOT NULL
      AND up.city != ''
      ${provinceFilter}
    ORDER BY up.province, up.city
  `, params);
  return result.rows;
}

export async function getFacilitatorsByLocation(pool, { provinces = [], cities = [], region = null } = {}) {
  const params = [];
  const locationFilter = buildLocationFilter(params, { provinces, cities, region });

  const result = await pool.query(`
    WITH facilitator_groups AS (
      SELECT
        uhg."userId",
        COUNT(DISTINCT uhg."hangoutGroupId") AS groups_facilitated,
        COUNT(DISTINCT CASE WHEN uhg2."hangoutGroupRole" = 'MEMBER' THEN uhg2."userId" END) AS member_count
      FROM "UserHangoutGroup" uhg
      JOIN v_eligible_hangout_groups eligible ON eligible.id = uhg."hangoutGroupId"
      LEFT JOIN "UserHangoutGroup" uhg2
        ON uhg2."hangoutGroupId" = uhg."hangoutGroupId"
        AND uhg2."hangoutGroupRole" = 'MEMBER'
      WHERE uhg."hangoutGroupRole" = 'FACILITATOR'
      GROUP BY uhg."userId"
    ),
    alumni_check AS (
      SELECT DISTINCT uhg_member."userId"
      FROM "UserHangoutGroup" uhg_member
      JOIN "UserHangoutGroup" uhg_fac
        ON uhg_fac."userId" = uhg_member."userId"
        AND uhg_fac."hangoutGroupRole" = 'FACILITATOR'
      WHERE uhg_member."hangoutGroupRole" = 'MEMBER'
        AND uhg_member."joinedAt" < uhg_fac."joinedAt"
    )
    SELECT
      u.id,
      u.email,
      COALESCE(up."fullName", u.email) AS name,
      up."phoneNumber" AS phone,
      up.province,
      up.city,
      COALESCE(fg.groups_facilitated, 0) AS groups_facilitated,
      COALESCE(fg.member_count, 0) AS member_count,
      CASE WHEN ac."userId" IS NOT NULL THEN true ELSE false END AS is_alumni
    FROM "User" u
    JOIN "UserProfile" up ON up."userId" = u.id
    JOIN "UserHangoutGroup" uhg ON uhg."userId" = u.id AND uhg."hangoutGroupRole" = 'FACILITATOR'
    JOIN v_eligible_hangout_groups eligible ON eligible.id = uhg."hangoutGroupId"
    LEFT JOIN facilitator_groups fg ON fg."userId" = u.id
    LEFT JOIN alumni_check ac ON ac."userId" = u.id
    WHERE 1=1
      ${locationFilter}
    GROUP BY u.id, u.email, up."fullName", up."phoneNumber", up.province, up.city,
             fg.groups_facilitated, fg.member_count, ac."userId"
    ORDER BY up.province, up.city, COALESCE(up."fullName", u.email)
  `, params);
  return result.rows;
}

// Aggregate counts with is_alumni split and active-facilitator breakdown.
// promoted = is_alumni=TRUE (member-promoted), ngeslow_alumni = is_alumni=FALSE.
// active_* = facilitator has >=1 group with computed_status='ACTIVE' (v_group_status).
export async function getFacilitatorCountByLocation(pool, { provinces = [], cities = [], region = null } = {}) {
  const params = [];
  const locationFilter = buildLocationFilter(params, { provinces, cities, region });

  const result = await pool.query(`
    WITH alumni_check AS (
      SELECT DISTINCT uhg_member."userId"
      FROM "UserHangoutGroup" uhg_member
      JOIN "UserHangoutGroup" uhg_fac
        ON uhg_fac."userId" = uhg_member."userId"
        AND uhg_fac."hangoutGroupRole" = 'FACILITATOR'
      WHERE uhg_member."hangoutGroupRole" = 'MEMBER'
        AND uhg_member."joinedAt" < uhg_fac."joinedAt"
    ),
    active_facilitators AS (
      SELECT DISTINCT facilitator_id
      FROM v_group_status
      WHERE computed_status = 'ACTIVE' AND facilitator_id IS NOT NULL
    ),
    facilitators_filtered AS (
      SELECT DISTINCT
        u.id AS user_id,
        CASE WHEN ac."userId" IS NOT NULL THEN true ELSE false END AS is_alumni,
        CASE WHEN af.facilitator_id IS NOT NULL THEN true ELSE false END AS is_active
      FROM "User" u
      JOIN "UserProfile" up ON up."userId" = u.id
      JOIN "UserHangoutGroup" uhg ON uhg."userId" = u.id AND uhg."hangoutGroupRole" = 'FACILITATOR'
      JOIN v_eligible_hangout_groups eligible ON eligible.id = uhg."hangoutGroupId"
      LEFT JOIN alumni_check ac ON ac."userId" = u.id
      LEFT JOIN active_facilitators af ON af.facilitator_id = u.id
      WHERE 1=1
        ${locationFilter}
    )
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE is_alumni = TRUE)::int AS promoted,
      COUNT(*) FILTER (WHERE is_alumni = FALSE)::int AS ngeslow_alumni,
      COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active,
      COUNT(*) FILTER (WHERE is_active = TRUE AND is_alumni = TRUE)::int AS active_promoted,
      COUNT(*) FILTER (WHERE is_active = TRUE AND is_alumni = FALSE)::int AS active_ngeslow_alumni
    FROM facilitators_filtered
  `, params);
  return result.rows[0];
}
