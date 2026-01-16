-- Analytics Views for ngeShare Dashboard
-- Run this after data sync is complete

-- Course configuration reference table
CREATE TABLE IF NOT EXISTS course_config (
    course_name TEXT PRIMARY KEY,
    max_episodes INTEGER NOT NULL,
    sequence_order INTEGER NOT NULL
);

-- Insert/update course config
INSERT INTO course_config (course_name, max_episodes, sequence_order) VALUES
    ('Ngeshare Sesi Aqidah', 9, 1),
    ('Ngeshare Sesi Hijrah', 9, 2),
    ('Ngeshare Sesi Sejarah', 11, 3),
    ('Ngeshare Sesi Dakwah', 7, 4)
ON CONFLICT (course_name) DO UPDATE SET
    max_episodes = EXCLUDED.max_episodes,
    sequence_order = EXCLUDED.sequence_order;

-- View: v_group_summary
-- Group with course info, facilitator, and member count
CREATE OR REPLACE VIEW v_group_summary AS
SELECT
    hg.id AS group_id,
    hg.name AS group_name,
    h.name AS course_name,
    COALESCE(cc.max_episodes, 0) AS max_episodes,
    COALESCE(cc.sequence_order, 0) AS sequence_order,
    hg.status AS group_status,
    hg."createdAt" AS created_at,
    hg."startDate" AS start_date,
    hg."endDate" AS end_date,
    hg.city,
    hg.province,
    -- Facilitator info (first one if multiple)
    f.user_id AS facilitator_id,
    f.user_email AS facilitator_email,
    -- Member count (excluding facilitator)
    COALESCE(m.member_count, 0) AS member_count
FROM "HangoutGroup" hg
LEFT JOIN "Hangout" h ON hg."hangoutId" = h.id
LEFT JOIN course_config cc ON h.name = cc.course_name
-- Get facilitator
LEFT JOIN LATERAL (
    SELECT
        uhg."userId" AS user_id,
        uhg."userEmail" AS user_email
    FROM "UserHangoutGroup" uhg
    WHERE uhg."hangoutGroupId" = hg.id
      AND uhg."hangoutGroupRole" = 'FACILITATOR'
    ORDER BY uhg."joinedAt" ASC NULLS LAST
    LIMIT 1
) f ON true
-- Count members
LEFT JOIN LATERAL (
    SELECT COUNT(*) AS member_count
    FROM "UserHangoutGroup" uhg
    WHERE uhg."hangoutGroupId" = hg.id
      AND uhg."hangoutGroupRole" = 'MEMBER'
) m ON true;

-- View: v_group_progress
-- Group progress based on attendance
CREATE OR REPLACE VIEW v_group_progress AS
SELECT
    hg.id AS group_id,
    COALESCE(MAX(he."order"), 0) AS max_episode_reached,
    MAX(a."attendedAt") AS last_meeting_date,
    COUNT(DISTINCT a."attendedAt"::date) AS total_meetings,
    EXTRACT(DAY FROM NOW() - MAX(a."attendedAt"))::INTEGER AS days_since_last_meeting
FROM "HangoutGroup" hg
LEFT JOIN "UserHangoutGroupAttendance" a ON a."hangoutGroupId" = hg.id
LEFT JOIN "HangoutEpisode" he ON a."hangoutEpisodeId" = he.id
GROUP BY hg.id;

-- View: v_group_status
-- Computed status: ACTIVE, GRADUATED, STALLED
CREATE OR REPLACE VIEW v_group_status AS
SELECT
    gs.group_id,
    gs.group_name,
    gs.course_name,
    gs.max_episodes,
    gs.sequence_order,
    gs.facilitator_id,
    gs.facilitator_email,
    gs.member_count,
    gs.created_at,
    gs.city,
    gs.province,
    gp.max_episode_reached,
    gp.last_meeting_date,
    gp.total_meetings,
    gp.days_since_last_meeting,
    CASE
        WHEN gs.max_episodes > 0 AND gp.max_episode_reached >= gs.max_episodes THEN 'GRADUATED'
        WHEN gp.days_since_last_meeting IS NULL THEN
            -- No attendance yet: ACTIVE if recently created (≤28 days), else STALLED
            CASE
                WHEN EXTRACT(DAY FROM NOW() - gs.created_at) <= 28 THEN 'ACTIVE'
                ELSE 'STALLED'
            END
        WHEN gp.days_since_last_meeting <= 28 THEN 'ACTIVE'
        ELSE 'STALLED'
    END AS computed_status,
    CASE
        WHEN gs.max_episodes > 0 THEN
            ROUND((gp.max_episode_reached::NUMERIC / gs.max_episodes) * 100, 1)
        ELSE 0
    END AS progress_pct
