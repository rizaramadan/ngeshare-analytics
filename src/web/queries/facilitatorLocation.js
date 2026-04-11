// Facilitator location queries

export async function getProvinces(pool) {
  const result = await pool.query(`
    SELECT DISTINCT up.province
    FROM "UserProfile" up
    JOIN "UserHangoutGroup" uhg ON uhg."userId" = up."userId"
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
    WHERE uhg."hangoutGroupRole" = 'FACILITATOR'
      AND up.city IS NOT NULL
      AND up.city != ''
      ${provinceFilter}
    ORDER BY up.province, up.city
  `, params);
  return result.rows;
}

export async function getFacilitatorsByLocation(pool, { provinces = [], cities = [] } = {}) {
  const params = [];
  let provinceFilter = '';
  let cityFilter = '';

  if (provinces.length > 0) {
    params.push(provinces);
    provinceFilter = `AND up.province = ANY($${params.length})`;
  }
  if (cities.length > 0) {
    params.push(cities);
    cityFilter = `AND up.city = ANY($${params.length})`;
  }

  const result = await pool.query(`
    WITH facilitator_groups AS (
      SELECT
        uhg."userId",
        COUNT(DISTINCT uhg."hangoutGroupId") AS groups_facilitated,
        COUNT(DISTINCT CASE WHEN uhg2."hangoutGroupRole" = 'MEMBER' THEN uhg2."userId" END) AS member_count
      FROM "UserHangoutGroup" uhg
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
    LEFT JOIN facilitator_groups fg ON fg."userId" = u.id
    LEFT JOIN alumni_check ac ON ac."userId" = u.id
    WHERE 1=1
      ${provinceFilter}
      ${cityFilter}
    GROUP BY u.id, u.email, up."fullName", up."phoneNumber", up.province, up.city,
             fg.groups_facilitated, fg.member_count, ac."userId"
    ORDER BY up.province, up.city, COALESCE(up."fullName", u.email)
  `, params);
  return result.rows;
}
