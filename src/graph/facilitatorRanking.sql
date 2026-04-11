-- Facilitator Ranking Query
-- Ranks all facilitators (excluding developers) across 5 dimensions
-- Final score = 0.15*direct_impact + 0.30*lineage + 0.10*consistency + 0.20*throughput + 0.25*retention

WITH
-- Max episodes per hangout course
hangout_max_episodes AS (
    SELECT
        'cm0oj2v3v000008kzext1bj82' AS hangout_id, 9 AS max_eps
    UNION ALL SELECT 'cm0oj5byk0000w4a4olpz34td', 9
    UNION ALL SELECT 'cm0oj63310003w4a42lemgape', 11
    UNION ALL SELECT 'cm0oj7vhg0005w4a4n71f64gl', 7
),

-- Developers to exclude
developers AS (
    SELECT source_id AS user_id
    FROM local_edges
    WHERE type = 'HAS_ROLE' AND label = 'developer'
),

-- All facilitators with their non-test groups
facilitator_groups AS (
    SELECT
        f.source_id AS facilitator_id,
        f.target_id AS group_id,
        g.properties->>'hangoutId' AS hangout_id,
        f.properties->>'joinedAt' AS joined_at
    FROM local_edges f
    JOIN local_nodes g ON g.id = f.target_id
    WHERE f.type = 'FACILITATES'
      AND f.source_id NOT IN (SELECT user_id FROM developers)
      AND COALESCE(g.properties->>'is_test', 'false') != 'true'
),

-- Members per group (non-test groups only)
group_members AS (
    SELECT
        m.target_id AS group_id,
        m.source_id AS member_id
    FROM local_edges m
    JOIN local_nodes g ON g.id = m.target_id
    WHERE m.type = 'MEMBER_OF'
      AND COALESCE(g.properties->>'is_test', 'false') != 'true'
),

-- Attendance per user per group (with episode info)
attendance AS (
    SELECT
        a.source_id AS user_id,
        a.properties->>'groupId' AS group_id_raw,
        'group:' || (a.properties->>'groupId') AS group_id,
        a.target_id AS episode_id,
        a.properties->>'attendedAt' AS attended_at
    FROM local_edges a
    WHERE a.type = 'ATTENDED'
),

-- Filter attendance to non-test groups
attendance_filtered AS (
    SELECT a.*
    FROM attendance a
    JOIN local_nodes g ON g.id = a.group_id
    WHERE COALESCE(g.properties->>'is_test', 'false') != 'true'
),

-- =====================
-- DIMENSION 1: DIRECT IMPACT (15%)
-- Unique members taught, weighted by avg episodes attended per member
-- =====================
member_episodes_per_facilitator AS (
    SELECT
        fg.facilitator_id,
        gm.member_id,
        COUNT(DISTINCT af.episode_id) AS episodes_attended
    FROM facilitator_groups fg
    JOIN group_members gm ON gm.group_id = fg.group_id
    JOIN attendance_filtered af ON af.group_id = fg.group_id AND af.user_id = gm.member_id
    GROUP BY fg.facilitator_id, gm.member_id
),
direct_impact_raw AS (
    SELECT
        facilitator_id,
        COUNT(DISTINCT member_id) AS unique_members,
        AVG(episodes_attended) AS avg_episodes,
        COUNT(DISTINCT member_id) * AVG(episodes_attended) AS impact_score
    FROM member_episodes_per_facilitator
    GROUP BY facilitator_id
),
direct_impact AS (
    SELECT
        facilitator_id,
        CASE
            WHEN MAX(impact_score) OVER () = 0 THEN 0
            ELSE (impact_score / MAX(impact_score) OVER ()) * 100
        END AS direct_impact_score
    FROM direct_impact_raw
),

-- =====================
-- DIMENSION 2: LINEAGE SCORE (30%)
-- Gen 1: promoted facilitators who were members in this facilitator's groups
-- Gen 2: promoted facilitators who were members in gen1's groups
-- =====================
promoted AS (
    SELECT
        e.source_id AS promoted_user_id,
        'group:' || (e.properties->>'hijrah_group_id') AS hijrah_group_id
    FROM local_edges e
    WHERE e.target_id = 'role:promoted_facilitator'
),

