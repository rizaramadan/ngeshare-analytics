# Publish step

Reads pre-aggregated rows from the local analytics DB (already populated by
`pnpm sync`) and writes them into the **published** analytics DB. Production
target is Neon free tier; locally we use a second Postgres database on the
same container, with mirrored role separation, so /api can develop against
the same architecture.

## One-time local setup

```sh
docker exec -i ngeshare-analytics-db psql -U ngeshare -d postgres \
  < publish/init/setup_published_db.sql
```

This creates `ngeshare_analytics_published`, `analytics_writer`, and
`analytics_reader`. Idempotent — re-runs are no-ops.

Then set `NEON_ANALYTICS_WRITE_URL` in `.env` (see `.env.example`).

## Run

```sh
pnpm sync           # refresh the local analytics DB from production
pnpm run publish    # publish pre-computed rows to the published DB
```

Or `pnpm publish:debug` for verbose timing/row counts.

**Note:** use `pnpm run publish`, not `pnpm publish` — the latter hits pnpm's
built-in `publish` (publishes the package to npm registry) and refuses on an
unclean working tree. The `:debug` variant has no built-in collision so
either form works.

## Tables published (Phase 2)

- `monthly_metrics` — one row per month
- `facilitator_ranking` — one row per facilitator, pre-sorted, `rank`
  materialized

Add new tables by:
1. Add DDL to `publish/schema.sql`
2. Add `publish/tables/<name>.js` exporting `publishX({ sourcePool, client, debug })`
3. Register it in the `TABLES` array at the top of `publish/index.js`

## Verify locally

As `analytics_reader` (read-only, mirrors how `/api` connects):

```sh
docker exec -it ngeshare-analytics-db psql \
  postgresql://analytics_reader:analytics_reader_local_password@localhost:5432/ngeshare_analytics_published \
  -c 'SELECT COUNT(*) FROM monthly_metrics; SELECT COUNT(*) FROM facilitator_ranking;'
```

INSERT as `analytics_reader` should fail with `permission denied for table ...`.