FROM v_group_summary gs
LEFT JOIN v_group_progress gp ON gs.group_id = gp.group_id;

-- View: v_facilitator_stats
-- Facilitator metrics with alumni flag
CREATE OR REPLACE VIEW v_facilitator_stats AS
WITH facilitator_roles AS (
    SELECT
        "userId",
        "userEmail",
        MIN(CASE WHEN "hangoutGroupRole" = 'MEMBER' THEN "joinedAt" END) AS first_member_date,
        MIN(CASE WHEN "hangoutGroupRole" = 'FACILITATOR' THEN "joinedAt" END) AS first_facilitator_date,
        COUNT(DISTINCT CASE WHEN "hangoutGroupRole" = 'FACILITATOR' THEN "hangoutGroupId" END) AS groups_facilitated
    FROM "UserHangoutGroup"
    WHERE "userId" IS NOT NULL
    GROUP BY "userId", "userEmail"
    HAVING COUNT(DISTINCT CASE WHEN "hangoutGroupRole" = 'FACILITATOR' THEN "hangoutGroupId" END) > 0
)
SELECT
    "userId" AS facilitator_id,
    "userEmail" AS facilitator_email,
    groups_facilitated,
    first_facilitator_date,
    CASE
        WHEN first_member_date IS NOT NULL AND first_member_date < first_facilitator_date
        THEN TRUE
        ELSE FALSE
    END AS is_alumni
FROM facilitator_roles;

-- View: v_curriculum_funnel
-- Groups per course per status for funnel chart
CREATE OR REPLACE VIEW v_curriculum_funnel AS
SELECT
    course_name,
    sequence_order,
    computed_status,
    COUNT(*) AS group_count
FROM v_group_status
WHERE course_name IS NOT NULL
GROUP BY course_name, sequence_order, computed_status
ORDER BY sequence_order, computed_status;

-- View: v_rescue_list
-- Groups that are STALLED but have >= 70% progress
CREATE OR REPLACE VIEW v_rescue_list AS
SELECT
    group_id,
    group_name,
    course_name,
    facilitator_id,
    facilitator_email,
    member_count,
    max_episode_reached,
    max_episodes,
    progress_pct,
    days_since_last_meeting,
    last_meeting_date,
    (max_episodes - max_episode_reached) AS episodes_remaining
FROM v_group_status
WHERE computed_status = 'STALLED'
  AND progress_pct >= 70
ORDER BY days_since_last_meeting ASC NULLS LAST;

-- Summary metrics view
CREATE OR REPLACE VIEW v_dashboard_metrics AS
SELECT
    (SELECT COUNT(*) FROM v_group_status WHERE computed_status = 'ACTIVE') AS active_groups,
    (SELECT COUNT(*) FROM v_group_status WHERE computed_status = 'GRADUATED') AS graduated_groups,
    (SELECT COUNT(*) FROM v_group_status WHERE computed_status = 'STALLED') AS stalled_groups,
    (SELECT COUNT(*) FROM v_group_status) AS total_groups,
    (SELECT COUNT(*) FROM v_facilitator_stats) AS total_facilitators,
    (SELECT COUNT(*) FROM v_facilitator_stats WHERE is_alumni = TRUE) AS alumni_facilitators,
    (SELECT COUNT(DISTINCT "userId") FROM "UserHangoutGroup" WHERE "hangoutGroupRole" = 'MEMBER' AND "userId" IS NOT NULL) AS total_members;
