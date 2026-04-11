// Member location queries

export async function getMemberProvinces(pool) {
  const result = await pool.query(`
    SELECT DISTINCT up.province
    FROM "UserProfile" up
    JOIN "UserHangoutGroup" uhg ON uhg."userId" = up."userId"
    WHERE uhg."hangoutGroupRole" = 'MEMBER'
      AND up.province IS NOT NULL
      AND up.province != ''
    ORDER BY up.province
  `);
  return result.rows.map(r => r.province);
}

export async function getMemberCities(pool, provinces = []) {
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
    WHERE uhg."hangoutGroupRole" = 'MEMBER'
      AND up.city IS NOT NULL
      AND up.city != ''
      ${provinceFilter}
    ORDER BY up.province, up.city
  `, params);
  return result.rows;
}

export async function getMembersByLocation(pool, { provinces = [], cities = [] } = {}) {
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
    WITH member_groups AS (
      SELECT
        uhg."userId",
        COUNT(DISTINCT uhg."hangoutGroupId") AS groups_joined,
        STRING_AGG(DISTINCT hg.name, ', ' ORDER BY hg.name) AS group_names
      FROM "UserHangoutGroup" uhg
      JOIN "HangoutGroup" hg ON hg.id = uhg."hangoutGroupId"
      WHERE uhg."hangoutGroupRole" = 'MEMBER'
      GROUP BY uhg."userId"
    ),
    became_facilitator AS (
      SELECT DISTINCT uhg_fac."userId"
      FROM "UserHangoutGroup" uhg_fac
      WHERE uhg_fac."hangoutGroupRole" = 'FACILITATOR'
    )
    SELECT
      u.id,
      u.email,
      COALESCE(up."fullName", u.email) AS name,
      up."phoneNumber" AS phone,
      up.province,
      up.city,
      COALESCE(mg.groups_joined, 0) AS groups_joined,
      mg.group_names,
      CASE WHEN bf."userId" IS NOT NULL THEN true ELSE false END AS became_facilitator
    FROM "User" u
    JOIN "UserProfile" up ON up."userId" = u.id
    JOIN "UserHangoutGroup" uhg ON uhg."userId" = u.id AND uhg."hangoutGroupRole" = 'MEMBER'
    LEFT JOIN member_groups mg ON mg."userId" = u.id
    LEFT JOIN became_facilitator bf ON bf."userId" = u.id
    WHERE 1=1
      ${provinceFilter}
      ${cityFilter}
    GROUP BY u.id, u.email, up."fullName", up."phoneNumber", up.province, up.city,
             mg.groups_joined, mg.group_names, bf."userId"
    ORDER BY up.province, up.city, COALESCE(up."fullName", u.email)
  `, params);
  return result.rows;
}
