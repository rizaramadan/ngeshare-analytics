-- Local Postgres init for the "published analytics" database.
-- Mirrors the Neon free-tier setup: one writer role, one reader role,
-- so /api can develop against the same role separation as production.
--
-- Run once against the existing ngeshare-analytics-db container:
--
--   docker exec -i ngeshare-analytics-db psql -U ngeshare -d postgres \
--     < publish/init/setup_published_db.sql
--
-- Idempotent: safe to re-run; uses DO blocks for existence checks where
-- CREATE ... IF NOT EXISTS isn't supported (databases, roles).

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

SELECT 'CREATE DATABASE ngeshare_analytics_published'
WHERE NOT EXISTS (
  SELECT 1 FROM pg_database WHERE datname = 'ngeshare_analytics_published'
)
\gexec

GRANT CONNECT ON DATABASE ngeshare_analytics_published TO analytics_writer;
GRANT CONNECT ON DATABASE ngeshare_analytics_published TO analytics_reader;

\c ngeshare_analytics_published

GRANT USAGE, CREATE ON SCHEMA public TO analytics_writer;
GRANT USAGE ON SCHEMA public TO analytics_reader;

ALTER DEFAULT PRIVILEGES FOR ROLE analytics_writer IN SCHEMA public
  GRANT SELECT ON TABLES TO analytics_reader;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO analytics_reader;

\echo ''
\echo '=== Setup complete ==='
\echo 'Writer URL:  postgresql://analytics_writer:analytics_writer_local_password@localhost:5433/ngeshare_analytics_published'
\echo 'Reader URL:  postgresql://analytics_reader:analytics_reader_local_password@localhost:5433/ngeshare_analytics_published'
