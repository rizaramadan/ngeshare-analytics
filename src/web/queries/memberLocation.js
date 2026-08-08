// Member location queries

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

export async function getMemberProvinces(pool) {
  const result = await pool.query(`
    SELECT DISTINCT up.province
    FROM "UserProfile" up
    JOIN "UserHangoutGroup" uhg ON uhg."userId" = up."userId"
    JOIN v_eligible_hangout_groups eligible ON eligible.id = uhg."hangoutGroupId"
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
    JOIN v_eligible_hangout_groups eligible ON eligible.id = uhg."hangoutGroupId"
    WHERE uhg."hangoutGroupRole" = 'MEMBER'
      AND up.city IS NOT NULL
      AND up.city != ''
      ${provinceFilter}
    ORDER BY up.province, up.city
  `, params);
  return result.rows;
}

export async function getMembersByLocation(pool, { provinces = [], cities = [], region = null } = {}) {
  const params = [];
  const locationFilter = buildLocationFilter(params, { provinces, cities, region });

  const result = await pool.query(`
    WITH member_groups AS (
      SELECT
        uhg."userId",
        COUNT(DISTINCT uhg."hangoutGroupId") AS groups_joined,
        STRING_AGG(DISTINCT hg.name, ', ' ORDER BY hg.name) AS group_names
      FROM "UserHangoutGroup" uhg
      JOIN v_eligible_hangout_groups hg ON hg.id = uhg."hangoutGroupId"
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
    JOIN v_eligible_hangout_groups eligible ON eligible.id = uhg."hangoutGroupId"
    LEFT JOIN member_groups mg ON mg."userId" = u.id
    LEFT JOIN became_facilitator bf ON bf."userId" = u.id
    WHERE 1=1
      ${locationFilter}
    GROUP BY u.id, u.email, up."fullName", up."phoneNumber", up.province, up.city,
             mg.groups_joined, mg.group_names, bf."userId"
    ORDER BY up.province, up.city, COALESCE(up."fullName", u.email)
  `, params);
  return result.rows;
}

export async function getMemberCountByLocation(pool, { provinces = [], cities = [], region = null } = {}) {
  const params = [];
  const locationFilter = buildLocationFilter(params, { provinces, cities, region });

  const result = await pool.query(`
    SELECT COUNT(DISTINCT u.id)::int AS total
    FROM "User" u
    JOIN "UserProfile" up ON up."userId" = u.id
    JOIN "UserHangoutGroup" uhg ON uhg."userId" = u.id AND uhg."hangoutGroupRole" = 'MEMBER'
    WHERE 1=1
      ${locationFilter}
  `, params);
  return result.rows[0];
}
