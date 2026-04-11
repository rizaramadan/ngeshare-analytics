// Populate knowledge graph (local_nodes & local_edges) from synced relational data
// Uses valid_from/valid_to for temporal queries — see how the graph expands/shrinks over time

import { logger } from '../utils/logger.js';

export async function populateGraph(destPool) {
  const client = await destPool.connect();
  try {
    await client.query('BEGIN');

    // Clear existing graph data (full rebuild each sync)
    await client.query('DELETE FROM public.local_edges');
    await client.query('DELETE FROM public.local_nodes');

    // ── NODES ──

    // Users (valid_from = createdAt, valid_to = deletedAt)
    const usersResult = await client.query(`
      INSERT INTO public.local_nodes (id, type, label, properties, created_at, valid_from, valid_to)
      SELECT
        'user:' || u.id,
        'user',
        COALESCE(up."fullName", u.email, u.id),
        jsonb_build_object(
          'email', u.email,
          'lastLogin', u."lastLogin",
          'lastActive', u."lastActive",
          'gender', up.gender,
          'city', up.city,
          'province', up.province,
          'phoneNumber', up."phoneNumber"
        ),
        u."createdAt",
        u."createdAt",
        u."deletedAt"
      FROM public."User" u
      LEFT JOIN public."UserProfile" up ON up."userId" = u.id
      ON CONFLICT (id) DO NOTHING
    `);
    logger.info(`  Nodes: ${usersResult.rowCount} users`);

    // Hangouts (courses)
    const hangoutsResult = await client.query(`
      INSERT INTO public.local_nodes (id, type, label, properties, created_at, valid_from)
      SELECT
        'hangout:' || id,
        'hangout',
        name,
        jsonb_build_object('type', type, 'description', description, 'visibility', visibility),
        "createdAt",
        "createdAt"
      FROM public."Hangout"
      ON CONFLICT (id) DO NOTHING
    `);
    logger.info(`  Nodes: ${hangoutsResult.rowCount} hangouts`);

    // Hangout Episodes
    const episodesResult = await client.query(`
      INSERT INTO public.local_nodes (id, type, label, properties, created_at, valid_from)
      SELECT
        'episode:' || id,
        'episode',
        name,
        jsonb_build_object('description', description, 'order', "order", 'hangoutId', "hangoutId"),
        "createdAt",
        "createdAt"
      FROM public."HangoutEpisode"
      ON CONFLICT (id) DO NOTHING
    `);
    logger.info(`  Nodes: ${episodesResult.rowCount} episodes`);

    // Hangout Groups
    const groupsResult = await client.query(`
      INSERT INTO public.local_nodes (id, type, label, properties, created_at, valid_from, valid_to)
      SELECT
        'group:' || id,
        'group',
        name,
        jsonb_build_object(
          'status', status, 'day', day,
          'city', city, 'province', province,
          'startDate', "startDate", 'endDate', "endDate",
          'hangoutId', "hangoutId"
        ),
        "createdAt",
        COALESCE("startDate", "createdAt"),
        "endDate"
      FROM public."HangoutGroup"
      ON CONFLICT (id) DO NOTHING
    `);
    logger.info(`  Nodes: ${groupsResult.rowCount} groups`);

    // Cities (derived from UserProfile and HangoutGroup)
    const citiesResult = await client.query(`
      INSERT INTO public.local_nodes (id, type, label, properties, created_at, valid_from)
      SELECT DISTINCT
        'city:' || upper(city),
        'city',
        city,
        jsonb_build_object('province', province),
        MIN("createdAt"),
        MIN("createdAt")
      FROM (
        SELECT city, province, "createdAt" FROM public."UserProfile" WHERE city IS NOT NULL AND city != ''
        UNION ALL
        SELECT city, province, "createdAt" FROM public."HangoutGroup" WHERE city IS NOT NULL AND city != ''
      ) combined
      GROUP BY upper(city), city, province
      ON CONFLICT (id) DO NOTHING
    `);
    logger.info(`  Nodes: ${citiesResult.rowCount} cities`);

    // ── EDGES ──

    // Episode BELONGS_TO Hangout
    const epEdgesResult = await client.query(`
      INSERT INTO public.local_edges (id, source_id, target_id, type, label, properties, created_at, valid_from)
      SELECT
        'ep_hangout:' || he.id,
        'episode:' || he.id,
        'hangout:' || he."hangoutId",
        'BELONGS_TO',
        he.name || ' → ' || h.name,
        jsonb_build_object('order', he."order"),
        he."createdAt",
        he."createdAt"
      FROM public."HangoutEpisode" he
      JOIN public."Hangout" h ON h.id = he."hangoutId"
      ON CONFLICT (id) DO NOTHING
    `);
    logger.info(`  Edges: ${epEdgesResult.rowCount} episode→hangout`);

    // Group BELONGS_TO Hangout
    const grpEdgesResult = await client.query(`
      INSERT INTO public.local_edges (id, source_id, target_id, type, label, properties, created_at, valid_from, valid_to)
      SELECT
        'grp_hangout:' || hg.id,
        'group:' || hg.id,
        'hangout:' || hg."hangoutId",
        'BELONGS_TO',
        hg.name || ' → ' || h.name,
        '{}'::jsonb,
        hg."createdAt",
        COALESCE(hg."startDate", hg."createdAt"),
        hg."endDate"
      FROM public."HangoutGroup" hg
      JOIN public."Hangout" h ON h.id = hg."hangoutId"
      WHERE hg."hangoutId" IS NOT NULL
      ON CONFLICT (id) DO NOTHING
    `);
    logger.info(`  Edges: ${grpEdgesResult.rowCount} group→hangout`);

    // Facilitators: User FACILITATES Group
    const facResult = await client.query(`
      INSERT INTO public.local_edges (id, source_id, target_id, type, label, properties, created_at, valid_from, valid_to)
      SELECT
        'facilitates:' || uhg.id,
        'user:' || uhg."userId",
        'group:' || uhg."hangoutGroupId",
        'FACILITATES',
        NULL,
        jsonb_build_object('status', uhg.status, 'joinedAt', uhg."joinedAt"),
        uhg."createdAt",
        COALESCE(uhg."joinedAt", uhg."createdAt"),
        CASE WHEN uhg.status = 'LEFT' THEN uhg."updatedAt" END
      FROM public."UserHangoutGroup" uhg
      WHERE uhg."hangoutGroupRole" = 'FACILITATOR' AND uhg."userId" IS NOT NULL
      ON CONFLICT (id) DO NOTHING
    `);
    logger.info(`  Edges: ${facResult.rowCount} user→facilitates→group`);

    // Members: User MEMBER_OF Group
    const memResult = await client.query(`
      INSERT INTO public.local_edges (id, source_id, target_id, type, label, properties, created_at, valid_from, valid_to)
      SELECT
        'member_of:' || uhg.id,
        'user:' || uhg."userId",
        'group:' || uhg."hangoutGroupId",
        'MEMBER_OF',
        NULL,
        jsonb_build_object('status', uhg.status, 'joinedAt', uhg."joinedAt"),
        uhg."createdAt",
        COALESCE(uhg."joinedAt", uhg."createdAt"),
        CASE WHEN uhg.status = 'LEFT' THEN uhg."updatedAt" END
      FROM public."UserHangoutGroup" uhg
      WHERE uhg."hangoutGroupRole" = 'MEMBER' AND uhg."userId" IS NOT NULL
      ON CONFLICT (id) DO NOTHING
    `);
    logger.info(`  Edges: ${memResult.rowCount} user→member_of→group`);

    // Attendance: User ATTENDED Episode (in context of Group)
    const attResult = await client.query(`
      INSERT INTO public.local_edges (id, source_id, target_id, type, label, properties, created_at, valid_from)
      SELECT
        'attended:' || a.id,
        'user:' || a."userId",
        'episode:' || a."hangoutEpisodeId",
        'ATTENDED',
        NULL,
        jsonb_build_object('groupId', a."hangoutGroupId", 'attendedAt', a."attendedAt"),
        a."attendedAt",
        a."attendedAt"
      FROM public."UserHangoutGroupAttendance" a
      ON CONFLICT (id) DO NOTHING
    `);
    logger.info(`  Edges: ${attResult.rowCount} user→attended→episode`);

    // User LOCATED_IN City
    const userCityResult = await client.query(`
      INSERT INTO public.local_edges (id, source_id, target_id, type, label, properties, created_at, valid_from)
      SELECT
        'user_city:' || up."userId",
        'user:' || up."userId",
        'city:' || upper(up.city),
        'LOCATED_IN',
        NULL,
        jsonb_build_object('province', up.province),
        up."createdAt",
        up."createdAt"
      FROM public."UserProfile" up
      WHERE up.city IS NOT NULL AND up.city != ''
      ON CONFLICT (id) DO NOTHING
    `);
    logger.info(`  Edges: ${userCityResult.rowCount} user→located_in→city`);

    // Group LOCATED_IN City
    const groupCityResult = await client.query(`
      INSERT INTO public.local_edges (id, source_id, target_id, type, label, properties, created_at, valid_from, valid_to)
      SELECT
        'group_city:' || hg.id,
        'group:' || hg.id,
        'city:' || upper(hg.city),
        'LOCATED_IN',
        NULL,
        jsonb_build_object('province', hg.province),
        hg."createdAt",
        COALESCE(hg."startDate", hg."createdAt"),
        hg."endDate"
      FROM public."HangoutGroup" hg
      WHERE hg.city IS NOT NULL AND hg.city != ''
      ON CONFLICT (id) DO NOTHING
    `);
    logger.info(`  Edges: ${groupCityResult.rowCount} group→located_in→city`);

    await client.query('COMMIT');

    // Summary counts
    const { rows: [counts] } = await client.query(`
      SELECT
        (SELECT count(*) FROM public.local_nodes) AS nodes,
        (SELECT count(*) FROM public.local_edges) AS edges
    `);
    logger.info(`  Graph total: ${counts.nodes} nodes, ${counts.edges} edges`);

    return { nodes: parseInt(counts.nodes), edges: parseInt(counts.edges) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