-- Gen 1: promoted students from facilitator's Hijrah groups
-- Must match via hijrah_group_id AND not already a facilitator before joining Hijrah
gen1 AS (
    SELECT DISTINCT
        fg.facilitator_id,
        p.promoted_user_id AS gen1_user_id
    FROM facilitator_groups fg
    JOIN promoted p ON p.hijrah_group_id = fg.group_id
    -- Ensure the promoted user was NOT already a facilitator before their hijrah membership
    WHERE NOT EXISTS (
        SELECT 1 FROM local_edges fe
        WHERE fe.source_id = p.promoted_user_id
          AND fe.type = 'FACILITATES'
          AND fe.valid_from < (
            SELECT (e2.properties->>'joined_hijrah')::timestamp
            FROM local_edges e2
            WHERE e2.source_id = p.promoted_user_id
              AND e2.target_id = 'role:promoted_facilitator'
            LIMIT 1
          )
    )
),

-- Gen 2: promoted students from gen1's groups
-- Same hijrah_group_id matching and circular-reference prevention
gen2 AS (
    SELECT DISTINCT
        g1.facilitator_id,
        p2.promoted_user_id AS gen2_user_id
    FROM gen1 g1
    -- Find groups facilitated by gen1 users
    JOIN facilitator_groups fg2 ON fg2.facilitator_id = g1.gen1_user_id
    -- Find promoted users whose hijrah_group_id matches gen1's facilitated groups
    JOIN promoted p2 ON p2.hijrah_group_id = fg2.group_id
    -- Exclude the original facilitator and gen1 from gen2
    WHERE p2.promoted_user_id != g1.facilitator_id
      AND p2.promoted_user_id != g1.gen1_user_id
      -- Ensure the promoted user was NOT already a facilitator before their hijrah membership
      AND NOT EXISTS (
        SELECT 1 FROM local_edges fe
        WHERE fe.source_id = p2.promoted_user_id
          AND fe.type = 'FACILITATES'
          AND fe.valid_from < (
            SELECT (e2.properties->>'joined_hijrah')::timestamp
            FROM local_edges e2
            WHERE e2.source_id = p2.promoted_user_id
              AND e2.target_id = 'role:promoted_facilitator'
            LIMIT 1
          )
      )
),

lineage_raw AS (
    SELECT
        facilitator_id,
        COALESCE(g1_count, 0) AS gen1_count,
        COALESCE(g2_count, 0) AS gen2_count,
        COALESCE(g1_count, 0) + COALESCE(g2_count, 0) * 0.5 AS lineage_score
    FROM (
        SELECT facilitator_id, COUNT(*) AS g1_count
        FROM gen1
        GROUP BY facilitator_id
    ) g1s
    LEFT JOIN (
        SELECT facilitator_id, COUNT(*) AS g2_count
        FROM gen2
        GROUP BY facilitator_id
    ) g2s USING (facilitator_id)
),
lineage AS (
    SELECT
        facilitator_id,
        CASE
            WHEN MAX(lineage_score) OVER () = 0 THEN 0
            ELSE (lineage_score / MAX(lineage_score) OVER ()) * 100
        END AS lineage_score
    FROM lineage_raw
),

-- =====================
-- DIMENSION 3: CONSISTENCY (10%)
-- Active months / possible months * 100
-- =====================
facilitator_attendance_months AS (
    SELECT
        fg.facilitator_id,
        DATE_TRUNC('month', (af.attended_at)::timestamp) AS att_month
    FROM facilitator_groups fg
    JOIN attendance_filtered af ON af.group_id = fg.group_id
    GROUP BY fg.facilitator_id, DATE_TRUNC('month', (af.attended_at)::timestamp)
),
consistency AS (
    SELECT
        fg.facilitator_id,
        CASE
            WHEN possible_months = 0 THEN 0
            ELSE LEAST((active_months::float / possible_months) * 100, 100)
        END AS consistency_score
    FROM (
        SELECT
            facilitator_id,
            COUNT(DISTINCT att_month) AS active_months
        FROM facilitator_attendance_months
        GROUP BY facilitator_id
    ) am
    JOIN (
        SELECT
            facilitator_id,
            GREATEST(
                EXTRACT(YEAR FROM AGE(NOW(), MIN((joined_at)::timestamp))) * 12
                + EXTRACT(MONTH FROM AGE(NOW(), MIN((joined_at)::timestamp)))
                + 1,
                1
            ) AS possible_months
        FROM facilitator_groups fg
        GROUP BY facilitator_id
    ) fg USING (facilitator_id)
),

