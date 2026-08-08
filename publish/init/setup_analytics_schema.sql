-- Idempotent setup for the published analytics schema, hosted inside
-- ngeshare_local (the local production-mirror Postgres on :5432).
--
-- Architecture: in production, /faster-web reads pre-computed analytics rows
-- from Neon — a separate database from the production OLTP. In dev, we
-- collapse "source DB" and "published DB" onto a single host (ngeshare_local)
-- but keep the *role boundary* identical to Neon so /faster-web's
-- analytics_reader connection has the exact same SELECT-only blast radius
-- locally as it does in prod.
--
-- Layout inside ngeshare_local:
--   public.*       Prisma tables + v_* analysis views (source for publish)
--   analytics.*    pre-computed published rows (target of publish; only thing
--                  /faster-web sees)
--
-- Run once:
--
--   PGPASSWORD=mainmain psql -h localhost -U postgreuser -d ngeshare_local \
--     -f publish/init/setup_analytics_schema.sql
--
-- Safe to re-run: roles, schema, and grants are all guarded with IF NOT EXISTS
-- or DO blocks.

-- ---------------------------------------------------------------------------
-- 1. Roles
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_writer') THEN
    CREATE ROLE analytics_writer WITH LOGIN PASSWORD 'analytics_writer_local_password';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_reader') THEN
    CREATE ROLE analytics_reader WITH LOGIN PASSWORD 'analytics_reader_local_password';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. analytics schema
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS analytics;

-- ---------------------------------------------------------------------------
-- 3. Database-level connect privilege
-- ---------------------------------------------------------------------------
GRANT CONNECT ON DATABASE ngeshare_local TO analytics_writer;
GRANT CONNECT ON DATABASE ngeshare_local TO analytics_reader;

-- ---------------------------------------------------------------------------
-- 4. Writer privileges
--
-- Writer owns objects in analytics (CREATE) and reads from public (the source
-- of the publish step: Prisma tables and v_* views). Writer has NO write or
-- DDL privilege on public — the production OLTP shape is read-only to it.
-- ---------------------------------------------------------------------------
GRANT USAGE, CREATE ON SCHEMA analytics TO analytics_writer;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE
  ON ALL TABLES IN SCHEMA analytics TO analytics_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO analytics_writer;

GRANT USAGE ON SCHEMA public TO analytics_writer;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO analytics_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO analytics_writer;

-- ---------------------------------------------------------------------------
-- 5. Reader privileges
--
-- Reader sees ONLY the analytics schema, SELECT only. No grants on public —
-- so even if /faster-web's analytics-db.ts were tricked into running an
-- arbitrary query, it could not read raw Prisma data. Same boundary as Neon.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA analytics TO analytics_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO analytics_reader;

-- Future tables created by analytics_writer in the analytics schema auto-grant
-- SELECT to analytics_reader. Keeps adding new published tables a single-step
-- operation (just add to publish/schema.sql).
ALTER DEFAULT PRIVILEGES FOR ROLE analytics_writer IN SCHEMA analytics
  GRANT SELECT ON TABLES TO analytics_reader;

-- ---------------------------------------------------------------------------
-- 6. Per-role search_path
--
-- Set search_path at the role level so unqualified names in queries resolve
-- correctly without every connection string needing to remember to set it.
--   - Writer: looks in analytics first (CREATE TABLE lands there since writer
--     has no CREATE on public), then public so source queries can reference
--     "UserHangoutGroup", v_facilitator_stats, etc.
--   - Reader: only analytics. Refusing to fall back to public is intentional.
-- ---------------------------------------------------------------------------
ALTER ROLE analytics_writer SET search_path = analytics, public;
ALTER ROLE analytics_reader SET search_path = analytics;

\echo ''
\echo '=== analytics schema ready in ngeshare_local ==='
\echo 'Writer URL: postgresql://analytics_writer:analytics_writer_local_password@localhost:5432/ngeshare_local'
\echo 'Reader URL: postgresql://analytics_reader:analytics_reader_local_password@localhost:5432/ngeshare_local'
