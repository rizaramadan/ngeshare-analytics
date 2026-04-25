-- DDL for the published analytics database (local Postgres mirror of Neon).
-- Idempotent: orchestrator runs this on every publish before writing data.
-- Tables hold pre-computed rows ONLY — heavy SQL stays in /analysis.

-- ---------------------------------------------------------------------------
-- monthly_metrics
--
-- One row per month. Source: getMonthlyMetrics() in src/web/queries/metrics.js.
-- Powers the dashboard's monthly trend chart in faster-web.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_metrics (
  month             DATE        PRIMARY KEY,
  active_groups     INTEGER     NOT NULL DEFAULT 0,
  total_meetings    INTEGER     NOT NULL DEFAULT 0,
  active_members    INTEGER     NOT NULL DEFAULT 0,
  new_groups        INTEGER     NOT NULL DEFAULT 0,
  new_members       INTEGER     NOT NULL DEFAULT 0,
  new_facilitators  INTEGER     NOT NULL DEFAULT 0,
  published_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monthly_metrics_month_desc
  ON monthly_metrics (month DESC);

-- ---------------------------------------------------------------------------
-- facilitator_ranking
--
-- One row per facilitator. Source: getFacilitatorRanking() in
-- src/web/queries/facilitatorRanking.js. Pre-sorted by total_score DESC at
-- publish time and materialized as `rank` so /api can serve top-N without
-- recomputing.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS facilitator_ranking (
  facilitator_id      TEXT        PRIMARY KEY,
  rank                INTEGER     NOT NULL,
  email               TEXT,
  name                TEXT        NOT NULL,
  groups_facilitated  INTEGER     NOT NULL DEFAULT 0,
  alumni_converted    INTEGER     NOT NULL DEFAULT 0,
  alumni_points       INTEGER     NOT NULL DEFAULT 0,
  own_members         INTEGER     NOT NULL DEFAULT 0,
  descendant_members  INTEGER     NOT NULL DEFAULT 0,
  member_points       INTEGER     NOT NULL DEFAULT 0,
  total_score         INTEGER     NOT NULL DEFAULT 0,
  published_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_facilitator_ranking_rank
  ON facilitator_ranking (rank ASC);

CREATE INDEX IF NOT EXISTS idx_facilitator_ranking_total_score_desc
  ON facilitator_ranking (total_score DESC);

-- ---------------------------------------------------------------------------
-- monthly_metrics_by_origin
--
-- Same as monthly_metrics but split by facilitator origin (is_alumni).
-- Powers the origin-trend page's first 4 charts (active groups/members/
-- facilitators per month, % share). Source: getMonthlyMetricsByOrigin().
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_metrics_by_origin (
  month               DATE        NOT NULL,
  is_alumni           BOOLEAN     NOT NULL,
  active_groups       INTEGER     NOT NULL DEFAULT 0,
  active_members      INTEGER     NOT NULL DEFAULT 0,
  active_facilitators INTEGER     NOT NULL DEFAULT 0,
  published_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (month, is_alumni)
);

CREATE INDEX IF NOT EXISTS idx_metrics_by_origin_month_desc
  ON monthly_metrics_by_origin (month DESC);

-- ---------------------------------------------------------------------------
-- monthly_promotions
--
-- New facilitator promotions per month (alumni who became facilitators) +
-- running cumulative total. Powers chart 7 (promotions). Source:
-- getPromotionTimeline().
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_promotions (
  month                DATE        PRIMARY KEY,
  new_promoted         INTEGER     NOT NULL DEFAULT 0,
  cumulative_promoted  INTEGER     NOT NULL DEFAULT 0,
  published_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- facilitator_activity_rate
--
-- Per month: total population of promoted/ngeslow facilitators (cumulative
-- through that month) and how many of each were active. Powers charts 5
-- (active vs total) and 6 (activity rate). Source:
-- getFacilitatorActivityRate().
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS facilitator_activity_rate (
  month            DATE        PRIMARY KEY,
  total_promoted   INTEGER     NOT NULL DEFAULT 0,
  total_ngeslow    INTEGER     NOT NULL DEFAULT 0,
  active_promoted  INTEGER     NOT NULL DEFAULT 0,
  active_ngeslow   INTEGER     NOT NULL DEFAULT 0,
  published_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- monthly_groups_by_province
--
-- One row per (month, province). Counts groups that started in that month
-- and the running cumulative total per province through that month. Powers
-- the Indonesia map page with a month slider showing platform expansion
-- over time.
--
-- Source: HangoutGroup table directly. Province is normalized to UPPERCASE
-- (HangoutGroup.province has case inconsistencies in raw data).
-- "Started in month M" = DATE_TRUNC('month', COALESCE(startDate, createdAt))
-- since endDate is never populated in source data.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_groups_by_province (
  month             DATE        NOT NULL,
  province          TEXT        NOT NULL,
  new_groups        INTEGER     NOT NULL DEFAULT 0,
  cumulative_groups INTEGER     NOT NULL DEFAULT 0,
  published_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (month, province)
);

CREATE INDEX IF NOT EXISTS idx_groups_by_province_month
  ON monthly_groups_by_province (month);