-- =====================
-- DIMENSION 4: CURRICULUM THROUGHPUT (20%)
-- Avg completion rate across groups (distinct episodes attended / max for course)
-- =====================
group_completion AS (
    SELECT
        fg.facilitator_id,
        fg.group_id,
        fg.hangout_id,
        hme.max_eps,
        COUNT(DISTINCT af.episode_id) AS episodes_done
    FROM facilitator_groups fg
    JOIN hangout_max_episodes hme ON hme.hangout_id = fg.hangout_id
    LEFT JOIN attendance_filtered af ON af.group_id = fg.group_id
    GROUP BY fg.facilitator_id, fg.group_id, fg.hangout_id, hme.max_eps
),
throughput AS (
    SELECT
        facilitator_id,
        AVG(LEAST(episodes_done::float / NULLIF(max_eps, 0), 1.0)) * 100 AS throughput_score
    FROM group_completion
    GROUP BY facilitator_id
),

-- =====================
-- DIMENSION 5: RETENTION RATE (25%)
-- Per group: % of members who attended > half the episodes for that course
-- Average across groups
-- =====================
member_group_attendance AS (
    SELECT
        fg.facilitator_id,
        fg.group_id,
        fg.hangout_id,
        gm.member_id,
        COUNT(DISTINCT af.episode_id) AS episodes_attended
    FROM facilitator_groups fg
    JOIN group_members gm ON gm.group_id = fg.group_id
    JOIN hangout_max_episodes hme ON hme.hangout_id = fg.hangout_id
    JOIN attendance_filtered af ON af.group_id = fg.group_id AND af.user_id = gm.member_id
    GROUP BY fg.facilitator_id, fg.group_id, fg.hangout_id, gm.member_id
),
group_retention AS (
    SELECT
        mga.facilitator_id,
        mga.group_id,
        COUNT(*) AS total_members,
        COUNT(*) FILTER (WHERE mga.episodes_attended > hme.max_eps / 2.0) AS retained_members
    FROM member_group_attendance mga
    JOIN hangout_max_episodes hme ON hme.hangout_id = mga.hangout_id
    GROUP BY mga.facilitator_id, mga.group_id
),
retention AS (
    SELECT
        facilitator_id,
        AVG(CASE WHEN total_members = 0 THEN 0 ELSE retained_members::float / total_members END) * 100 AS retention_score
    FROM group_retention
    GROUP BY facilitator_id
),

-- =====================
-- COMBINE ALL DIMENSIONS
-- =====================
all_facilitators AS (
    SELECT DISTINCT facilitator_id FROM facilitator_groups
),
scores AS (
    SELECT
        af.facilitator_id,
        n.label AS facilitator_name,
        COALESCE(di.direct_impact_score, 0) AS direct_impact,
        COALESCE(l.lineage_score, 0) AS lineage,
        COALESCE(c.consistency_score, 0) AS consistency,
        COALESCE(t.throughput_score, 0) AS throughput,
        COALESCE(r.retention_score, 0) AS retention
    FROM all_facilitators af
    JOIN local_nodes n ON n.id = af.facilitator_id
    LEFT JOIN direct_impact di ON di.facilitator_id = af.facilitator_id
    LEFT JOIN lineage l ON l.facilitator_id = af.facilitator_id
    LEFT JOIN consistency c ON c.facilitator_id = af.facilitator_id
    LEFT JOIN throughput t ON t.facilitator_id = af.facilitator_id
    LEFT JOIN retention r ON r.facilitator_id = af.facilitator_id
)

SELECT
    facilitator_name,
    ROUND(direct_impact::numeric, 1) AS direct_impact,
    ROUND(lineage::numeric, 1) AS lineage,
    ROUND(consistency::numeric, 1) AS consistency,
    ROUND(throughput::numeric, 1) AS throughput,
    ROUND(retention::numeric, 1) AS retention,
    ROUND((
        0.15 * direct_impact
      + 0.30 * lineage
      + 0.10 * consistency
      + 0.20 * throughput
      + 0.25 * retention
    )::numeric, 1) AS final_score,
    RANK() OVER (ORDER BY (
        0.15 * direct_impact
      + 0.30 * lineage
      + 0.10 * consistency
      + 0.20 * throughput
      + 0.25 * retention
    ) DESC) AS rank
FROM scores
ORDER BY final_score DESC;
